// 预览集列表里的几种行（2026-11-18 从 menu.ts 抽出来）：左上角三道杠菜单和字标旁的预览集切换器共用——
// 原地改名的输入框、右键菜单的三项（修改名称 / 创建副本 / 删除预览集）。
// 删除确认原来也在这里（原地展开一行），2026-11-20 改成屏幕中央的确认框（confirm-dialog.ts）。
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

/** 右键预览集的菜单项：修改名称 / 创建副本 / 删除预览集 */
export function setContextItems(
  s: SetInfo,
  act: { rename: () => void; duplicate: () => void; remove: () => void },
  deleteLabel = t('ctx.deleteSet'),
  /** 删除前面再加几项（2026-11-20：情绪板的“在置顶小窗中打开”） */
  extra: CtxItem[] = [],
): CtxItem[] {
  return [
    { caption: s.name },
    { label: t('ctx.renameSet'), icon: ICON_PENCIL, run: act.rename },
    { label: t('ctx.duplicateSet'), icon: ICON_COPY, run: act.duplicate },
    ...extra,
    'divider',
    { label: deleteLabel, icon: ICON_TRASH, danger: true, run: act.remove },
  ];
}
