// 左上角的计数（2026-11-18 重做，原来是“03 / 12”文字）：默认是一个小圆环——
//
//   ╭ 外圈 ╮  当前作品的主题色（data/palette-loader.ts），慢慢转着流动，磨砂模糊 + 一点泛光；
//   │     │  翻动时颜色跟着每幅的主色快速变（0.14s 过渡），外圈还跟着翻动方向转；停下后换成完整主题色（0.6s 过渡）
//   │(◔)  │  内圈：蓝色进度环 = 当前位置 / (总数 − 1)，跟着滚动连续变化；第 1 幅是 0（只有灰圈），最后一幅满圈
//   ╰─────╯
//
// - 在头尾还往外拖（橡皮筋拉出去）、或者按键 / 滚轮 / 时间轴按钮还往外翻：蓝圈跳一下、闪一下，提示到头了
// - 悬停（或键盘聚焦）：右边滑出“03 / 12”，圆环微微放大、泛光变亮
// - 点击：切换成文字（原来的样子），再点切回圆环；记在 localStorage
// 每帧只改进度环的 stroke-dashoffset（字符串没变就不写）；外圈的流动是 CSS 动画（只转 transform，合成层）。
import { r3 } from '../engine/math';
import { glowFor } from '../engine/palette';
import { t } from '../i18n';
import { el, Styled } from './dom';

export type CounterMode = 'ring' | 'text';

const KEY = 'peekit:counter';
/** 进度环半径（SVG 坐标，viewBox 18×18） */
const R = 6.2;
const CIRC = 2 * Math.PI * R;
/** 拖过头超过这么多（幅）算“到头了”，回到这以内再重新计 */
export const EDGE_OVER = 0.04;
const EDGE_REARM = 0.01;
const BUMP_MS = 520;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** 外圈跟着翻动转：每翻一幅转这么多度（往后翻顺时针、往前翻逆时针），像拨一个小转轮 */
export const ORBIT_DEG = 30;
/** 一帧最多转这么多度：跳很远（时间轴点到几千幅外）时不会乱转 */
export const ORBIT_MAX_STEP = 24;

/** 这一帧外圈要多转多少度（pos 从 last 变到 now） */
export function orbitStep(last: number, now: number): number {
  if (!Number.isFinite(last)) return 0;
  return Math.max(-ORBIT_MAX_STEP, Math.min(ORBIT_MAX_STEP, (now - last) * ORBIT_DEG));
}

/**
 * 进度：第 1 幅 0，最后一幅 1；拖过头不超出 [0, 1]。
 * 只有一幅时它既是第一幅也是最后一幅：满圈（全蓝，2026-11-18 用户要求）；没有作品时 0
 */
export function counterProgress(pos: number, n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  return Math.min(1, Math.max(0, pos / (n - 1)));
}

/** 拖过头了多少（幅）：在头尾以内是 0 */
export function edgeOvershoot(pos: number, n: number): number {
  if (n <= 0) return 0;
  return pos < 0 ? -pos : pos > n - 1 ? pos - (n - 1) : 0;
}

const pad = (v: number) => String(v).padStart(2, '0');

function readMode(): CounterMode {
  try {
    return localStorage.getItem(KEY) === 'text' ? 'text' : 'ring';
  } catch {
    return 'ring';
  }
}

function circle(cls: string): SVGCircleElement {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('class', cls);
  c.setAttribute('cx', '9');
  c.setAttribute('cy', '9');
  c.setAttribute('r', String(R));
  return c;
}

export class Counter {
  readonly root: HTMLButtonElement;
  private mode: CounterMode = 'ring';
  private btn: Styled<HTMLButtonElement>;
  private label: Styled;
  private bar: Styled;
  private orbit: Styled;
  private colors: readonly string[] = [];
  private flipping = false;
  private angle = 0;
  private lastPos = NaN;
  private armed = true;
  private bumpTimer = 0;

  constructor() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 18 18');
    svg.setAttribute('aria-hidden', 'true');
    const bar = circle('ri-bar');
    bar.setAttribute('stroke-dasharray', r3(CIRC).toString());
    svg.append(circle('ri-track'), bar);
    // 外圈套一层“轨道”：自己慢慢转（CSS 动画）之外，再跟着翻动转（每帧改这一层的 transform）
    const orbit = el('span', { class: 'ri-orbit' }, [el('span', { class: 'ri-bloom' }), el('span', { class: 'ri-flow' })]);
    const ring = el('span', { class: 'counter-ring', 'aria-hidden': 'true' }, [orbit, el('span', { class: 'ri-disc' }, [svg])]);
    this.orbit = new Styled(orbit);
    const label = el('span', { class: 'counter-text' });
    this.root = el('button', { type: 'button', class: 'counter' }, [ring, label]);
    this.btn = new Styled(this.root);
    this.label = new Styled(label);
    this.bar = new Styled(bar as unknown as HTMLElement);
    this.root.addEventListener('click', () => this.setMode(this.mode === 'ring' ? 'text' : 'ring', true));
    this.setMode(readMode(), false);
  }

  private setMode(m: CounterMode, save: boolean): void {
    this.mode = m;
    this.root.classList.toggle('is-ring', m === 'ring');
    this.root.classList.toggle('is-text', m === 'text');
    // 提示点击会切到哪种（换语言时 applyI18n 跟着刷新）
    this.root.dataset.i18nTitle = m === 'ring' ? 'counter.toText' : 'counter.toRing';
    this.root.title = t(m === 'ring' ? 'counter.toText' : 'counter.toRing');
    if (save) {
      try {
        localStorage.setItem(KEY, m);
      } catch {
        /* 存不了就只在这次生效 */
      }
    }
  }

  /**
   * 每帧调用：pos 是连续位置（拖动 / 动画中会有小数，拖过头会出界），cur 是当前那一幅，
   * flipping = 正在左右翻动（颜色、泛光快速跟；停下后慢慢过渡）
   */
  render(pos: number, cur: number, n: number, flipping = false): void {
    if (flipping !== this.flipping) {
      this.flipping = flipping;
      this.root.classList.toggle('is-fast', flipping);
      this.applyGlow();
    }
    this.btn.set('visibility', n > 0 ? 'visible' : 'hidden');
    this.label.text(`${pad(Math.min(cur + 1, n))} / ${pad(n)}`);
    this.btn.attr('aria-label', t('counter.label', { i: Math.min(cur + 1, n), n }));
    const p = counterProgress(pos, n);
    this.bar.set('stroke-dashoffset', `${r3(CIRC * (1 - p))}`);
    // 0 的时候只有灰圈（圆头的线长度为 0 时也会画出一个点，所以直接藏起来）
    this.bar.set('opacity', p > 0.004 ? '1' : '0');
    // 跟着翻动转（只在位置变了的帧改 transform）
    const step = orbitStep(this.lastPos, pos);
    this.lastPos = pos;
    if (step) {
      this.angle = (this.angle + step) % 360;
      this.orbit.set('transform', `rotate(${r3(this.angle)}deg)`);
    }
    const over = edgeOvershoot(pos, n);
    if (over > EDGE_OVER && this.armed) {
      this.armed = false;
      this.bump();
    } else if (over < EDGE_REARM) {
      this.armed = true;
    }
  }

  /** 外圈的主题色（2–3 个） */
  setPalette(colors: readonly string[]): void {
    if (!colors.length) return;
    this.colors = colors;
    for (let i = 0; i < 3; i++) this.btn.set(`--ri-c${i + 1}`, colors[i % colors.length]);
    this.applyGlow();
  }

  /**
   * 泛光强度跟着主题色的亮度（2026-11-18）：越亮越强；停着时只有些许变化，
   * 翻动时范围拉大、过渡很短，经过明暗不同的作品时一闪一闪（engine/palette.ts 的 glowFor）
   */
  private applyGlow(): void {
    this.btn.set('--ri-glow', glowFor(this.colors, this.flipping).toFixed(3));
  }

  /** 到头了：蓝圈跳一下、闪一下（文字模式：文字左右抖一下） */
  bump(): void {
    const r = this.root;
    r.classList.remove('is-bump');
    void r.offsetWidth; // 连续触发时动画从头开始
    r.classList.add('is-bump');
    window.clearTimeout(this.bumpTimer);
    this.bumpTimer = window.setTimeout(() => r.classList.remove('is-bump'), BUMP_MS);
  }
}
