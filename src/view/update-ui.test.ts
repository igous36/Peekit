import { describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { aboutUpdateLine, showsUpdateRow, updateRowLabel } from './update-labels';
import type { UpdateState } from '../updater';

const avail: UpdateState = { kind: 'available', version: '0.1.4', notes: '', manual: false };
const dl = (got: number, total: number | null): UpdateState => ({ kind: 'downloading', version: '0.1.4', got, total });

describe('菜单里的更新那一行', () => {
  it('有新版本、下载 / 安装中、安装失败时显示；没查到 / 已是最新 / 检查失败时不显示', () => {
    expect(showsUpdateRow(avail)).toBe(true);
    expect(showsUpdateRow(dl(0, 10))).toBe(true);
    expect(showsUpdateRow({ kind: 'installing', version: '0.1.4' })).toBe(true);
    expect(showsUpdateRow({ kind: 'failed', stage: 'install', version: '0.1.4', msg: 'x' })).toBe(true);
    expect(showsUpdateRow({ kind: 'idle' })).toBe(false);
    expect(showsUpdateRow({ kind: 'latest' })).toBe(false);
    expect(showsUpdateRow({ kind: 'checking', manual: false })).toBe(false);
    expect(showsUpdateRow({ kind: 'failed', stage: 'check', version: null, msg: 'x' })).toBe(false);
  });

  it('文字跟着状态走，下载时带百分比', () => {
    setLang('zh');
    expect(updateRowLabel(avail)).toBe('更新到 0.1.4');
    expect(updateRowLabel(dl(45, 100))).toBe('正在下载更新… 45%');
    expect(updateRowLabel(dl(45, null))).toBe('正在下载更新…');
    expect(updateRowLabel({ kind: 'failed', stage: 'install', version: '0.1.4', msg: 'x' })).toBe('更新失败，点击重试');
    setLang('en');
    expect(updateRowLabel(avail)).toBe('Update to 0.1.4');
    setLang('zh');
  });
});

describe('“关于”里的更新状态', () => {
  it('每个状态对应的文字和按钮', () => {
    setLang('zh');
    expect(aboutUpdateLine({ kind: 'idle' })).toEqual({ status: '', action: 'check', label: '检查更新' });
    expect(aboutUpdateLine({ kind: 'checking', manual: true })).toEqual({ status: '正在检查更新…', action: null, label: '' });
    expect(aboutUpdateLine({ kind: 'latest' })).toEqual({ status: '已是最新版本', action: 'check', label: '检查更新' });
    expect(aboutUpdateLine(avail)).toEqual({ status: '有新版本 0.1.4', action: 'install', label: '更新' });
    expect(aboutUpdateLine(dl(1, 4))).toMatchObject({ status: '正在下载更新… 25%', action: null });
    expect(aboutUpdateLine({ kind: 'failed', stage: 'check', version: null, msg: '超时' })).toEqual({
      status: '检查更新失败', action: 'check', label: '重试',
    });
    expect(aboutUpdateLine({ kind: 'failed', stage: 'install', version: '0.1.4', msg: '签名不对' })).toEqual({
      status: '更新失败：签名不对', action: 'install', label: '重试',
    });
  });
});
