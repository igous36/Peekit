// 底部时间轴胶囊：前后按钮、刻度、年份 / 月份、黄色指示条。
// 刻度只在作品列表变化时重建；每帧只改刻度的高度 / 颜色（有缓存）和指示条。
//
// 2026-11-17 新增：
// - 黄色指示条可以直接拖动（也是一个滑块，可用 ← → Home End PageUp PageDown 调）
// - 每个月的第一幅上方标月份（每年第一幅仍标年份），挤的时候月份自动让位
// - 前后箭头：左键移动一幅，右键移动到上 / 下一个月
import type { Work } from '../data/types';
import { displayTitle } from '../data/series-ops';
import { lang, t } from '../i18n';
import { r3 } from '../engine/math';
import { indicator } from '../engine/mapping';
import { placeLabels, timelineLabels, type TimelineLabel } from '../engine/months';
import { el, svgIcon, ICON_PREV, ICON_NEXT, Styled } from './dom';

export interface TimelineFrame {
  works: readonly Work[];
  cur: number;
  pos: number;
  vel: number;
  /** 标题或语言变了就加一，刻度的读屏标签跟着刷新 */
  labelsVersion: number;
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

  private scrub: { id: number; offset: number } | null = null;

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

    bar.addEventListener('pointerdown', this.onBarDown);
    bar.addEventListener('pointermove', this.onBarMove);
    bar.addEventListener('pointerup', this.onBarUp);
    bar.addEventListener('pointercancel', this.onBarUp);
    bar.addEventListener('keydown', this.onBarKey);
    // 轨道宽度变了（窗口缩放）就重新决定哪些月份标签放得下
    new ResizeObserver(() => this.layoutLabels()).observe(this.track);
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

  /** 作品列表（或顺序、日期）变了才调用 */
  private build(works: readonly Work[]): void {
    this.builtFor = works;
    this.labelled = -1;
    this.ticks = [];
    this.n = works.length;
    const n = works.length;
    const nodes: HTMLElement[] = [];
    works.forEach((_, i) => {
      const mark = el('span', { class: 'tl-mark' });
      const btn = el('button', { type: 'button', class: 'tl-tick' }, [mark]);
      btn.style.left = this.leftOf(i, n);
      btn.addEventListener('click', () => this.handlers.go?.(i));
      nodes.push(btn);
      this.ticks.push({ btn, mark: new Styled(mark) });
    });
    this.tickLayer.replaceChildren(...nodes);
    this.indBar.attr('aria-valuemax', String(n));
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
    const show = placeLabels(this.labels, xs);
    this.labelNodes.forEach((node, i) => node.classList.toggle('is-hidden', !show[i]));
  }

  render(f: TimelineFrame): void {
    const { works, cur } = f;
    if (this.builtFor !== works) this.build(works);
    if (this.labelled !== f.labelsVersion) {
      this.labelled = f.labelsVersion;
      works.forEach((w, i) => {
        this.ticks[i].btn.setAttribute(
          'aria-label',
          t('timeline.tick', { title: displayTitle(w), date: w.date || t('date.unknown') }),
        );
      });
      this.buildLabels(works);
    }
    const curSeries = works[cur]?.series;
    for (let i = 0; i < this.ticks.length; i++) {
      const isCur = i === cur;
      const same = works[i].series === curSeries;
      const m = this.ticks[i].mark;
      m.set('height', `${isCur ? 18 : same ? 12 : 8}px`);
      // 用 CSS 变量而不是具体颜色：切换深浅色时不用等下一帧重算
      m.set('background', isCur ? 'var(--color-tick-current)' : same ? 'var(--color-tick-series)' : 'var(--color-tick-other)');
    }
    const ind = indicator(f.pos, works.length, f.vel);
    this.indPos.set('transform', `translateX(${r3(ind.left * 100)}%)`);
    // 宽度只在速度变化时以整数 px 变化，影响范围只有这一个绝对定位元素
    this.indBar.set('width', `${ind.width}px`);
    // 滑块的读屏值（Styled 有缓存，值没变就不写 DOM）
    const w = works[cur];
    this.indBar.attr('aria-valuenow', String(cur + 1));
    this.indBar.attr('aria-valuetext', w ? t('timeline.scrubValue', { i: cur + 1, n: works.length, title: displayTitle(w) }) : '');
  }
}
