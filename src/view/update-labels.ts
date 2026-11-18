// 自动更新在菜单和“关于”里的文字（2026-11-18）。纯函数，单独放一个文件，单测不用加载 DOM。
import { t } from '../i18n';
import { percentOf, type UpdateState } from '../updater';

/** 菜单顶上要不要显示更新那一行（≡ 按钮上的蓝点同步）：有新版本、正在下载 / 安装、安装失败可以重试 */
export const showsUpdateRow = (s: UpdateState): boolean =>
  s.kind === 'available' || s.kind === 'downloading' || s.kind === 'installing' || (s.kind === 'failed' && s.stage === 'install');

/** 更新那一行的文字 */
export function updateRowLabel(s: UpdateState): string {
  switch (s.kind) {
    case 'available':
      return t('update.menu', { version: s.version });
    case 'downloading': {
      const p = percentOf(s.got, s.total);
      return p === null ? t('update.downloadingPlain') : t('update.downloading', { p });
    }
    case 'installing':
      return t('update.installing');
    case 'failed':
      return t('update.menuFailed');
    default:
      return '';
  }
}

/** “关于”里更新那一行：状态文字 + 文字按钮（没有按钮时 action 为 null） */
export function aboutUpdateLine(s: UpdateState): { status: string; action: 'check' | 'install' | null; label: string } {
  switch (s.kind) {
    case 'idle':
      return { status: '', action: 'check', label: t('update.check') };
    case 'checking':
      return { status: t('update.checking'), action: null, label: '' };
    case 'latest':
      return { status: t('update.latest'), action: 'check', label: t('update.check') };
    case 'available':
      return { status: t('update.available', { version: s.version }), action: 'install', label: t('update.now') };
    case 'downloading': {
      const p = percentOf(s.got, s.total);
      return { status: p === null ? t('update.downloadingPlain') : t('update.downloading', { p }), action: null, label: '' };
    }
    case 'installing':
      return { status: t('update.installing'), action: null, label: '' };
    case 'failed':
      return s.stage === 'check'
        ? { status: t('update.checkFailed'), action: 'check', label: t('update.retry') }
        : { status: t('update.failed', { msg: s.msg }), action: 'install', label: t('update.retry') };
  }
}
