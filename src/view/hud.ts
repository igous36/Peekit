// 舞台之外、不在卡片里的界面元素：窗口拖动区、字标、镜头刻度、系列标题胶囊、操作提示、读屏播报区。
import { r3 } from '../engine/math';
import { t } from '../i18n';
import { el, svgIcon, ICON_NEXT, ICON_PENCIL, ICON_PREV, Styled } from './dom';
import { Counter } from './counter';
import { markSvg, PEEKIT, WORDMARK_HEIGHT, writeMark } from './wordmark';

export interface HudFrame {
  cur: number;
  n: number;
  /** 连续位置（拖动 / 动画中有小数，拖过头会出界）：计数圆环的进度和“到头了”提示用 */
  pos: number;
  /** 正在左右翻动：计数圆环的颜色、泛光快速跟（2026-11-18） */
  flipping: boolean;
  /** clamp(zoom, 0, 1) */
  zc: number;
  /** 镜头档位 −1 放大 / 0 单幅 / 1 系列视图（连续值），左侧刻度用 */
  level: number;
  /** 纵向拖动中才显示镜头刻度 */
  meterVisible: boolean;
  hintVisible: boolean;
  /** page / pages：系列视图缩略图的分页（pages = 1 时不显示翻页） */
  header: { name: string; color: string; count: number; opacity: number; page: number; pages: number };
}

export interface HudHandlers {
  startEdit?: () => void;
  /** 系列缩略图翻页 */
  pagePrev?: () => void;
  pageNext?: () => void;
  /** 右键系列胶囊：删除系列的菜单 */
  seriesMenu?: (x: number, y: number) => void;
}

export class Hud {
  readonly dragRegion: HTMLElement;
  readonly wordmark: HTMLElement;
  /** 预览集胶囊放这里 */
  readonly setSlot: HTMLElement;
  readonly meter: HTMLElement;
  readonly pill: HTMLElement;
  readonly hint: HTMLElement;
  readonly live: HTMLElement;
  /** 左上角的计数：主题色圆环 / 文字（2026-11-18，counter.ts） */
  readonly counter: Counter;
  /** 手写字标「Peekit」 */
  private mark: SVGSVGElement;

  private meterEl: Styled;
  private meterFill: Styled;
  private meterKnob: Styled;
  private pillEl: Styled;
  private pillDot: Styled;
  private pillName: Styled;
  private pillCount: Styled;
  private pillEdit: Styled;
  private pillNote: Styled;
  private pager: Styled;
  private pageText: Styled;
  private pagePrevBtn: Styled<HTMLButtonElement>;
  private pageNextBtn: Styled<HTMLButtonElement>;
  private hintEl: Styled;
  private liveEl: Styled;

  constructor(public handlers: HudHandlers = {}) {
    this.dragRegion = el('div', { class: 'drag-region', 'data-tauri-drag-region': true, 'aria-hidden': 'true' });

    // 字标一行：Peekit · 预览集胶囊（由 App 插到 slot 里）· 计数
    // 2026-11-18：Peekit 从文字换成手写字标 SVG（view/wordmark.ts）
    this.counter = new Counter();
    this.setSlot = el('span', { class: 'wordmark-slot' });
    this.mark = markSvg(PEEKIT, WORDMARK_HEIGHT, 'wordmark-name');
    this.wordmark = el('div', { class: 'wordmark' }, [
      this.mark,
      this.setSlot,
      this.counter.root,
    ]);

    // 左侧刻度（2026-11-17 改成三档）：上 = 放大，中间刻线 = 单幅，下 = 系列视图；
    // 黄点跟着当前档位走，竖条从中间往上 / 往下长
    const fill = el('div', { class: 'meter-fill' });
    const knob = el('div', { class: 'meter-knob-pos' }, [el('span', { class: 'meter-knob' })]);
    this.meter = el('div', { class: 'zoom-meter', 'aria-hidden': 'true' }, [
      el('span', { 'data-i18n': 'meter.near' }),
      el('div', { class: 'meter-track' }, [el('span', { class: 'meter-mid' }), fill, knob]),
      el('span', { 'data-i18n': 'meter.far' }),
    ]);
    this.meterEl = new Styled(this.meter);
    this.meterFill = new Styled(fill);
    this.meterKnob = new Styled(knob);

    const dot = el('span', { class: 'dot' });
    const name = el('span', { class: 'pill-name' });
    const count = el('span', { class: 'pill-count' });
    const edit = el('button', { type: 'button', class: 'icon-btn', 'data-i18n-aria': 'info.edit' }, [svgIcon(ICON_PENCIL, 16)]);
    edit.addEventListener('click', () => this.handlers.startEdit?.());
    // HANDOFF §8：系列只有 1 幅时，胶囊旁边写一行小字（绝对定位在胶囊右侧，不影响胶囊居中）
    const note = el('span', { class: 'pill-note', 'data-i18n': 'pill.single' });
    // 系列太长、缩略图分页时：胶囊里加“‹ 2 / 5 ›”（2026-11-17 新增）
    const prev = el('button', { type: 'button', class: 'icon-btn pill-page-btn', 'data-i18n-aria': 'pill.pagePrev' }, [
      svgIcon(ICON_PREV, 14),
    ]);
    const next = el('button', { type: 'button', class: 'icon-btn pill-page-btn', 'data-i18n-aria': 'pill.pageNext' }, [
      svgIcon(ICON_NEXT, 14),
    ]);
    prev.addEventListener('click', () => this.handlers.pagePrev?.());
    next.addEventListener('click', () => this.handlers.pageNext?.());
    const pageText = el('span', { class: 'pill-page-text' });
    const pager = el('span', { class: 'pill-pager' }, [prev, pageText, next]);
    this.pill = el('div', { class: 'series-pill' }, [dot, name, count, pager, edit, note]);
    this.pill.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const r = this.pill.getBoundingClientRect();
      this.handlers.seriesMenu?.(e.clientX || r.left + 18, e.clientY || r.bottom);
    });
    this.pager = new Styled(pager);
    this.pageText = new Styled(pageText);
    this.pagePrevBtn = new Styled(prev);
    this.pageNextBtn = new Styled(next);
    this.pillEl = new Styled(this.pill);
    this.pillDot = new Styled(dot);
    this.pillName = new Styled(name);
    this.pillCount = new Styled(count);
    this.pillEdit = new Styled(edit);
    this.pillNote = new Styled(note);

    this.hint = el('div', { class: 'hint', 'aria-hidden': 'true' }, [
      el('span', { 'data-i18n': 'hint.browse' }),
      el('span', { 'data-i18n': 'hint.zoom' }),
      el('span', { 'data-i18n': 'hint.magnify' }),
      el('span', { 'data-i18n': 'hint.lift' }),
    ]);
    this.hintEl = new Styled(this.hint);

    this.live = el('div', { class: 'sr-only', 'aria-live': 'polite' });
    this.liveEl = new Styled(this.live);
  }

  /** 从情绪板回到预览：等情绪板（连同 Mood boards 字标）淡出，Peekit 按笔顺写出来 */
  writeWordmark(delay?: number): void {
    writeMark(this.mark, PEEKIT, delay);
  }

  render(f: HudFrame): void {
    this.counter.render(f.pos, f.cur, f.n, f.flipping);

    this.meterEl.set('opacity', f.meterVisible ? '1' : '0');
    // 都用 transform，不改高度 / 位置，避免每帧重排：
    // 竖条以中点为原点 scaleY（负数就往上长），黄点的外层和轨道一样高，translateY(±50%) 正好到两端
    const l = Math.max(-1, Math.min(1, f.level));
    this.meterFill.set('transform', `scaleY(${r3(l)})`);
    this.meterKnob.set('transform', `translateY(${r3(l * 50)}%)`);

    const h = f.header;
    this.pillDot.set('background', h.color);
    this.pillName.text(h.name);
    this.pillCount.text(t('pill.count', { n: h.count }));
    this.pillEl.set('opacity', String(r3(h.opacity)));
    this.pillEl.set('transform', `translate(-50%, calc(-100% + ${r3((1 - h.opacity) * 12)}px))`);
    const live = h.opacity > 0.5;
    this.pillEl.set('pointer-events', live ? 'auto' : 'none');
    this.pillEl.attr('aria-hidden', live ? 'false' : 'true');
    // 胶囊隐藏时铅笔按钮不能被 Tab 到
    this.pillEdit.attr('tabindex', live ? '0' : '-1');
    this.pillNote.set('display', h.count === 1 ? 'inline' : 'none');
    const paged = h.pages > 1;
    this.pager.set('display', paged ? 'inline-flex' : 'none');
    if (paged) {
      this.pageText.text(`${h.page + 1} / ${h.pages}`);
      this.pagePrevBtn.el.disabled = h.page <= 0;
      this.pageNextBtn.el.disabled = h.page >= h.pages - 1;
      this.pagePrevBtn.attr('tabindex', live ? '0' : '-1');
      this.pageNextBtn.attr('tabindex', live ? '0' : '-1');
    }

    this.hintEl.set('opacity', f.hintVisible ? '1' : '0');
  }

  /** 切换作品时给读屏软件播报 */
  announce(text: string): void {
    this.liveEl.text(text);
  }
}
