import { describe, it, expect } from 'vitest';
import { MESSAGES, t } from './i18n';

describe('中英文案', () => {
  it('两种语言的键完全一致，没有空文案', () => {
    const zh = Object.keys(MESSAGES.zh).sort();
    const en = Object.keys(MESSAGES.en).sort();
    expect(en).toEqual(zh);
    for (const l of ['zh', 'en'] as const) {
      for (const [k, v] of Object.entries(MESSAGES[l])) expect(v.trim(), `${l}:${k}`).not.toBe('');
    }
  });

  it('占位符两边一致', () => {
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of Object.keys(MESSAGES.zh) as (keyof typeof MESSAGES.zh)[]) {
      expect(holes(MESSAGES.en[k]), k).toBe(holes(MESSAGES.zh[k]));
    }
  });

  it('替换占位符', () => {
    expect(t('info.sameSeries', { n: 5 }, 'zh')).toBe('同系列 5 幅');
    expect(t('info.sameSeries', { n: 5 }, 'en')).toBe('5 in this series');
    expect(t('app.name', undefined, 'zh')).toBe('Peekit');
  });
});
