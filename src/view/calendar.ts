// 创作年历（2026-11-20）：整页盖在舞台上（和情绪板一样），统计在 engine/calendar.ts。
//
//   ‹ 预览 │ 创作年历   ‹ 2025 ›                                  [导出图片]
//
//   2025                                     ← 大号年份
//   [128 幅作品] [96 天在画画] [12 天 最长连续] [6月 最多产的月份]
//   ┌ 热力图：一列一周、一行一个星期几，颜色越黄这天画得越多；悬停看幅数，点格子跳到那天的作品 ┐
//   ┌ 每个月 ┐ ┌ 这一年的颜色 ┐
//   ┌ 最常画的系列 ┐
//
// 内容在打开、换年份、窗口变宽变窄时重建（用户操作时，不在每帧）。
import type { Work } from '../data/types';
import { lang, t } from '../i18n';
import { monthLabel } from '../engine/months';
import {
  dayKey, firstDayOfWeek, heatLevel, workDay, yearGrid, yearStats, yearsOf, type YearStats,
} from '../engine/calendar';
import { langTag } from '../i18n';
import { el, svgIcon, ICON_DOWNLOAD, ICON_NEXT, ICON_PREV } from './dom';

export interface CalendarHost {
  /** 当前预览集的全部作品（不受星级 / 颜色筛选影响） */
  works: () => readonly Work[];
  setName: () => string;
  series: (id: string) => { name: string; color: string };
  /** 一幅的主色组成（没有就用主色），算这一年的颜色 */
  colorsOf: (w: Work) => { hex: string; share: number }[] | null;
  /** 还没分析过颜色的作品有几幅；analyze 把它们补齐（完成后会重画） */
  missingColors: (works: readonly Work[]) => number;
  analyzeColors: (works: readonly Work[]) => Promise<void>;
  /** 跳到某一幅（关掉年历） */
  go: (w: Work) => void;
  close: () => void;
  /** 把这一年导出成一张图 */
  exportYear: (stats: YearStats, works: readonly Work[]) => void;
}

export class CalendarView {
  readonly root: HTMLElement;
  private scroll: HTMLElement;
  private yearLabel: HTMLElement;
  private prevYear: HTMLButtonElement;
  private nextYear: HTMLButtonElement;
  private tip: HTMLElement;
  private year = 0;
  private years: number[] = [];
  private stats: YearStats | null = null;
  private works: readonly Work[] = [];
  private open = false;
  private returnFocus: HTMLElement | null = null;

  constructor(private host: CalendarHost) {
    const back = el('button', { type: 'button', class: 'board-back', 'data-i18n-title': 'board.back', 'data-i18n-aria': 'board.back' }, [
      svgIcon(ICON_PREV, 16), el('span', { 'data-i18n': 'board.backShort' }),
    ]);
    back.addEventListener('click', () => this.host.close());
    this.prevYear = el('button', { type: 'button', class: 'icon-btn cal-year-btn', 'data-i18n-aria': 'calendar.prevYear' }, [svgIcon(ICON_PREV, 16)]);
    this.nextYear = el('button', { type: 'button', class: 'icon-btn cal-year-btn', 'data-i18n-aria': 'calendar.nextYear' }, [svgIcon(ICON_NEXT, 16)]);
    this.yearLabel = el('span', { class: 'cal-year-label' });
    this.prevYear.addEventListener('click', () => this.stepYear(-1));
    this.nextYear.addEventListener('click', () => this.stepYear(1));
    const exportBtn = el('button', { type: 'button', class: 'cal-export' }, [svgIcon(ICON_DOWNLOAD, 16), el('span', { 'data-i18n': 'calendar.export' })]);
    exportBtn.addEventListener('click', () => {
      if (this.stats) this.host.exportYear(this.stats, this.works);
    });
    const bar = el('div', { class: 'board-bar cal-bar' }, [
      back,
      el('span', { class: 'board-bar-sep', 'aria-hidden': 'true' }),
      el('h1', { class: 'cal-title', 'data-i18n': 'calendar.title' }),
      el('span', { class: 'cal-year' }, [this.prevYear, this.yearLabel, this.nextYear]),
    ]);
    this.scroll = el('div', { class: 'cal-scroll' });
    this.tip = el('div', { class: 'cal-tip', 'aria-hidden': 'true' });
    this.root = el('section', { class: 'calendar', hidden: true, 'data-i18n-aria': 'calendar.title' }, [
      this.scroll,
      el('div', { class: 'board-drag', 'data-tauri-drag-region': '' }),
      bar,
      exportBtn,
      this.tip,
    ]);
    // 捕获阶段：年历开着时 Esc 回到预览，←/→ 换年份（不让舞台收到）
    document.addEventListener('keydown', (e) => {
      if (!this.open || e.defaultPrevented) return;
      const tg = e.target as HTMLElement | null;
      if (tg instanceof HTMLInputElement || tg?.closest?.('.menu-panel, .ctx-menu, .about-dialog, .palette')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.host.close();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !tg?.closest?.('.cal-heat')) {
        e.preventDefault();
        e.stopPropagation();
        this.stepYear(e.key === 'ArrowLeft' ? -1 : 1);
      }
    }, true);
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      if (!this.open) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => this.build(), 120);
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 打开：默认看最近有作品的一年 */
  show(): void {
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.works = this.host.works();
    this.years = yearsOf(this.works);
    this.year = this.years[0] ?? new Date().getFullYear();
    this.open = true;
    this.root.hidden = false;
    void this.root.offsetWidth;
    this.root.classList.add('is-open');
    this.build();
    this.scroll.scrollTop = 0;
    this.prevYear.focus({ preventScroll: true });
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    this.tip.classList.remove('is-shown');
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  }

  /** 作品库或颜色变了（补算完颜色、换了预览集）：开着就重建 */
  refresh(): void {
    if (!this.open) return;
    this.works = this.host.works();
    this.years = yearsOf(this.works);
    if (!this.years.includes(this.year) && this.years.length) this.year = this.years[0];
    this.build();
  }

  private stepYear(dir: -1 | 1): void {
    // years 从新到旧：往左是更早的一年
    const i = this.years.indexOf(this.year);
    const j = i - dir;
    if (i < 0 || j < 0 || j >= this.years.length) return;
    this.year = this.years[j];
    this.build();
  }

  private build(): void {
    const works = this.works;
    const stats = (this.stats = yearStats(works, this.year, (i) => this.host.colorsOf(works[i])));
    const i = this.years.indexOf(this.year);
    this.yearLabel.textContent = String(this.year);
    this.prevYear.disabled = i < 0 || i >= this.years.length - 1;
    this.nextYear.disabled = i <= 0;
    const L = lang();
    const fmt = new Intl.NumberFormat(langTag(L));

    if (!stats.total) {
      this.scroll.replaceChildren(el('div', { class: 'cal-empty' }, [t('calendar.empty')]));
      return;
    }

    const hero = el('div', { class: 'cal-hero' }, [
      el('p', { class: 'cal-hero-year' }, [String(this.year)]),
      el('p', { class: 'cal-hero-sub' }, [t('calendar.subtitle', { set: this.host.setName(), n: fmt.format(stats.total) })]),
    ]);
    const tile = (value: string, label: string, sub = '') =>
      el('div', { class: 'cal-stat' }, [
        el('p', { class: 'cal-stat-value' }, [value]),
        el('p', { class: 'cal-stat-label' }, [label]),
        ...(sub ? [el('p', { class: 'cal-stat-sub' }, [sub])] : []),
      ]);
    const fmtDay = (k: string) => k.replace(/-/g, '.');
    const stats4 = el('div', { class: 'cal-stats' }, [
      tile(fmt.format(stats.total), t('calendar.statWorks')),
      tile(fmt.format(stats.activeDays), t('calendar.statDays')),
      tile(
        t('calendar.days', { n: stats.streak?.days ?? 0 }),
        t('calendar.statStreak'),
        stats.streak && stats.streak.days > 1 ? `${fmtDay(stats.streak.from)} – ${fmtDay(stats.streak.to)}` : '',
      ),
      tile(
        stats.busiestMonth >= 0 ? monthLabel(stats.busiestMonth + 1, L) : '–',
        t('calendar.statMonth'),
        stats.busiestMonth >= 0 ? t('pill.count', { n: stats.months[stats.busiestMonth] }) : '',
      ),
    ]);

    this.scroll.replaceChildren(
      el('div', { class: 'cal-page' }, [
        hero,
        stats4,
        this.heatCard(stats),
        el('div', { class: 'cal-row' }, [this.monthsCard(stats), this.colorsCard(stats)]),
        this.seriesCard(stats),
      ]),
    );
  }

  // ───────────── 热力图 ─────────────

  private heatCard(stats: YearStats): HTMLElement {
    const L = lang();
    const first = firstDayOfWeek(langTag(L));
    const grid = yearGrid(this.year, first);
    // 格子大小按页面宽度：53 列铺满卡片
    const avail = Math.min(1040, window.innerWidth - 96) - 48 - 36;
    const gap = 3;
    const cell = Math.max(9, Math.min(17, Math.floor(avail / grid.cols) - gap));
    const step = cell + gap;
    const max = stats.busiestDay?.count ?? 0;

    const cells = el('div', { class: 'cal-heat-cells' });
    cells.style.width = `${grid.cols * step - gap}px`;
    cells.style.height = `${7 * step - gap}px`;
    for (const c of grid.cells) {
      const n = stats.days.get(c.key)?.length ?? 0;
      const d = el('span', { class: `cal-cell lv-${heatLevel(n, max)}`, 'data-key': c.key });
      d.style.left = `${c.col * step}px`;
      d.style.top = `${c.row * step}px`;
      d.style.width = d.style.height = `${cell}px`;
      cells.append(d);
    }
    // 月份标签：每个月第一天所在的列；挤的时候（和前一个不到 3 列）不标
    const months = el('div', { class: 'cal-heat-months', 'aria-hidden': 'true' });
    months.style.width = cells.style.width;
    let lastCol = -9;
    grid.monthCols.forEach((col, m) => {
      if (col - lastCol < 3) return;
      lastCol = col;
      const s = el('span', {}, [monthLabel(m + 1, L)]);
      s.style.left = `${col * step}px`;
      months.append(s);
    });
    // 星期几：只标第 1、3、5 行，免得太密
    const wd = new Intl.DateTimeFormat(langTag(L), { weekday: 'short', timeZone: 'UTC' });
    const weekdays = el('div', { class: 'cal-heat-weekdays', 'aria-hidden': 'true' });
    for (const row of [0, 2, 4]) {
      // 2024-01-01 是周一（ISO 1）
      const iso = ((first - 1 + row) % 7) + 1;
      const s = el('span', {}, [wd.format(new Date(Date.UTC(2024, 0, iso)))]);
      s.style.top = `${row * step}px`;
      s.style.height = `${cell}px`;
      weekdays.append(s);
    }
    const legend = el('div', { class: 'cal-legend', 'aria-hidden': 'true' }, [
      el('span', {}, [t('calendar.less')]),
      ...[0, 1, 2, 3, 4].map((lv) => el('i', { class: `cal-cell lv-${lv}` })),
      el('span', {}, [t('calendar.more')]),
    ]);
    const heat = el('div', { class: 'cal-heat', role: 'img', 'aria-label': t('calendar.heatAria', { n: stats.activeDays }) }, [
      months, el('div', { class: 'cal-heat-body' }, [weekdays, cells]),
    ]);
    cells.addEventListener('pointerover', (e) => this.cellTip(e, stats));
    cells.addEventListener('pointerleave', () => this.tip.classList.remove('is-shown'));
    cells.addEventListener('click', (e) => {
      const key = (e.target as HTMLElement).dataset?.key;
      const list = key ? stats.days.get(key) : undefined;
      if (list?.length) this.host.go(this.works[list[0]]);
    });
    return el('section', { class: 'cal-card' }, [
      el('div', { class: 'cal-card-head' }, [el('h2', { class: 'cal-card-title' }, [t('calendar.heatTitle')]), legend]),
      heat,
    ]);
  }

  private cellTip(e: PointerEvent, stats: YearStats): void {
    const target = e.target as HTMLElement;
    const key = target.dataset?.key;
    if (!key) return;
    const list = stats.days.get(key) ?? [];
    const date = key.replace(/-/g, '.');
    const first = list[0] !== undefined ? this.works[list[0]] : null;
    this.tip.textContent = list.length
      ? `${date} · ${t('pill.count', { n: list.length })}${first ? ` · ${first.customTitle?.trim() || first.title}` : ''}`
      : `${date} · ${t('calendar.none')}`;
    const r = target.getBoundingClientRect();
    const hr = this.root.getBoundingClientRect();
    this.tip.style.left = `${Math.round(r.left + r.width / 2 - hr.left)}px`;
    this.tip.style.top = `${Math.round(r.top - hr.top - 8)}px`;
    this.tip.classList.add('is-shown');
    target.style.cursor = list.length ? 'pointer' : 'default';
  }

  // ───────────── 每个月 ─────────────

  private monthsCard(stats: YearStats): HTMLElement {
    const L = lang();
    const max = Math.max(1, ...stats.months);
    // 高度用 element.style 写（发行版的 CSP 会拦掉 style 属性字符串）
    const bars = stats.months.map((n, m) => {
      const bar = el('span', { class: 'cal-month-bar' });
      bar.style.height = `${Math.round((n / max) * 100)}%`;
      return el('div', { class: `cal-month${m === stats.busiestMonth ? ' is-top' : ''}` }, [
        el('span', { class: 'cal-month-n' }, [n ? String(n) : '']),
        el('span', { class: 'cal-month-track' }, [bar]),
        el('span', { class: 'cal-month-label' }, [monthLabel(m + 1, L)]),
      ]);
    });
    return el('section', { class: 'cal-card cal-card--months' }, [
      el('h2', { class: 'cal-card-title' }, [t('calendar.monthsTitle')]),
      el('div', { class: 'cal-months' }, bars),
    ]);
  }

  // ───────────── 这一年的颜色 ─────────────

  private colorsCard(stats: YearStats): HTMLElement {
    const yearWorks = [...stats.days.values()].flat().map((i) => this.works[i]);
    const missing = this.host.missingColors(yearWorks);
    const children: HTMLElement[] = [el('h2', { class: 'cal-card-title' }, [t('calendar.colorsTitle')])];
    if (stats.colors.length) {
      const bar = el('div', { class: 'cal-colors-bar' });
      for (const c of stats.colors) {
        const seg = el('span', { title: c.hex });
        seg.style.background = c.hex;
        seg.style.flexGrow = String(Math.max(0.02, c.share));
        bar.append(seg);
      }
      const list = el('div', { class: 'cal-colors-list' }, stats.colors.map((c) => {
        const dot = el('i');
        dot.style.background = c.hex;
        return el('span', { class: 'cal-color' }, [dot, el('span', {}, [c.hex]), el('span', { class: 'cal-color-pct' }, [`${Math.round(c.share * 100)}%`])]);
      }));
      children.push(bar, list);
    }
    if (missing > 0) {
      const btn = el('button', { type: 'button', class: 'cal-analyze' }, [t('calendar.analyze', { n: missing })]);
      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = t('calendar.analyzing');
        void this.host.analyzeColors(yearWorks).then(() => this.refresh());
      });
      children.push(el('p', { class: 'cal-note' }, [t('calendar.colorsPartial')]), btn);
    }
    return el('section', { class: 'cal-card cal-card--colors' }, children);
  }

  // ───────────── 最常画的系列 ─────────────

  private seriesCard(stats: YearStats): HTMLElement {
    const top = stats.series.slice(0, 5);
    const max = top[0]?.count ?? 1;
    const rows = top.map((s) => {
      const info = this.host.series(s.id);
      const dot = el('i', { class: 'dot' });
      dot.style.background = info.color;
      const fill = el('span', { class: 'cal-series-fill' });
      fill.style.width = `${Math.round((s.count / max) * 100)}%`;
      fill.style.background = info.color;
      return el('div', { class: 'cal-series' }, [
        el('span', { class: 'cal-series-name' }, [dot, el('span', {}, [info.name])]),
        el('span', { class: 'cal-series-track' }, [fill]),
        el('span', { class: 'cal-series-n' }, [t('pill.count', { n: s.count })]),
      ]);
    });
    return el('section', { class: 'cal-card' }, [el('h2', { class: 'cal-card-title' }, [t('calendar.seriesTitle')]), ...rows]);
  }
}

/** 某一天（YYYY-MM-DD）画的作品：给“导出”和别处用 */
export function worksOn(works: readonly Work[], key: string): Work[] {
  return works.filter((w) => {
    const d = workDay(w);
    return !!d && dayKey(d) === key;
  });
}
