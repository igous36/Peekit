// 舞台：镜头容器 + 玻璃网格（40 格）+ 画作池 + 缩略图池。
// 节点只在构造时（缩略图池按需扩容）创建一次；render() 每帧只改 transform / opacity / filter 等。
// 卡片尺寸跟随画作比例：只在池子节点换了作品时改宽高，不在每帧改。
import type { Work } from '../data/types';
import { displayTitle } from '../data/series-ops';
import { t } from '../i18n';
import { r3, U, clamp } from '../engine/math';
import {
  RENDER_RANGE, GRID_W, GRID_H, paintingAt, collectSinker, tileCenter, tileEdgeFade, tileAvoid,
  tileOpacity, tileRadius, cameraScale, cameraTilt, thumbAt, artSize, thumbSize, shadowWeights, tileNeedsBackdrop,
  DEFAULT_ART, type Sinker, type PaintingInput, type ArtSize, type BackdropRect,
} from '../engine/mapping';
import { stage as S, GLASS_STRENGTH } from '../tokens';

/** 玻璃模糊半径（px），和 tokens 里 glass-blur 的算法一致 */
const GLASS_BLUR_PX = Math.round(12 + GLASS_STRENGTH * 20);
import { el, Styled } from './dom';
import { artKey, fillArt } from './art';
import { menuPoint } from './context-menu';

/** 同时在范围内的画作最多 6 幅（|d| ≤ 2.65），其中可见的最多 5 幅 */
const CARD_POOL = 6;

interface Slot {
  node: Styled<HTMLButtonElement>;
  canvas: HTMLElement;
  /** 画作的两层阴影（中间 / 侧边），缩略图没有 */
  shadowCenter: Styled | null;
  shadowSide: Styled | null;
  workId: string | null;
  /** 当前内容的身份（作品 + 图片地址 + 状态） */
  key: string;
  /** 当前尺寸对应的宽高比 */
  aspect: number;
  art: ArtSize;
  index: number;
  shown: boolean;
  /** GIF 动图层（叠在静态缩略图上面）和它当前的地址、是否在播放 */
  anim: HTMLImageElement;
  animSrc: string | null;
  animOn: boolean;
}

interface TileSlot {
  node: Styled;
  tx: number;
  ty: number;
  edge: number;
}

export interface StageFrame {
  works: readonly Work[];
  pos: number;
  posV: number;
  zoom: number;
  zoomV: number;
  press: number;
  /** 指针位置（u，相对窗口中心） */
  ox: number;
  oy: number;
  mot: number;
  cur: number;
  /** 这一页要显示的同系列缩略图（不含当前），按时间顺序；系列太长时分页，见 mapping.thumbPage */
  members: readonly number[];
  /** 上排张数（默认一半） */
  thumbTop?: number;
  /** 换页入场 0–1（Motion.pg），缩略图按 min(镜头, 它) 入场 */
  thumbIn?: number;
  /** 缩略图整排淡出系数 */
  fade: number;
  hoverThumb: string | null;
  /** 拖动锁轴后光标变成 grabbing */
  grabbing: boolean;
  /** 减少动态效果：关掉速度倾斜和镜头俯仰 */
  reduced: boolean;
  /** 已经解码好的原图（只给停留超过 300ms 的那一幅） */
  hiRes: { id: string; url: string } | null;
  /** 这一帧用动图的 GIF（作品 id → 已解码好的动图地址），画作和缩略图都用；不在里面的用静态缩略图 */
  anim?: ReadonlyMap<string, string>;
  /**
   * 中间那幅以外的 GIF 现在能不能播放：画面在动（拖动、甩动、推拉、放大缩小、翻页）时为 false，
   * 这时只有中间那幅在动，其余显示静态缩略图，停稳后再播放
   */
  animPlay?: boolean;
  /** 放大查看程度 0–1：中间那张由放大层接替，其他画作淡出 */
  mag: number;
  /** 全屏程度 0–1：到 1 时深色底已经盖满窗口，玻璃网格整个隐藏（省掉所有背景模糊） */
  fs: number;
  /** 被拖起（拖进情绪板，2026-11-18）的那幅：由拖起阵列的替身接替，这里按 alpha 淡出 / 淡回 */
  lifted?: { id: string; alpha: number } | null;
}

export interface StageHandlers {
  /** 点击画作 / 缩略图 */
  go?: (index: number, fromThumb: boolean) => void;
  thumbHover?: (workId: string | null) => void;
  /** 图片读取失败（original = 原图失败，可以退回缩略图） */
  artError?: (workId: string, original: boolean, src: string) => void;
  /** 右键（或菜单键）：index = 画作 / 缩略图对应的作品，舞台空白处为 −1；x / y 是菜单位置 */
  menu?: (index: number, x: number, y: number) => void;
}

const aspectOf = (w: Work): number => (w.width && w.height ? w.width / w.height : NaN);

export class StageView {
  readonly section: HTMLElement;
  private camera: Styled;
  private tiles: TileSlot[] = [];
  private cards: Slot[] = [];
  private thumbs: Slot[] = [];
  private sinkers: Sinker[] = [];
  /** 玻璃后、看得见的画作外框：只有它们附近的玻璃格需要背景模糊 */
  private behind: BackdropRect[] = [];
  private claimed: boolean[] = [];
  private grabbing = false;

  constructor(public handlers: StageHandlers = {}) {
    this.section = el('section', { class: 'stage', tabindex: 0, 'data-i18n-aria': 'stage.aria' });
    const camera = el('div', { class: 'camera' });
    this.camera = new Styled(camera);
    this.section.append(camera);
    // 右键：找到点中的画作 / 缩略图（池子节点上记着作品下标）
    this.section.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const hit = (e.target as Element).closest?.('.art, .thumb');
      const slot = hit ? [...this.cards, ...this.thumbs].find((s) => s.node.el === hit) : undefined;
      const p = menuPoint(e, hit ?? this.section);
      this.handlers.menu?.(slot ? slot.index : -1, p.x, p.y);
    });

    // 玻璃网格：祖先链上只有 transform，不能加 opacity / filter / mask（HANDOFF §2）
    const grid = el('div', { class: 'glass-grid', 'aria-hidden': 'true' });
    grid.style.width = U(GRID_W);
    grid.style.height = U(GRID_H);
    grid.style.marginLeft = U(-GRID_W / 2);
    grid.style.marginTop = U(-GRID_H / 2);
    grid.style.gap = U(S.tileGap);
    grid.style.gridTemplateColumns = `repeat(${S.gridCols}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${S.gridRows}, minmax(0, 1fr))`;
    for (let r = 0; r < S.gridRows; r++) {
      for (let c = 0; c < S.gridCols; c++) {
        const node = el('div', { class: 'glass-tile' });
        grid.append(node);
        const { tx, ty } = tileCenter(c, r);
        this.tiles.push({ node: new Styled(node), tx, ty, edge: tileEdgeFade(c, r) });
      }
    }
    camera.append(grid);

    for (let i = 0; i < CARD_POOL; i++) {
      const slot = this.makeSlot('art', false);
      camera.append(slot.node.el);
      this.cards.push(slot);
    }
  }

  private makeSlot(cls: 'art' | 'thumb', fromThumb: boolean): Slot {
    const canvas = el('span', { class: 'art-canvas' });
    let shadowCenter: Styled | null = null;
    let shadowSide: Styled | null = null;
    const children: HTMLElement[] = [];
    if (cls === 'art') {
      const c = el('span', { class: 'art-shadow art-shadow--center', 'aria-hidden': 'true' });
      const s = el('span', { class: 'art-shadow art-shadow--side', 'aria-hidden': 'true' });
      shadowCenter = new Styled(c);
      shadowSide = new Styled(s);
      children.push(c, s);
    }
    // GIF 动图层：叠在静态缩略图上面，只在“该动”时显示（见 setAnim）
    const anim = el('img', { class: 'art-anim', alt: '', draggable: 'false', decoding: 'async', 'aria-hidden': 'true' });
    children.push(canvas, anim);
    const btn = el('button', { type: 'button', class: cls, tabindex: -1 }, children);
    const slot: Slot = {
      node: new Styled(btn), canvas, shadowCenter, shadowSide,
      // aspect 初值 −1：第一次填充一定会设卡片尺寸（没有宽高信息的作品 aspect 是 NaN，NaN 和 NaN 算相同）
      workId: null, key: '', aspect: -1, art: DEFAULT_ART, index: -1, shown: true,
      anim, animSrc: null, animOn: false,
    };
    btn.addEventListener('click', () => {
      if (slot.index >= 0) this.handlers.go?.(slot.index, fromThumb);
    });
    this.hide(slot);
    return slot;
  }

  /** 当前可点、可 Tab 的缩略图（可见度 > 0.5），按上排、下排的顺序 */
  liveThumbs(): HTMLElement[] {
    return this.thumbs.filter((t) => t.index >= 0 && t.node.el.tabIndex === 0).map((t) => t.node.el);
  }

  private hide(slot: Slot): void {
    this.setAnim(slot, undefined, false);
    if (!slot.shown) return;
    slot.shown = false;
    slot.node.set('visibility', 'hidden');
    slot.node.set('pointer-events', 'none');
  }

  /**
   * GIF 动图层：url 是这一格该用的动图（没有就是不动），play 决定现在是否显示（显示才播放）。
   * 暂停只是把这一层藏起来：浏览器不画看不见的动图，就不会每帧重画卡片、重算它的滤镜和上面玻璃的背景模糊；
   * 静态缩略图一直垫在下面，不用拆掉重建 <img>。不再用的动图去掉地址，让浏览器回收
   */
  private setAnim(slot: Slot, url: string | undefined, play: boolean): void {
    const src = url ?? null;
    if (src !== slot.animSrc) {
      slot.animSrc = src;
      if (src) slot.anim.src = src;
      else slot.anim.removeAttribute('src');
    }
    const on = !!src && play;
    if (on !== slot.animOn) {
      slot.animOn = on;
      slot.anim.style.visibility = on ? 'visible' : 'hidden';
    }
  }

  /** 换作品 / 图片到位 / 读图失败时重新填充内容；比例变了才改卡片宽高 */
  private fill(slot: Slot, w: Work, src: string | undefined, sizeOf: (aspect: number) => ArtSize): void {
    slot.workId = w.id;
    const key = artKey(w, src);
    if (key !== slot.key) {
      slot.key = key;
      const original = src !== undefined && src !== w.thumb;
      fillArt(slot.canvas, w, src, () => this.handlers.artError?.(w.id, original, src ?? ''));
    }
    const aspect = aspectOf(w);
    if (!(aspect === slot.aspect || (Number.isNaN(aspect) && Number.isNaN(slot.aspect)))) {
      slot.aspect = aspect;
      const a = sizeOf(aspect);
      slot.art = a;
      const st = slot.node.el.style;
      st.width = U(a.w);
      st.height = U(a.h);
      st.marginLeft = U(-a.w / 2);
      st.marginTop = U(-a.h / 2);
    }
  }

  private ensureThumbs(count: number): void {
    const camera = this.camera.el;
    while (this.thumbs.length < count) {
      const slot = this.makeSlot('thumb', true);
      const btn = slot.node.el;
      btn.addEventListener('pointerenter', () => {
        if (slot.workId) this.handlers.thumbHover?.(slot.workId);
      });
      btn.addEventListener('pointerleave', () => this.handlers.thumbHover?.(null));
      camera.append(btn);
      this.thumbs.push(slot);
    }
  }

  render(f: StageFrame): void {
    const { works, pos } = f;
    const n = works.length;

    if (f.grabbing !== this.grabbing) {
      this.grabbing = f.grabbing;
      this.section.classList.toggle('is-grabbing', f.grabbing);
    }

    // 镜头
    const tilt = f.reduced ? 0 : cameraTilt(f.zoomV);
    this.camera.set('transform', `perspective(1800px) rotateX(${r3(tilt)}deg) scale(${r3(cameraScale(f.zoom))})`);

    // 画作：先给已经在池子里的作品保留原节点，再把空节点分给新进入范围的作品
    const inp: PaintingInput = {
      press: clamp(f.press, -0.2, 1.2),
      // 放大时不跟指针倾斜
      pxN: clamp(f.ox / 80, -1, 1) * (1 - clamp(f.mag, 0, 1)),
      pyN: clamp(f.oy / 50, -1, 1) * (1 - clamp(f.mag, 0, 1)),
      vel: f.reduced ? 0 : clamp(f.posV, -12, 12),
    };
    const lo = Math.max(0, Math.ceil(pos - RENDER_RANGE));
    const hi = Math.min(n - 1, Math.floor(pos + RENDER_RANGE));
    const sinkers = this.sinkers;
    sinkers.length = 0;
    const behind = this.behind;
    behind.length = 0;
    const claimed = this.claimed;
    claimed.length = 0;
    for (let i = 0; i < CARD_POOL; i++) claimed.push(false);
    const pending: number[] = [];
    for (let i = lo; i <= hi; i++) {
      const k = this.cards.findIndex((c, j) => !claimed[j] && c.workId === works[i].id);
      if (k >= 0) {
        claimed[k] = true;
        this.cards[k].index = i;
      } else pending.push(i);
    }
    for (const i of pending) {
      const k = claimed.indexOf(false);
      if (k < 0) break;
      claimed[k] = true;
      this.cards[k].index = i;
    }
    for (let k = 0; k < CARD_POOL; k++) {
      const slot = this.cards[k];
      if (!claimed[k]) {
        slot.index = -1;
        this.hide(slot);
        continue;
      }
      const i = slot.index;
      const w = works[i];
      const src = f.hiRes && f.hiRes.id === w.id ? f.hiRes.url : w.thumb;
      this.fill(slot, w, src, artSize);
      // GIF：中间那幅一直动（放大查看时由放大层接替）；其余只在画面停稳时动
      const isCur = i === f.cur;
      this.setAnim(slot, f.anim?.get(w.id), isCur ? f.mag < 0.001 : !!f.animPlay);
      const p = paintingAt(i - pos, inp, slot.art);
      if (!p) {
        this.hide(slot);
        continue;
      }
      collectSinker(p, sinkers);
      // 放大查看：中间那张交给放大层（这里隐藏），其他画作跟着淡出
      const mag = clamp(f.mag, 0, 1);
      let opacity = mag > 0.001 ? (i === f.cur ? 0 : p.opacity * (1 - mag)) : p.opacity;
      if (f.lifted && f.lifted.id === w.id) opacity *= clamp(f.lifted.alpha, 0, 1);
      if (opacity <= 0.001) {
        this.hide(slot);
        continue;
      }
      // z < 10 的画作在玻璃下面，会出现在玻璃格的背景里
      if (p.z < 10) behind.push({ x: p.x, y: p.y, hw: (slot.art.w / 2) * p.s, hh: (slot.art.h / 2) * p.s });
      const node = slot.node;
      if (!slot.shown) {
        slot.shown = true;
        node.set('visibility', 'visible');
      }
      node.set(
        'transform',
        `perspective(1400px) translate3d(${U(p.x)}, ${U(p.y)}, 0) rotateY(${r3(p.ry)}deg) rotateX(${r3(p.rx)}deg) scale(${r3(p.s)})`,
      );
      node.set('opacity', String(r3(opacity)));
      node.set(
        'filter',
        p.blur < 0.05 && p.brightness > 0.999 ? 'none' : `brightness(${r3(p.brightness)}) blur(${r3(p.blur)}px)`,
      );
      // 阴影：§7.1 的 sh 在中间（0.30）和侧边（0.16）两档之间线性变化，
      // 这里用两层固定阴影交叉淡入淡出来表达，只改透明度（合成层，不重绘）
      const sw = shadowWeights(Math.abs(i - pos));
      slot.shadowCenter!.set('opacity', String(r3(sw.center)));
      slot.shadowSide!.set('opacity', String(r3(sw.side)));
      node.set('z-index', String(p.z));
      node.set('pointer-events', opacity > 0.3 && mag < 0.5 ? 'auto' : 'none');
      const title = displayTitle(w);
      node.attr('aria-label', i === f.cur ? t('card.current', { title }) : t('card.view', { title }));
    }

    // 玻璃避让
    const mot = clamp(f.mot, 0, 1);
    // 背景模糊的影响范围（u）：玻璃模糊半径 + 画作自身最多 6px 模糊，再留 1u 余量
    const uPx = Math.min(window.innerHeight / 100, window.innerWidth * 0.006) || 1;
    const margin = (GLASS_BLUR_PX + 6) / uPx + 1;
    // 全屏：深色底已经盖满窗口，玻璃格全部隐藏（子元素单独写了 visibility，只能逐格设置）
    const gridOff = f.fs > 0.999;
    for (const tile of this.tiles) {
      const node = tile.node;
      if (gridOff) {
        node.set('visibility', 'hidden');
        continue;
      }
      const a = tileAvoid(tile.tx, tile.ty, sinkers, mot);
      // 完全让开的格子直接隐藏，省掉它的背景模糊（backdrop-filter）
      node.set('visibility', a.f > 0.98 ? 'hidden' : 'visible');
      // 背后只有纯色背景的格子关掉模糊：结果一样，省下一次模糊计算
      const blur = tileNeedsBackdrop(tile.tx, tile.ty, behind, margin) ? 'var(--glass-blur)' : 'none';
      node.set('backdrop-filter', blur);
      node.set('-webkit-backdrop-filter', blur);
      node.set('opacity', String(r3(tileOpacity(tile.edge, a.f))));
      node.set('border-radius', U(tileRadius(a.f)));
      if (a.f > 0.001) {
        node.set('transform', `scale(${r3(1 - a.f)})`);
        node.set('transform-origin', `${r3(a.ox)}% ${r3(a.oy)}%`);
      } else {
        node.set('transform', 'none');
      }
    }

    // 系列缩略图
    const zc = clamp(f.zoom, 0, 1);
    const count = f.members.length;
    if (count > 0 && zc > 0.001) this.ensureThumbs(count);
    for (let k = 0; k < this.thumbs.length; k++) {
      const slot = this.thumbs[k];
      if (k >= count) {
        slot.index = -1;
        this.hide(slot);
        continue;
      }
      const wi = f.members[k];
      const w = works[wi];
      slot.index = wi;
      const hov = f.hoverThumb === w.id;
      const tf = thumbAt(k, count, Math.min(zc, f.thumbIn ?? 1), f.fade, hov, f.thumbTop);
      if (tf.opacity <= 0.001) {
        this.hide(slot);
        slot.node.attr('tabindex', '-1');
        continue;
      }
      this.fill(slot, w, w.thumb, thumbSize);
      // 系列视图的缩略图：镜头停稳后才动（拉远 / 推回、翻页入场的过程中显示静态缩略图）
      this.setAnim(slot, f.anim?.get(w.id), !!f.animPlay && tf.e > 0.99);
      slot.node.attr('aria-label', t('thumb.view', { title: displayTitle(w), date: w.date || t('date.unknown') }));
      const node = slot.node;
      if (!slot.shown) {
        slot.shown = true;
        node.set('visibility', 'visible');
      }
      node.set('transform', `translate3d(${U(tf.x)}, ${U(tf.y)}, 0) scale(${r3(tf.s)})`);
      node.set('opacity', String(r3(tf.opacity)));
      node.set('filter', 1 - tf.e < 0.01 ? 'none' : `blur(${r3(tf.blur)}px)`);
      node.set('box-shadow', hov ? 'var(--shadow-thumb-hover)' : 'var(--shadow-thumb)');
      const live = tf.opacity > 0.5;
      node.set('pointer-events', live ? 'auto' : 'none');
      node.attr('tabindex', live ? '0' : '-1');
    }
  }
}
