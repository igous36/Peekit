import { describe, expect, it, vi } from 'vitest';
import { Updater, errorText, percentOf, shouldAnnounce, type DownloadEvent, type UpdateHandle, type UpdateState } from './updater';

function fakeUpdate(version = '0.1.4', chunks: number[] = [400, 600], opts: { failDownload?: boolean; failInstall?: boolean } = {}) {
  const log: string[] = [];
  const u: UpdateHandle = {
    version,
    body: '更新内容',
    async download(on?: (e: DownloadEvent) => void) {
      log.push('download');
      on?.({ event: 'Started', data: { contentLength: chunks.reduce((a, b) => a + b, 0) } });
      for (const c of chunks) on?.({ event: 'Progress', data: { chunkLength: c } });
      if (opts.failDownload) throw new Error('签名不对');
      on?.({ event: 'Finished' });
    },
    async install() {
      log.push('install');
      if (opts.failInstall) throw '安装程序启动失败';
    },
  };
  return { u, log };
}

function setup(check: () => Promise<UpdateHandle | null>) {
  const order: string[] = [];
  const up = new Updater({
    check,
    beforeInstall: async () => void order.push('flush'),
    restart: async () => void order.push('restart'),
  });
  const states: UpdateState[] = [];
  up.subscribe((s) => states.push(s));
  return { up, states, order };
}

describe('percentOf / errorText', () => {
  it('按总大小算整数百分比，不知道总大小时是 null', () => {
    expect(percentOf(0, 1000)).toBe(0);
    expect(percentOf(999, 1000)).toBe(99);
    expect(percentOf(1000, 1000)).toBe(100);
    expect(percentOf(1500, 1000)).toBe(100);
    expect(percentOf(500, null)).toBeNull();
    expect(percentOf(500, 0)).toBeNull();
  });

  it('错误转成一句话', () => {
    expect(errorText(new Error('网络错误'))).toBe('网络错误');
    expect(errorText('超时')).toBe('超时');
    expect(errorText({ code: 1 })).toBe('{"code":1}');
  });
});

describe('Updater.check', () => {
  it('有新版本 → available，没有 → latest', async () => {
    const { u } = fakeUpdate();
    const a = setup(async () => u);
    await a.up.check();
    expect(a.states.map((s) => s.kind)).toEqual(['checking', 'available']);
    expect(a.up.state).toEqual({ kind: 'available', version: '0.1.4', notes: '更新内容', manual: false });

    const b = setup(async () => null);
    await b.up.check(true);
    expect(b.up.state).toEqual({ kind: 'latest' });
  });

  it('自动检查失败不打扰（回到原状态），手动检查失败显示出来', async () => {
    const a = setup(async () => {
      throw new Error('连不上 GitHub');
    });
    await a.up.check();
    expect(a.up.state).toEqual({ kind: 'idle' });
    await a.up.check(true);
    expect(a.up.state).toEqual({ kind: 'failed', stage: 'check', version: null, msg: '连不上 GitHub' });
  });

  it('已经发现新版本后，自动检查不再请求；手动检查会重新查', async () => {
    const { u } = fakeUpdate();
    const check = vi.fn(async () => u);
    const { up } = setup(check);
    await up.check();
    await up.check();
    expect(check).toHaveBeenCalledTimes(1);
    await up.check(true);
    expect(check).toHaveBeenCalledTimes(2);
    expect(up.state).toMatchObject({ kind: 'available', manual: true });
  });

  it('检查进行中不重复请求', async () => {
    let resolve!: (u: UpdateHandle | null) => void;
    const check = vi.fn(() => new Promise<UpdateHandle | null>((r) => (resolve = r)));
    const { up } = setup(check);
    const p = up.check();
    void up.check(true);
    expect(check).toHaveBeenCalledTimes(1);
    expect(up.busy).toBe(true);
    resolve(null);
    await p;
    expect(up.busy).toBe(false);
  });
});

describe('Updater.install', () => {
  it('下载（带进度）→ 写盘 → 安装 → 重启，顺序不能乱', async () => {
    const { u, log } = fakeUpdate('0.1.4', [250, 250, 500]);
    const { up, states, order } = setup(async () => u);
    await up.check();
    states.length = 0;
    await up.install();
    const dl = states.filter((s) => s.kind === 'downloading');
    expect(dl.map((s) => (s.kind === 'downloading' ? percentOf(s.got, s.total) : -1))).toEqual([null, 0, 25, 50, 100]);
    expect(states[states.length - 1]).toEqual({ kind: 'installing', version: '0.1.4' });
    expect(log).toEqual(['download', 'install']);
    expect(order).toEqual(['flush', 'restart']);
  });

  it('dryRun（自测）：只下载验签，不写盘不安装，完了回到“可以更新”，而且不再弹“有新版本”的提示', async () => {
    const { u, log } = fakeUpdate();
    const { up, order } = setup(async () => u);
    await up.check();
    await up.install(true);
    expect(log).toEqual(['download']);
    expect(order).toEqual([]);
    expect(up.state).toMatchObject({ kind: 'available', version: '0.1.4' });
    // 2026-11-18 实测踩过：自测下载完又弹了提示，点“更新”就真的装上了
    expect(shouldAnnounce(up.state, null)).toBe(false);
  });

  it('百分比没变的进度块不通知界面', async () => {
    const { u } = fakeUpdate('0.1.4', Array(1000).fill(1));
    const { up, states } = setup(async () => u);
    await up.check();
    states.length = 0;
    await up.install();
    // 开始一次 + Started 一次（0%）+ 1%…100% 各一次 + 安装中
    expect(states.length).toBe(1 + 1 + 100 + 1);
  });

  it('下载失败（比如验签不过）→ failed，不写盘也不安装；能重试', async () => {
    const bad = fakeUpdate('0.1.4', [10], { failDownload: true });
    const { up, order } = setup(async () => bad.u);
    await up.check();
    await up.install();
    expect(up.state).toEqual({ kind: 'failed', stage: 'install', version: '0.1.4', msg: '签名不对' });
    expect(bad.log).toEqual(['download']);
    expect(order).toEqual([]);
    await up.install();
    expect(bad.log).toEqual(['download', 'download']);
  });

  it('安装失败 → failed；没发现新版本时点安装没反应', async () => {
    const bad = fakeUpdate('0.1.4', [10], { failInstall: true });
    const a = setup(async () => bad.u);
    await a.up.check();
    await a.up.install();
    expect(a.up.state).toMatchObject({ kind: 'failed', stage: 'install', msg: '安装程序启动失败' });
    expect(a.order).toEqual(['flush']);

    const b = setup(async () => null);
    await b.up.check();
    await b.up.install();
    expect(b.up.state).toEqual({ kind: 'latest' });
  });
});

describe('shouldAnnounce', () => {
  const avail = (version: string, manual = false): UpdateState => ({ kind: 'available', version, notes: '', manual });
  it('自动发现、这个版本没提示过才弹', () => {
    expect(shouldAnnounce(avail('0.1.4'), null)).toBe(true);
    expect(shouldAnnounce(avail('0.1.4'), '0.1.4')).toBe(false);
    expect(shouldAnnounce(avail('0.1.5'), '0.1.4')).toBe(true);
    expect(shouldAnnounce(avail('0.1.4', true), null)).toBe(false);
    expect(shouldAnnounce({ kind: 'latest' }, null)).toBe(false);
  });
});
