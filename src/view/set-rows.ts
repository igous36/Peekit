// 预览集列表里的几种行（2026-11-18 从 menu.ts 抽出来）：左上角三道杠菜单和字标旁的预览集切换器共用——
// 原地改名的输入框、原地确认删除、右键菜单的三项（修改名称 / 创建副本 / 删除预览集）。
import { t } from '../i18n';
import { SET_NAME_MAX } from '../data/sets';
import { el, ICON_COPY, ICON_PENCIL, ICON_TRASH } from './dom';
import type { CtxItem } from './context-menu';
import type { SetInfo } from './menu';

/**
 * 原地改名：输入框，回车 / 点外面保存，Esc 放弃。finish 只会调一次。
 * 打开后调用方负责聚焦、全选（输入框是 .menu-input）
 */
export function setRenameRow(s: SetInfo, finish: (commit: boolean, value: string) => void): HTMLElement {
  const input = el('input', {
    type: 'text', class: 'menu-input', value: s.name, maxlength: SET_NAME_MAX,
    'aria-label': t('sets.rename', { name: s.name }), placeholder: t('sets.namePlaceholder'),
    autocomplete: 'off', spellcheck: 'false',
  });
  let done = false;
  const end = (commit: boolean) => {
    if (done) return;
    done = true;
    finish(commit, input.value);
  };
  input.addEventListener('keydown', (e) => {
    // 中文输入法组字时的回车是选字
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      end(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      end(false);
    }
  });
  input.addEventListener('blur', () => end(true));
  return el('div', { class: 'menu-set menu-set--editing', role: 'none' }, [input]);
}

/** 原地确认删除：“删除「xxx」？只删除这个预览集……” + 取消 / 删除（取消按钮带 data-cancel，方便调用方放焦点） */
export function setConfirmRow(s: SetInfo, cancel: () => void, confirm: () => void): HTMLElement {
  const no = el('button', { type: 'button', class: 'menu-confirm-btn', role: 'menuitem', 'data-cancel': s.id }, [
    t('sets.cancel'),
  ]);
  const ok = el('button', { type: 'button', class: 'menu-confirm-btn menu-confirm-btn--danger', role: 'menuitem' }, [
    t('sets.confirmDelete'),
  ]);
  no.addEventListener('click', cancel);
  ok.addEventListener('click', confirm);
  return el('div', { class: 'menu-confirm', role: 'none' }, [
    el('p', { class: 'menu-confirm-title' }, [t('sets.deleteConfirm', { name: s.name })]),
    el('p', { class: 'menu-confirm-hint' }, [t('sets.deleteHint')]),
    el('div', { class: 'menu-confirm-actions', role: 'none' }, [no, ok]),
  ]);
}

/** 右键预览集的菜单项：修改名称 / 创建副本 / 删除预览集 */
export function setContextItems(
  s: SetInfo,
  act: { rename: () => void; duplicate: () => void; remove: () => void },
): CtxItem[] {
  return [
    { caption: s.name },
    { label: t('ctx.renameSet'), icon: ICON_PENCIL, run: act.rename },
    { label: t('ctx.duplicateSet'), icon: ICON_COPY, run: act.duplicate },
    'divider',
    { label: t('ctx.deleteSet'), icon: ICON_TRASH, danger: true, run: act.remove },
  ];
}
