// 情绪板标注层（2026-11-20）：文字便签、箭头和直线、色卡、手绘涂鸦。数据和几何在 engine/marks.ts。
//
// 标注层是画布（board-world）里的一个子元素，在所有照片上面，跟着画布一起平移缩放（坐标就是画布坐标）。
// 便签、色卡是 div；箭头、直线、手绘画在一张 SVG 里（线宽是画布单位，跟着缩放变粗变细，像真的画在画布上），
// 每条线另有一条看不见的粗线（14 屏幕 px，不随缩放）用来点选。
//
// 交互（选择工具时）：
// - 点一下选中（选中的便签 / 色卡有一圈蓝色描边，线两端出现把手），拖动挪位置；拖线两端的把手改端点
// - 双击便签改文字（Esc / 点外面结束）；拖便签右下角改大小
// - 点色卡上的色块复制色值
// - Delete 删除选中的标注（可以撤销）；右键：编辑文字 / 换成箭头或直线 / 删除
// 用别的工具时，由 BoardView 把画布上的按下、移动、松手转给这里（down / move / up）来新建标注。
import { t } from '../../i18n';
import { el, ICON_TRASH, ICON_PENCIL } from '../dom';
import type { CtxItem } from '../context-menu';
import type { Board } from '../../data/boards';
import {
  MARK_COLORS, arrowHead, inkPath, moveMark, newMarkId, thinPoints,
  type BoardMark, type LineMark, type InkMark, type MarkTool, type NoteMark, type SwatchMark,
} from '../../engine/marks';
import { r3 } from '../../engine/math';

const NS = 'http://www.w3.org/2000/svg';
/** 新便签在屏幕上的大小、字号（px），按当时的缩放换成画布单位 */
const NOTE_W = 220, NOTE_H = 150, NOTE_FONT = 15;
/** 新线条在屏幕上的粗细（px） */
const LINE_W = 3;
/** 拖动这么多屏幕 px 才算画了一条线 */
const MIN_LINE_PX = 8;

export interface MarkHost {
  /** 当前缩放 */
  zoom(): number;
  /** 屏幕坐标 → 画布坐标 */
  toWorld(sx: number, sy: number): { x: number; y: number };
  /** 改了标注：保存、重画 */
  changed(): void;
  toast(msg: string, action?: { label: string; run: () => void }): void;
  contextMenu(items: CtxItem[], x: number, y: number, label: string): void;
  /** 选中了一个标注：照片的选中取消 */
  clearPhotoSelection(): void;
  /** 画完一笔（箭头、直线、便签）后回到选择工具 */
  toolDone(): void;
}

interface MarkNode {
  mark: BoardMark;
  /** 便签、色卡是 div；线、手绘是 SVG 的 g */
  el: HTMLElement | SVGGElement;
  /** 线、手绘里看得见的那条 */
  path?: SVGPathElement;
  head?: SVGPathElement;
  hit?: SVGPathElement;
  text?: HTMLTextAreaElement;
}

type Gesture =
  | { kind: 'create-line'; id: number; mark: LineMark }
  | { kind: 'create-ink'; id: number; mark: InkMark; raw: number[] }
  | { kind: 'move'; id: number; x0: number; y0: number; node: MarkNode; last: { x: number; y: number }; moved: boolean }
  | { kind: 'resize'; id: number; node: MarkNode; x0: number; y0: number; w0: number; h0: number }
  | { kind: 'end'; id: number; node: MarkNode; which: 1 | 2 };

export class MarkLayer {
  readonly el: HTMLElement;
  private svg: SVGSVGElement;
  private ends: [HTMLElement, HTMLElement];
  private board: Board | null = null;
  private nodes = new Map<string, MarkNode>();
  tool: MarkTool = 'select';
  /** 新标注用的颜色（MARK_COLORS 的下标）；选中了标注时改的是它的颜色 */
  color = 0;
  selected: string | null = null;
  private gesture: Gesture | null = null;
  private editing: string | null = null;

  constructor(private host: MarkHost) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'board-ink');
    this.svg.setAttribute('width', '1');
    this.svg.setAttribute('height', '1');
    this.ends = [el('span', { class: 'board-mark-end' }), el('span', { class: 'board-mark-end' })];
    this.ends.forEach((h, i) => h.addEventListener('pointerdown', (e) => this.onEndDown(e, (i + 1) as 1 | 2)));
    this.el = el('div', { class: 'board-marks' }, [this.svg as unknown as HTMLElement, ...this.ends]);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  private get marks(): BoardMark[] {
    const b = this.board;
    if (!b) return [];
    b.marks ??= [];
    return b.marks;
  }

  /** 换了情绪板（或者关掉：null） */
  setBoard(b: Board | null): void {
    this.board = b;
    this.selected = null;
    this.editing = null;
    this.gesture = null;
    this.rebuild();
  }

  /** 正在画 / 拖标注（BoardView 用来判断按键、光标） */
  get busy(): boolean {
    return !!this.gesture || !!this.editing;
  }

  // ───────────── 建节点 ─────────────

  private rebuild(): void {
    for (const n of this.nodes.values()) n.el.remove();
    this.nodes.clear();
    for (const m of this.marks) this.addNode(m);
    this.paintSelection();
  }

  private addNode(m: BoardMark): MarkNode {
    const n: MarkNode = m.kind === 'note' ? this.noteNode(m) : m.kind === 'swatch' ? this.swatchNode(m) : this.lineNode(m);
    this.nodes.set(m.id, n);
    this.update(n);
    return n;
  }

  private noteNode(m: NoteMark): MarkNode {
    const text = el('textarea', { class: 'board-note-text', readonly: true, spellcheck: 'false', 'aria-label': t('marks.note') });
    text.value = m.text;
    const grip = el('span', { class: 'board-note-grip', 'aria-hidden': 'true' });
    const node = el('div', { class: 'board-note' }, [text, grip]);
    this.el.append(node);
    const n: MarkNode = { mark: m, el: node, text };
    node.addEventListener('pointerdown', (e) => this.onMarkDown(e, n));
    node.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.editNote(n);
    });
    node.addEventListener('contextmenu', (e) => this.onMarkMenu(e, n));
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this.select(m.id);
      this.gesture = { kind: 'resize', id: e.pointerId, node: n, x0: e.clientX, y0: e.clientY, w0: m.w, h0: m.h };
    });
    text.addEventListener('blur', () => this.endEdit(n));
    text.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        text.blur();
      }
    });
    return n;
  }

  private swatchNode(m: SwatchMark): MarkNode {
    const chips = m.colors.map((hex) => {
      const chip = el('button', { type: 'button', class: 'board-chip', title: t('marks.copyHex', { hex }), 'aria-label': t('marks.copyHex', { hex }) }, [
        el('span', { class: 'board-chip-fill' }),
        el('span', { class: 'board-chip-hex' }, [hex]),
      ]);
      (chip.firstElementChild as HTMLElement).style.background = hex;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(hex).then(() => this.host.toast(t('marks.copied', { hex })), () => {});
      });
      return chip;
    });
    const node = el('div', { class: 'board-swatch' }, chips);
    this.el.append(node);
    const n: MarkNode = { mark: m, el: node };
    node.addEventListener('pointerdown', (e) => {
      // 点色块是复制，不拖
      if ((e.target as HTMLElement).closest('.board-chip') && this.selected === m.id) {
        e.stopPropagation();
        return;
      }
      this.onMarkDown(e, n);
    });
    node.addEventListener('contextmenu', (e) => this.onMarkMenu(e, n));
    return n;
  }

  private lineNode(m: LineMark | InkMark): MarkNode {
    const g = document.createElementNS(NS, 'g');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', 'board-ink-path');
    const hit = document.createElementNS(NS, 'path');
    hit.setAttribute('class', 'board-ink-hit');
    g.append(path);
    let head: SVGPathElement | undefined;
    if (m.kind === 'line') {
      head = document.createElementNS(NS, 'path');
      head.setAttribute('class', 'board-ink-path');
      g.append(head);
    }
    g.append(hit);
    this.svg.append(g);
    const n: MarkNode = { mark: m, el: g, path, head, hit };
    hit.addEventListener('pointerdown', (e) => this.onMarkDown(e as PointerEvent, n));
    hit.addEventListener('contextmenu', (e) => this.onMarkMenu(e as MouseEvent, n));
    return n;
  }

  /** 把数据写进节点（位置、大小、颜色、路径） */
  private update(n: MarkNode): void {
    const m = n.mark;
    if (m.kind === 'note' || m.kind === 'swatch') {
      const s = (n.el as HTMLElement).style;
      s.left = `${r3(m.x)}px`;
      s.top = `${r3(m.y)}px`;
      s.width = `${r3(m.w)}px`;
      s.height = `${r3(m.h)}px`;
      if (m.kind === 'note') {
        s.background = MARK_COLORS[m.color].note;
        if (n.text) n.text.style.fontSize = `${r3(m.size)}px`;
      } else {
        // 色卡里的字号、内边距都按卡片宽度定
        s.setProperty('--sw', `${r3(m.w)}px`);
      }
      return;
    }
    const color = MARK_COLORS[m.color].ink;
    for (const p of [n.path, n.head]) {
      if (!p) continue;
      p.setAttribute('stroke', color);
      p.setAttribute('stroke-width', String(r3(m.width)));
    }
    if (m.kind === 'line') {
      const d = `M${r3(m.x1)} ${r3(m.y1)}L${r3(m.x2)} ${r3(m.y2)}`;
      n.path!.setAttribute('d', d);
      n.hit!.setAttribute('d', d);
      if (m.arrow) {
        const [ax, ay, tx, ty, bx, by] = arrowHead(m);
        n.head!.setAttribute('d', `M${r3(ax)} ${r3(ay)}L${r3(tx)} ${r3(ty)}L${r3(bx)} ${r3(by)}`);
      } else n.head!.setAttribute('d', '');
    } else {
      const d = inkPath(m.pts);
      n.path!.setAttribute('d', d);
      n.hit!.setAttribute('d', d);
    }
  }

  // ───────────── 选中 ─────────────

  select(id: string | null): void {
    if (this.editing && this.editing !== id) {
      const e = this.nodes.get(this.editing);
      e?.text?.blur();
    }
    this.selected = id && this.nodes.has(id) ? id : null;
    if (this.selected) this.host.clearPhotoSelection();
    this.paintSelection();
  }

  private paintSelection(): void {
    for (const [id, n] of this.nodes) n.el.classList.toggle('is-selected', id === this.selected);
    this.paintEnds();
  }

  /** 选中的线：两端的把手（屏幕上大小不变，靠 CSS 的 --bz） */
  private paintEnds(): void {
    const m = this.selected ? this.nodes.get(this.selected)?.mark : undefined;
    const on = m?.kind === 'line';
    this.ends.forEach((h, i) => {
      h.hidden = !on;
      if (on) {
        h.style.left = `${r3(i ? m.x2 : m.x1)}px`;
        h.style.top = `${r3(i ? m.y2 : m.y1)}px`;
      }
    });
  }

  /** 选中的标注的颜色（工具条上的色点用） */
  selectedColor(): number | null {
    const m = this.selected ? this.nodes.get(this.selected)?.mark : undefined;
    return m && m.kind !== 'swatch' ? m.color : null;
  }

  /** 工具条上点了色点：选中了标注就改它，否则作为新标注的颜色 */
  setColor(c: number): void {
    this.color = c;
    const n = this.selected ? this.nodes.get(this.selected) : undefined;
    if (n && n.mark.kind !== 'swatch') {
      n.mark.color = c;
      this.update(n);
      this.host.changed();
    }
  }

  deleteSelected(): void {
    const id = this.selected;
    if (!id) return;
    const i = this.marks.findIndex((m) => m.id === id);
    if (i < 0) return;
    const [m] = this.marks.splice(i, 1);
    this.nodes.get(id)?.el.remove();
    this.nodes.delete(id);
    this.selected = null;
    this.paintSelection();
    this.host.changed();
    this.host.toast(t('marks.deleted'), {
      label: t('toast.undo'),
      run: () => {
        if (!this.board) return;
        this.marks.splice(Math.min(i, this.marks.length), 0, m);
        this.addNode(m);
        this.reorder();
        this.select(m.id);
        this.host.changed();
      },
    });
  }

  /** SVG 里线的先后、便签的先后按数据顺序 */
  private reorder(): void {
    for (const m of this.marks) {
      const n = this.nodes.get(m.id);
      if (!n) continue;
      if (m.kind === 'line' || m.kind === 'ink') this.svg.append(n.el);
      else this.el.insertBefore(n.el, this.ends[0]);
    }
  }

  // ───────────── 便签文字 ─────────────

  private editNote(n: MarkNode): void {
    if (!n.text) return;
    this.select(n.mark.id);
    this.editing = n.mark.id;
    n.el.classList.add('is-editing');
    n.text.readOnly = false;
    n.text.focus({ preventScroll: true });
    n.text.select();
  }

  private endEdit(n: MarkNode): void {
    if (this.editing !== n.mark.id || !n.text) return;
    this.editing = null;
    n.el.classList.remove('is-editing');
    n.text.readOnly = true;
    const m = n.mark as NoteMark;
    if (m.text !== n.text.value) {
      m.text = n.text.value;
      this.host.changed();
    }
  }

  // ───────────── 新建（BoardView 转过来的按下 / 移动 / 松手） ─────────────

  /** 用非选择工具在画布上按下：开始画；返回是否接手了这次按下 */
  down(e: PointerEvent): boolean {
    if (!this.board || this.tool === 'select' || e.button !== 0) return false;
    const z = this.host.zoom();
    const p = this.host.toWorld(e.clientX, e.clientY);
    if (this.tool === 'note') {
      const m: NoteMark = {
        id: newMarkId(), kind: 'note', x: p.x, y: p.y, w: NOTE_W / z, h: NOTE_H / z, text: '', color: this.color, size: NOTE_FONT / z,
      };
      this.marks.push(m);
      const n = this.addNode(m);
      this.host.changed();
      this.host.toolDone();
      // 等这次按下结束再进编辑，不然松手时焦点会被画布抢走
      window.setTimeout(() => this.editNote(n), 0);
      return true;
    }
    if (this.tool === 'pen') {
      const m: InkMark = { id: newMarkId(), kind: 'ink', pts: [p.x, p.y, p.x, p.y], color: this.color, width: LINE_W / z };
      this.marks.push(m);
      this.addNode(m);
      this.gesture = { kind: 'create-ink', id: e.pointerId, mark: m, raw: [p.x, p.y] };
      return true;
    }
    const m: LineMark = {
      id: newMarkId(), kind: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y, arrow: this.tool === 'arrow', color: this.color, width: LINE_W / z,
    };
    this.marks.push(m);
    this.addNode(m);
    this.gesture = { kind: 'create-line', id: e.pointerId, mark: m };
    return true;
  }

  // ───────────── 拖动标注 ─────────────

  private onMarkDown(e: PointerEvent, n: MarkNode): void {
    if (this.tool !== 'select' || e.button !== 0) return;
    if (this.editing === n.mark.id) return; // 正在打字：让文本框自己处理
    e.stopPropagation();
    e.preventDefault();
    this.select(n.mark.id);
    const p = this.host.toWorld(e.clientX, e.clientY);
    this.gesture = { kind: 'move', id: e.pointerId, x0: e.clientX, y0: e.clientY, node: n, last: p, moved: false };
  }

  private onEndDown(e: PointerEvent, which: 1 | 2): void {
    const n = this.selected ? this.nodes.get(this.selected) : undefined;
    if (!n || n.mark.kind !== 'line' || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    this.gesture = { kind: 'end', id: e.pointerId, node: n, which };
  }

  private onMove = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    const p = this.host.toWorld(e.clientX, e.clientY);
    if (g.kind === 'create-line') {
      g.mark.x2 = p.x;
      g.mark.y2 = p.y;
      this.update(this.nodes.get(g.mark.id)!);
    } else if (g.kind === 'create-ink') {
      g.raw.push(p.x, p.y);
      g.mark.pts = thinPoints(g.raw, 1.5 / this.host.zoom());
      this.update(this.nodes.get(g.mark.id)!);
    } else if (g.kind === 'move') {
      if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 3) return;
      g.moved = true;
      moveMark(g.node.mark, p.x - g.last.x, p.y - g.last.y);
      g.last = p;
      this.update(g.node);
      this.paintEnds();
    } else if (g.kind === 'resize') {
      const m = g.node.mark as NoteMark;
      const z = this.host.zoom();
      m.w = Math.max(80 / z, g.w0 + (e.clientX - g.x0) / z);
      m.h = Math.max(48 / z, g.h0 + (e.clientY - g.y0) / z);
      this.update(g.node);
    } else if (g.kind === 'end') {
      const m = g.node.mark as LineMark;
      if (g.which === 1) {
        m.x1 = p.x;
        m.y1 = p.y;
      } else {
        m.x2 = p.x;
        m.y2 = p.y;
      }
      this.update(g.node);
      this.paintEnds();
    }
  };

  private onUp = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    this.gesture = null;
    if (g.kind === 'create-line') {
      const m = g.mark;
      const z = this.host.zoom();
      if (Math.hypot(m.x2 - m.x1, m.y2 - m.y1) * z < MIN_LINE_PX) this.discard(m.id);
      else {
        this.host.changed();
        this.select(m.id);
      }
      this.host.toolDone();
    } else if (g.kind === 'create-ink') {
      if (g.mark.pts.length < 4 || g.raw.length < 4) this.discard(g.mark.id);
      else this.host.changed();
    } else if (g.kind === 'move') {
      if (g.moved) this.host.changed();
    } else {
      this.host.changed();
    }
  };

  /** 画了一半不算数（太短）：拿掉 */
  private discard(id: string): void {
    const i = this.marks.findIndex((m) => m.id === id);
    if (i >= 0) this.marks.splice(i, 1);
    this.nodes.get(id)?.el.remove();
    this.nodes.delete(id);
  }

  // ───────────── 右键 ─────────────

  private onMarkMenu(e: MouseEvent, n: MarkNode): void {
    e.preventDefault();
    e.stopPropagation();
    this.select(n.mark.id);
    const m = n.mark;
    const items: CtxItem[] = [{ caption: t(`marks.kind.${m.kind}`) }];
    if (m.kind === 'note') items.push({ label: t('marks.editText'), icon: ICON_PENCIL, run: () => this.editNote(n) });
    if (m.kind === 'line') {
      items.push({
        label: t(m.arrow ? 'marks.toLine' : 'marks.toArrow'), icon: ICON_PENCIL,
        run: () => {
          m.arrow = !m.arrow;
          this.update(n);
          this.host.changed();
        },
      });
    }
    items.push('divider', { label: t('marks.delete'), icon: ICON_TRASH, danger: true, run: () => this.deleteSelected() });
    this.host.contextMenu(items, e.clientX, e.clientY, t(`marks.kind.${m.kind}`));
  }

  // ───────────── 色卡 ─────────────

  /** 在一张照片右边放一张色卡（colors：从它身上取的主色） */
  addSwatch(colors: string[], near: { x: number; y: number; w: number; h: number }): void {
    if (!this.board || !colors.length) return;
    const z = this.host.zoom();
    const w = Math.max(near.w * 0.7, 260 / z);
    const h = w * 0.42;
    const m: SwatchMark = { id: newMarkId(), kind: 'swatch', x: near.x + near.w + 24 / z, y: near.y, w, h, colors };
    this.marks.push(m);
    this.addNode(m);
    this.select(m.id);
    this.host.changed();
  }
}

/** 置顶小窗里的只读标注（2026-11-20）：同样的样子，没有交互 */
export function paintMarksStatic(world: HTMLElement, marks: readonly BoardMark[]): void {
  const layer = el('div', { class: 'board-marks is-static' });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'board-ink');
  svg.setAttribute('width', '1');
  svg.setAttribute('height', '1');
  layer.append(svg as unknown as HTMLElement);
  for (const m of marks) {
    if (m.kind === 'note') {
      const text = el('div', { class: 'board-note-text' }, [m.text]);
      text.style.fontSize = `${r3(m.size)}px`;
      const node = el('div', { class: 'board-note' }, [text]);
      Object.assign(node.style, { left: `${m.x}px`, top: `${m.y}px`, width: `${m.w}px`, height: `${m.h}px`, background: MARK_COLORS[m.color].note });
      layer.append(node);
    } else if (m.kind === 'swatch') {
      const node = el('div', { class: 'board-swatch' }, m.colors.map((hex) => {
        const fill = el('span', { class: 'board-chip-fill' });
        fill.style.background = hex;
        return el('span', { class: 'board-chip' }, [fill, el('span', { class: 'board-chip-hex' }, [hex])]);
      }));
      Object.assign(node.style, { left: `${m.x}px`, top: `${m.y}px`, width: `${m.w}px`, height: `${m.h}px` });
      node.style.setProperty('--sw', `${m.w}px`);
      layer.append(node);
    } else {
      const color = MARK_COLORS[m.color].ink;
      const add = (d: string) => {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('class', 'board-ink-path');
        p.setAttribute('d', d);
        p.setAttribute('stroke', color);
        p.setAttribute('stroke-width', String(m.width));
        svg.append(p);
      };
      if (m.kind === 'line') {
        add(`M${m.x1} ${m.y1}L${m.x2} ${m.y2}`);
        if (m.arrow) {
          const [ax, ay, tx, ty, bx, by] = arrowHead(m);
          add(`M${ax} ${ay}L${tx} ${ty}L${bx} ${by}`);
        }
      } else add(inkPath(m.pts));
    }
  }
  world.append(layer);
}
