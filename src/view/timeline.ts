// 底部时间轴胶囊：前后按钮、刻度、年份 / 月份、黄色指示条。
// 刻度只在作品列表变化（或轨道宽度变得需要换刻度数）时重建；刻度的高度 / 颜色只在当前作品或它的系列变化时更新；
// 每帧只改指示条。
//
// 2026-11-17 针对几万幅的作品库：刻度数按轨道宽度封顶（engine/ticks.ts），作品多时一根刻度代表一段作品；
// 年份标签也会让位，不再叠在一起。
//
// 2026-11-17 新增：
// - 黄色指示条可以直接拖动（也是一个滑块，可用 ← → Home End PageUp PageDown 调）
// - 每个月的第一幅上方标月份（每年第一幅仍标年份），挤的时候月份自动让位
// - 前后箭头：左键移动一幅，右键移动到上 / 下一个月
//
// 2026-11-20：鼠标在胶囊上停一会儿，上方浮出每幅主色连成的色条（barcode.ts），点色条跳到那一幅
import type { Work } from '../data/types';
import { displayTitle } from '../data/series-ops';
import { lang, t } from '../i18n';
import { r3 } from '../engine/math';
import { indicator } from '../engine/mapping';
import { placeLabels, timelineLabels, type TimelineLabel } from '../engine/months';
import {
  bucketOf, bucketStart, tickCount, tickPosition, waveHeight, waveLift, waveSigma, waveStrength, WAVE_WAKE,
} from '../engine/ticks';
import { el, svgIcon, ICON_PREV, ICON_NEXT, Styled } from './dom';
import { ColorStrip } from './barcode';
import { color } from '../tokens';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export interface TimelineFrame {
  works: readonly Work[];
  cur: number;
  pos: number;
  vel: number;
  /** 标题或语言变了就加一，刻度的读屏标签跟着刷新 */
  labelsVersion: number;
  /** 当前作品所在系列的全部作品下标（含当前）；数组换了才重新标刻度 */
  members: readonly number[];
  /**
   * 同系列刻度的高亮色（2026-11-18）：当前作品所在系列的主题色；未归类传 null，用原来的灰色（--color-tick-series）
   */
  seriesColor: string | null;
}

export interface TimelineHandlers {
  go?: (index: number) => void;
  prev?: () => void;
  next?: () => void;
  /** 右键箭头：按月跳 */
  monthJump?: (dir: 1 | -1) => void;
  scrubStart?: () => void;
  /** 连续位置（幅） */
  scrubTo?: (pos: number) => void;
  scrubEnd?: () => void;
}

interface Tick {
  btn: HTMLButtonElement;
  mark: Styled;
}

export class Timeline {
  readonly root: HTMLElement;
  /** “下一幅”按钮：焦点顺序里缩略图排在它后面 */
  readonly nextButton: HTMLButtonElement;
  private track: HTMLElement;
  private ticks: Tick[] = [];
  private tickLayer: HTMLElement;
  private labelLayer: HTMLElement;
  private labels: TimelineLabel[] = [];
  private labelNodes: HTMLElement[] = [];
  private indPos: Styled;
  private indBar: Styled;
  private builtFor: readonly Work[] | null = null;
  private labelled = -1;
  private n = 0;
  /** 刻度根数：等于 n 时一幅一根，小于 n 时分段 */
  private m = 0;
  /** 上次标刻度时的当前段和系列成员（变了才重新标） */
  private markedCur = -1;
  private markedMembers: readonly number[] | null = null;
  /** 上次标同系列刻度用的颜色（undefined = 还没标过） */
  private markedColor: string | null | undefined = undefined;
  /** 刻度随滑块起伏（2026-11-18）：轨道宽度（px，缩放窗口时更新）、每根刻度的基础高度、现在被抬起来的刻度 */
  private trackW = 0;
  private baseH: number[] = [];
  private waved: number[] = [];
  private last: TimelineFrame | null = null;

  private scrub: { id: number; offset: number } | null = null;
  private strip: ColorStrip;

  constructor(public handlers: TimelineHandlers = {}) {
    const prev = el('button', {
      type: 'button', class: 'tl-step', 'data-i18n-aria': 'timeline.prev', 'data-i18n-title': 'timeline.prevTitle',
    }, [svgIcon(ICON_PREV, 18)]);
    const next = el('button', {
      type: 'button', class: 'tl-step', 'data-i18n-aria': 'timeline.next', 'data-i18n-title': 'timeline.nextTitle',
    }, [svgIcon(ICON_NEXT, 18)]);
    prev.addEventListener('click', () => this.handlers.prev?.());
    next.addEventListener('click', () => this.handlers.next?.());
    // 右键：按月跳（同时屏蔽默认的右键菜单）
    prev.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.handlers.monthJump?.(-1);
    });
    next.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.handlers.monthJump?.(1);
    });

    this.tickLayer = el('div', { class: 'tl-ticks' });
    this.labelLayer = el('div', { class: 'tl-labels', 'aria-hidden': 'true' });
    // 指示条：外层宽度等于轨道，用 translateX(百分比) 定位，不改 left；
    // 里面的黄条本身可以拖动，也是一个滑块
    const bar = el('div', {
      class: 'tl-indicator',
      role: 'slider',
      tabindex: 0,
      'data-i18n-aria': 'timeline.scrub',
      'aria-valuemin': 1,
    });
    const barPos = el('div', { class: 'tl-indicator-pos' }, [bar]);
    this.indPos = new Styled(barPos);
    this.indBar = new Styled(bar);
    this.track = el('div', { class: 'tl-track' }, [el('div', { class: 'tl-line' }), this.labelLayer, this.tickLayer, barPos]);
    this.root = el('nav', { class: 'timeline', 'data-i18n-aria': 'timeline.aria' }, [prev, this.track, next]);
    this.nextButton = next;
    // 色条（2026-11-20）：悬停一会儿浮在胶囊上方，每幅的主色连成一条；还没有主色（缩略图没到）的作品用芯片灰
    this.strip = new ColorStrip(
      this.root,
      this.track,
      (w) => (w.bg && w.bg !== color['color-chip'] ? w.bg : (w.swatches?.[0]?.hex ?? null)),
      (i) => this.handlers.go?.(i),
    );
    this.root.append(this.strip.root);

    bar.addEventListener('pointerdown', this.onBarDown);
    bar.addEventListener('pointermove', this.onBarMove);
    bar.addEventListener('pointerup', this.onBarUp);
    bar.addEventListener('pointercancel', this.onBarUp);
    bar.addEventListener('keydown', this.onBarKey);
    // 轨道宽度变了（窗口缩放）：重新决定哪些月份 / 年份标签放得下；刻度根数要变就重建刻度
    new ResizeObserver(() => {
      this.trackW = this.track.clientWidth;
      this.layoutLabels();
      this.strip.resize();
      if (this.builtFor && tickCount(this.n, this.track.clientWidth) !== this.m) {
        this.builtFor = null;
        if (this.last) this.render(this.last);
      }
    }).observe(this.track);
  }

  // ───────────── 指示条拖动 ─────────────

  private posFromX(clientX: number, offset: number): number {
    const r = this.track.getBoundingClientRect();
    const f = r.width > 0 ? (clientX - offset - r.left) / r.width : 0;
    return Math.max(0, Math.min(1, f)) * Math.max(0, this.n - 1);
  }

  private onBarDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.n < 2) return;
    e.preventDefault();
    const bar = this.indBar.el;
    const r = bar.getBoundingClientRect();
    // 记住抓住的位置和黄条中心的偏移，拖动时黄条不会跳一下
    this.scrub = { id: e.pointerId, offset: e.clientX - (r.left + r.width / 2) };
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {
      /* 指针已经抬起等情况，忽略 */
    }
    bar.classList.add('is-dragging');
    this.handlers.scrubStart?.();
  };

  private onBarMove = (e: PointerEvent): void => {
    if (!this.scrub || e.pointerId !== this.scrub.id) return;
    this.handlers.scrubTo?.(this.posFromX(e.clientX, this.scrub.offset));
  };

  private onBarUp = (e: PointerEvent): void => {
    if (!this.scrub || e.pointerId !== this.scrub.id) return;
    this.scrub = null;
    this.indBar.el.classList.remove('is-dragging');
    this.handlers.scrubEnd?.();
  };

  private onBarKey = (e: KeyboardEvent): void => {
    const h = this.handlers;
    const map: Record<string, (() => void) | undefined> = {
      ArrowLeft: h.prev,
      ArrowDown: h.prev,
      ArrowRight: h.next,
      ArrowUp: h.next,
      Home: () => h.go?.(0),
      End: () => h.go?.(this.n - 1),
      PageUp: () => h.monthJump?.(-1),
      PageDown: () => h.monthJump?.(1),
    };
    const act = map[e.key];
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  };

  // ───────────── 刻度和标签 ─────────────

  /**
   * 作品列表（或顺序、日期）变了、或轨道宽度变得要换刻度根数时调用。
   * 刻度数 m = min(作品数, 轨道宽 / 5px)：作品少时一幅一根，多了一根刻度代表一段连续的作品
   */
  private build(works: readonly Work[]): void {
    this.builtFor = works;
    this.labelled = -1;
    this.markedCur = -1;
    this.markedMembers = null;
    this.ticks = [];
    const n = (this.n = works.length);
    const trackPx = (this.trackW = this.track.clientWidth);
    const m = (this.m = tickCount(n, trackPx));
    this.baseH = new Array<number>(m).fill(8);
    this.waved = [];
    // 刻度按钮的点击区：刻度稀的时候 28px，密的时候缩到刻度间距，免得互相盖住
    const spacing = trackPx > 0 && m > 1 ? trackPx / (m - 1) : 28;
    const hitW = Math.max(6, Math.min(28, Math.floor(spacing)));
    const nodes: HTMLElement[] = [];
    for (let b = 0; b < m; b++) {
      const mark = el('span', { class: 'tl-mark' });
      const btn = el('button', { type: 'button', class: 'tl-tick' }, [mark]);
      btn.style.left = `${r3(tickPosition(b, n, m) * 100)}%`;
      btn.style.width = `${hitW}px`;
      btn.style.marginLeft = `${-hitW / 2}px`;
      // 分段时点刻度跳到这一段的第一幅
      btn.addEventListener('click', () => this.handlers.go?.(m === n ? b : bucketStart(b, n, m)));
      nodes.push(btn);
      this.ticks.push({ btn, mark: new Styled(mark) });
    }
    this.tickLayer.replaceChildren(...nodes);
    this.indBar.attr('aria-valuemax', String(n));
  }

  /** 刻度的读屏标签：一幅一根时是那一幅；分段时是这一段的日期范围和幅数 */
  private labelTicks(works: readonly Work[]): void {
    const n = this.n, m = this.m;
    const date = (w: Work | undefined) => w?.date || t('date.unknown');
    this.ticks.forEach((tk, b) => {
      if (m === n) {
        const w = works[b];
        tk.btn.setAttribute('aria-label', t('timeline.tick', { title: displayTitle(w), date: date(w) }));
      } else {
        const from = bucketStart(b, n, m), to = bucketStart(b + 1, n, m) - 1;
        tk.btn.setAttribute(
          'aria-label',
          t('timeline.tickRange', { from: date(works[from]), to: date(works[to]), n: to - from + 1 }),
        );
      }
    });
  }

  /**
   * 刻度的高低和颜色：当前那一幅（所在的段）最高、同系列（含同系列作品的段）中等、其余最低。
   * 只在当前段或系列成员变了时才改（最多几百根），不在每帧都走一遍
   */
  private markTicks(cur: number, members: readonly number[], color: string | null): void {
    const n = this.n, m = this.m;
    const curB = m === n ? cur : bucketOf(cur, n, m);
    if (curB === this.markedCur && members === this.markedMembers && color === this.markedColor) return;
    this.markedCur = curB;
    this.markedMembers = members;
    this.markedColor = color;
    // 同系列：系列的主题色；未归类：原来的灰色（CSS 变量，切换深浅色时不用重算）
    const seriesBg = color ?? 'var(--color-tick-series)';
    const same = new Set<number>();
    for (const i of members) same.add(m === n ? i : bucketOf(i, n, m));
    for (let b = 0; b < this.ticks.length; b++) {
      const isCur = b === curB;
      const inSeries = same.has(b);
      const mark = this.ticks[b].mark;
      const h = isCur ? 18 : inSeries ? 12 : 8;
      this.baseH[b] = h;
      mark.set('height', `${h}px`);
      mark.set('background', isCur ? 'var(--color-tick-current)' : inSeries ? seriesBg : 'var(--color-tick-other)');
    }
  }

  /**
   * 刻度随滑块起伏（2026-11-18，规则见 engine/ticks.ts 的 waveLift）：翻动时滑块附近的刻度鼓起一个小山包，跟着滑块走。
   * 只改山包范围里那几十根刻度的 transform（scaleY，不重排）；停下时强度跟着弹簧降到 0，抬起过的刻度复原。
   * 减少动态效果时不起伏
   */
  private renderWave(indLeft: number, vel: number, n: number): void {
    const m = this.ticks.length;
    const w = this.trackW;
    const strength = reducedMotion.matches ? 0 : waveStrength(vel);
    const next: number[] = [];
    if (m > 0 && w > 0 && strength > 0.01) {
      const spacing = m > 1 ? w / (m - 1) : w;
      const sigma = waveSigma(spacing);
      const x = indLeft * w;
      // 身后的山包最宽 (1 + WAVE_WAKE)σ，3 倍以外几乎为 0
      const reach = Math.ceil((sigma * (1 + WAVE_WAKE) * 3) / spacing) + 1;
      const center = Math.round(indLeft * (m - 1));
      const dir = Math.sign(vel);
      for (let b = Math.max(0, center - reach); b <= Math.min(m - 1, center + reach); b++) {
        const lift = waveLift(tickPosition(b, n, m) * w - x, sigma, strength, dir);
        if (lift < 0.25) continue;
        const base = this.baseH[b] ?? 8;
        this.ticks[b].mark.set('transform', `scaleY(${r3(waveHeight(base, lift) / base)})`);
        next.push(b);
      }
    }
    // 上一帧抬起来、这一帧不在山包里的：复原
    if (this.waved.length) {
      const keep = new Set(next);
      for (const b of this.waved) if (!keep.has(b)) this.ticks[b]?.mark.set('transform', 'none');
    }
    this.waved = next;
  }

  private leftOf(i: number, n: number): string {
    return `${r3(n > 1 ? (i / (n - 1)) * 100 : 50)}%`;
  }

  /** 年份 / 月份标签：作品列表或语言变了才重建 */
  private buildLabels(works: readonly Work[]): void {
    const n = works.length;
    this.labels = timelineLabels(works.map((w) => w.date), lang());
    this.labelNodes = this.labels.map((l) => {
      const s = el('span', { class: `tl-label tl-label--${l.kind}` }, [l.text]);
      s.style.left = this.leftOf(l.index, n);
      return s;
    });
    this.labelLayer.replaceChildren(...this.labelNodes);
    this.layoutLabels();
  }

  private layoutLabels(): void {
    if (!this.labels.length) return;
    const w = this.track.clientWidth;
    if (w <= 0) return;
    const n = Math.max(1, this.n - 1);
    const xs = this.labels.map((l) => (this.n > 1 ? (l.index / n) * w : w / 2));
    const show = placeLabels(this.labels, xs, 34, this.n);
    this.labelNodes.forEach((node, i) => node.classList.toggle('is-hidden', !show[i]));
  }

  render(f: TimelineFrame): void {
    this.last = f;
    const { works, cur } = f;
    if (this.builtFor !== works) this.build(works);
    if (this.labelled !== f.labelsVersion) {
      this.labelled = f.labelsVersion;
      this.labelTicks(works);
      this.buildLabels(works);
    }
    if (works.length) this.markTicks(cur, f.members, f.seriesColor);
    const ind = indicator(f.pos, works.length, f.vel);
    this.indPos.set('transform', `translateX(${r3(ind.left * 100)}%)`);
    // 宽度只在速度变化时以整数 px 变化，影响范围只有这一个绝对定位元素
    this.indBar.set('width', `${ind.width}px`);
    this.renderWave(ind.left, f.vel, works.length);
    this.strip.update(works, f.pos);
    // 滑块的读屏值（Styled 有缓存，值没变就不写 DOM）
    const w = works[cur];
    this.indBar.attr('aria-valuenow', String(cur + 1));
    this.indBar.attr('aria-valuetext', w ? t('timeline.scrubValue', { i: cur + 1, n: works.length, title: displayTitle(w) }) : '');
  }
}
