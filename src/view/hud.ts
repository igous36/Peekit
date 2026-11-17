// 舞台之外、不在卡片里的界面元素：窗口拖动区、字标、镜头刻度、系列标题胶囊、操作提示、读屏播报区。
import { r3 } from '../engine/math';
import { t } from '../i18n';
import { el, svgIcon, ICON_PENCIL, Styled } from './dom';

export interface HudFrame {
  cur: number;
  n: number;
  /** clamp(zoom, 0, 1) */
  zc: number;
  /** 纵向拖动中才显示镜头刻度 */
  meterVisible: boolean;
  hintVisible: boolean;
  header: { name: string; color: string; count: number; opacity: number };
}

export interface HudHandlers {
  startEdit?: () => void;
}

export class Hud {
  readonly dragRegion: HTMLElement;
  readonly wordmark: HTMLElement;
  readonly meter: HTMLElement;
  readonly pill: HTMLElement;
  readonly hint: HTMLElement;
  readonly live: HTMLElement;

  private index: Styled;
  private meterEl: Styled;
  private meterFill: Styled;
  private pillEl: Styled;
  private pillDot: Styled;
  private pillName: Styled;
  private pillCount: Styled;
  private pillEdit: Styled;
  private pillNote: Styled;
  private hintEl: Styled;
  private liveEl: Styled;

  constructor(public handlers: HudHandlers = {}) {
    this.dragRegion = el('div', { class: 'drag-region', 'data-tauri-drag-region': true, 'aria-hidden': 'true' });

    const idx = el('span', { class: 'wordmark-index' });
    this.wordmark = el('div', { class: 'wordmark' }, [el('span', { class: 'wordmark-name', 'data-i18n': 'app.name' }), idx]);
    this.index = new Styled(idx);

    const fill = el('div', { class: 'meter-fill' });
    this.meter = el('div', { class: 'zoom-meter', 'aria-hidden': 'true' }, [
      el('span', { 'data-i18n': 'meter.near' }),
      el('div', { class: 'meter-track' }, [fill]),
      el('span', { 'data-i18n': 'meter.far' }),
    ]);
    this.meterEl = new Styled(this.meter);
    this.meterFill = new Styled(fill);

    const dot = el('span', { class: 'dot' });
    const name = el('span', { class: 'pill-name' });
    const count = el('span', { class: 'pill-count' });
    const edit = el('button', { type: 'button', class: 'icon-btn', 'data-i18n-aria': 'info.edit' }, [svgIcon(ICON_PENCIL, 16)]);
    edit.addEventListener('click', () => this.handlers.startEdit?.());
    // HANDOFF §8：系列只有 1 幅时，胶囊旁边写一行小字（绝对定位在胶囊右侧，不影响胶囊居中）
    const note = el('span', { class: 'pill-note', 'data-i18n': 'pill.single' });
    this.pill = el('div', { class: 'series-pill' }, [dot, name, count, edit, note]);
    this.pillEl = new Styled(this.pill);
    this.pillDot = new Styled(dot);
    this.pillName = new Styled(name);
    this.pillCount = new Styled(count);
    this.pillEdit = new Styled(edit);
    this.pillNote = new Styled(note);

    this.hint = el('div', { class: 'hint', 'aria-hidden': 'true' }, [
      el('span', { 'data-i18n': 'hint.browse' }),
      el('span', { 'data-i18n': 'hint.zoom' }),
    ]);
    this.hintEl = new Styled(this.hint);

    this.live = el('div', { class: 'sr-only', 'aria-live': 'polite' });
    this.liveEl = new Styled(this.live);
  }

  render(f: HudFrame): void {
    this.index.text(`${String(f.cur + 1).padStart(2, '0')} / ${String(f.n).padStart(2, '0')}`);

    this.meterEl.set('opacity', f.meterVisible ? '1' : '0');
    // 竖条填充用 translateY 而不是 height，避免每帧重排
    this.meterFill.set('transform', `translateY(${r3((f.zc - 1) * 100)}%)`);

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

    this.hintEl.set('opacity', f.hintVisible ? '1' : '0');
  }

  /** 切换作品时给读屏软件播报 */
  announce(text: string): void {
    this.liveEl.text(text);
  }
}
