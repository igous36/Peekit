// 画师自检的工具条（2026-11-20）：底部居中一个小胶囊，三个开关（水平翻转 H、灰度 G、模糊 B）。
// 什么时候出现由 CSS 按 .app 上的类决定（styles.css 的“画师自检”一节）：
// 放大时一直在；全屏时有一项开着、或者鼠标靠近底边才浮出来；单幅和系列视图不显示（开着时字标那一行有状态标签）。
import { t } from '../i18n';
import { CHECK_KEYS, CHECK_KINDS, type CheckKind, type CheckState } from '../engine/checks';
import { el, svgIcon, ICON_BLUR, ICON_FLIP, ICON_GRAY } from './dom';

export const CHECK_ICONS: Readonly<Record<CheckKind, string[]>> = { flip: ICON_FLIP, gray: ICON_GRAY, blur: ICON_BLUR };

export class CheckBar {
  readonly root: HTMLElement;
  private buttons = new Map<CheckKind, HTMLButtonElement>();

  constructor(onToggle: (k: CheckKind) => void) {
    this.root = el('div', { class: 'check-bar', role: 'toolbar', 'data-i18n-aria': 'check.bar' });
    for (const k of CHECK_KINDS) {
      const b = el('button', { type: 'button', class: 'check-btn', 'aria-pressed': 'false' }, [svgIcon(CHECK_ICONS[k], 18)]);
      b.addEventListener('click', () => onToggle(k));
      this.buttons.set(k, b);
      this.root.append(b);
    }
    this.relabel();
  }

  set(s: Readonly<CheckState>): void {
    for (const [k, b] of this.buttons) {
      b.classList.toggle('is-on', s[k]);
      b.setAttribute('aria-pressed', String(s[k]));
    }
  }

  relabel(): void {
    for (const [k, b] of this.buttons) {
      const label = t('check.withKey', { name: t(`check.${k}`), key: CHECK_KEYS[k] });
      b.setAttribute('aria-label', label);
      b.title = label;
    }
  }
}
