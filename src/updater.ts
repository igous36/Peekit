// 自动更新（2026-11-18）。
//
// 流程：启动 5 秒后（之后每 12 小时）读 GitHub Release 上的 latest.json → 有新版本就在 ≡ 按钮上亮一个蓝点、
// 菜单顶上出现“更新到 x.y.z”、第一次发现这个版本时弹一条提示 → 用户点了才下载（有进度）→ 下载完先把作品库写盘，
// 再交给安装程序：Windows 上应用会被关掉，安装程序（passive，只有进度条）装完自动重新打开。
//
// 验签用 tauri.conf.json 里的公钥，安装包被换过会下载失败；地址也写死在配置里，前端改不了。
// 自动检查可以在偏好设置里关掉（关掉后还能在“关于”里手动检查）。没网、GitHub 连不上时自动检查静默失败，不打扰。
//
// 这里只有状态机，Tauri 的调用从外面传进来（UpdaterDeps），方便单测。

/** 下载进度事件（和 @tauri-apps/plugin-updater 的 DownloadEvent 一致） */
export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

/** check() 返回的新版本（plugin-updater 的 Update 满足这个接口） */
export interface UpdateHandle {
  version: string;
  body?: string;
  download(onEvent?: (e: DownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
  close?(): Promise<void>;
}

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking'; manual: boolean }
  | { kind: 'latest' }
  | { kind: 'available'; version: string; notes: string; manual: boolean }
  | { kind: 'downloading'; version: string; got: number; total: number | null }
  | { kind: 'installing'; version: string }
  | { kind: 'failed'; stage: 'check' | 'install'; version: string | null; msg: string };

export interface UpdaterDeps {
  /** 查有没有新版本，没有返回 null */
  check: () => Promise<UpdateHandle | null>;
  /** 交给安装程序之前：把作品库写盘 */
  beforeInstall: () => Promise<void>;
  /** 装完重启（Windows 上安装程序会自己重新打开应用，走不到这一步） */
  restart: () => Promise<void>;
}

/** 启动后多久第一次自动检查：避开启动时读作品库、生成缩略图的高峰 */
export const AUTO_CHECK_DELAY = 5000;
/** 一直开着时多久再查一次 */
export const AUTO_CHECK_EVERY = 12 * 60 * 60 * 1000;

/** 下载百分比（0–100 的整数）；不知道总大小时返回 null */
export function percentOf(got: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((got / total) * 100)));
}

/** 错误信息转成一句话（Rust 端传来的多半是字符串） */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** 有新版本时要不要弹提示：自动检查发现、而且这个版本没提示过（每个版本只弹一次，菜单里的蓝点一直在） */
export const shouldAnnounce = (s: UpdateState, announced: string | null): boolean =>
  s.kind === 'available' && !s.manual && s.version !== announced;

const ANNOUNCED_KEY = 'peekit:update-announced';

/** 已经弹过提示的版本 */
export function announcedVersion(): string | null {
  try {
    return localStorage.getItem(ANNOUNCED_KEY);
  } catch {
    return null;
  }
}

export function markAnnounced(version: string): void {
  try {
    localStorage.setItem(ANNOUNCED_KEY, version);
  } catch {
    /* 存不了就下次再提示一次 */
  }
}

export class Updater {
  private st: UpdateState = { kind: 'idle' };
  private update: UpdateHandle | null = null;
  private listeners = new Set<(s: UpdateState) => void>();

  constructor(private deps: UpdaterDeps) {}

  get state(): UpdateState {
    return this.st;
  }

  /** 检查 / 下载 / 安装进行中 */
  get busy(): boolean {
    const k = this.st.kind;
    return k === 'checking' || k === 'downloading' || k === 'installing';
  }

  subscribe(fn: (s: UpdateState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(s: UpdateState): void {
    this.st = s;
    for (const fn of this.listeners) fn(s);
  }

  /**
   * 已经知道有新版本时回到“可以更新”的状态（自测下载完后）。
   * manual 记成 true：用户已经见过这个版本了，不能再弹“有新版本”的提示——
   * 2026-11-18 实测时这里是 false，自测下载完又弹了提示，点了“更新”就真的装上了。
   */
  private restingState(): UpdateState {
    const u = this.update;
    return u ? { kind: 'available', version: u.version, notes: u.body ?? '', manual: true } : { kind: 'idle' };
  }

  /**
   * 检查更新。manual = 用户在“关于”里点的：失败要显示出来；自动检查失败就当没查过。
   * 已经发现新版本后，自动检查不再重复请求。
   */
  async check(manual = false): Promise<void> {
    if (this.busy) return;
    if (this.update && !manual) return;
    this.set({ kind: 'checking', manual });
    try {
      const u = await this.deps.check();
      if (this.update && this.update !== u) void this.update.close?.().catch(() => {});
      this.update = u;
      this.set(u ? { kind: 'available', version: u.version, notes: u.body ?? '', manual } : { kind: 'latest' });
    } catch (e) {
      this.set(manual ? { kind: 'failed', stage: 'check', version: null, msg: errorText(e) } : this.restingState());
    }
  }

  /**
   * 下载并安装（用户点了“更新”）。
   * dryRun：只下载、验签，不安装（发版前自测用，见 app.ts 的 runUpdateProbe），完了回到“可以更新”。
   */
  async install(dryRun = false): Promise<void> {
    const u = this.update;
    if (!u || this.busy) return;
    const version = u.version;
    let got = 0;
    let total: number | null = null;
    // 进度事件一块一个（几 KB），只在百分比变了时通知界面；不知道总大小时每 256KB 通知一次
    let shown = -1;
    this.set({ kind: 'downloading', version, got, total });
    try {
      await u.download((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? null;
        else if (e.event === 'Progress') got += e.data.chunkLength;
        else return;
        const mark = percentOf(got, total) ?? Math.floor(got / 262144);
        if (mark === shown) return;
        shown = mark;
        this.set({ kind: 'downloading', version, got, total });
      });
      if (dryRun) {
        this.set(this.restingState());
        return;
      }
      this.set({ kind: 'installing', version });
      await this.deps.beforeInstall();
      await u.install();
      await this.deps.restart();
    } catch (e) {
      this.set({ kind: 'failed', stage: 'install', version, msg: errorText(e) });
    }
  }
}
