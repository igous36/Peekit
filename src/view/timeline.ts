// 底部时间轴胶囊：前后按钮、刻度、年份、黄色指示条。
// 刻度只在作品列表变化时重建；每帧只改刻度的高度 / 颜色（有缓存）和指示条。
import type { Work } from '../data/types';
import { displayTitle } from '../data/series-ops';
import { t } from '../i18n';
import { r3 } from '../engine/math';
import { indicator } from '../engine/mapping';
import { color } from '../tokens';
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
  private indPos: Styled;
  private indBar: Styled;
  private builtFor: readonly Work[] | null = null;
  private labelled = -1;

  constructor(public handlers: TimelineHandlers = {}) {
    const prev = el('button', { type: 'button', class: 'tl-step', 'data-i18n-aria': 'timeline.prev' }, [svgIcon(ICON_PREV, 18)]);
    const next = el('button', { type: 'button', class: 'tl-step', 'data-i18n-aria': 'timeline.next' }, [svgIcon(ICON_NEXT, 18)]);
    prev.addEventListener('click', () => this.handlers.prev?.());
    next.addEventListener('click', () => this.handlers.next?.());

    this.tickLayer = el('div', { class: 'tl-ticks' });
    // 指示条：外层宽度等于轨道，用 translateX(百分比) 定位，不改 left
    const bar = el('div', { class: 'tl-indicator' });
    const barPos = el('div', { class: 'tl-indicator-pos', 'aria-hidden': 'true' }, [bar]);
    this.indPos = new Styled(barPos);
    this.indBar = new Styled(bar);
    this.track = el('div', { class: 'tl-track' }, [el('div', { class: 'tl-line' }), this.tickLayer, barPos]);
    this.root = el('nav', { class: 'timeline', 'data-i18n-aria': 'timeline.aria' }, [prev, this.track, next]);
    this.nextButton = next;
  }

  /** 作品列表（或顺序、日期）变了才调用 */
  private build(works: readonly Work[]): void {
    this.builtFor = works;
    this.labelled = -1;
    this.ticks = [];
    const n = works.length;
    const nodes: HTMLElement[] = [];
    let lastYear = '';
    works.forEach((w, i) => {
      const left = `${r3(n > 1 ? (i / (n - 1)) * 100 : 50)}%`;
      const mark = el('span', { class: 'tl-mark' });
      const btn = el('button', { type: 'button', class: 'tl-tick' }, [mark]);
      btn.style.left = left;
      btn.addEventListener('click', () => this.handlers.go?.(i));
      nodes.push(btn);
      const yr = w.date.slice(0, 4);
      if (yr && yr !== lastYear) {
        const y = el('span', { class: 'tl-year', 'aria-hidden': 'true' }, [yr]);
        y.style.left = left;
        nodes.push(y);
      }
      lastYear = yr;
      this.ticks.push({ btn, mark: new Styled(mark) });
    });
    this.tickLayer.replaceChildren(...nodes);
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
    }
    const curSeries = works[cur]?.series;
    for (let i = 0; i < this.ticks.length; i++) {
      const isCur = i === cur;
      const same = works[i].series === curSeries;
      const m = this.ticks[i].mark;
      m.set('height', `${isCur ? 18 : same ? 12 : 8}px`);
      m.set('background', isCur ? color['color-tick-current'] : same ? color['color-tick-series'] : color['color-tick-other']);
    }
    const ind = indicator(f.pos, works.length, f.vel);
    this.indPos.set('transform', `translateX(${r3(ind.left * 100)}%)`);
    // 宽度只在速度变化时以整数 px 变化，影响范围只有这一个绝对定位元素
    this.indBar.set('width', `${ind.width}px`);
  }
}
