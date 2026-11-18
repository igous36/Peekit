import { describe, it, expect } from 'vitest';
import { LANGS, LANG_NATIVE, MESSAGES, langFromLocale, langTag, t } from './i18n';
import { monthLabel } from './engine/months';
import { stopAt, STOP_PX } from './view/theme-switch';

describe('界面文案（2026-11-18 起 10 种语言）', () => {
  it('每种语言的键和中文完全一致，没有空文案', () => {
    const zh = Object.keys(MESSAGES.zh).sort();
    for (const l of LANGS) {
      expect(Object.keys(MESSAGES[l]).sort(), l).toEqual(zh);
      for (const [k, v] of Object.entries(MESSAGES[l])) expect(v.trim(), `${l}:${k}`).not.toBe('');
    }
  });

  it('占位符和中文一致（不多不少）', () => {
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const l of LANGS) {
      for (const k of Object.keys(MESSAGES.zh) as (keyof typeof MESSAGES.zh)[]) {
        expect(holes(MESSAGES[l][k]), `${l}:${k}`).toBe(holes(MESSAGES.zh[k]));
      }
    }
  });

  it('联合国工作语言 + 德意韩葡，每种都有本族语名字', () => {
    expect([...LANGS].sort()).toEqual(['ar', 'de', 'en', 'es', 'fr', 'it', 'ko', 'pt', 'ru', 'zh']);
    for (const l of LANGS) expect(LANG_NATIVE[l]).toBeTruthy();
    expect(langTag('zh')).toBe('zh-CN');
    expect(langTag('pt')).toBe('pt');
  });

  it('跟随系统语言：按前缀匹配，不支持的用英文', () => {
    expect(langFromLocale('zh-CN')).toBe('zh');
    expect(langFromLocale('pt-BR')).toBe('pt');
    expect(langFromLocale('de_DE')).toBe('de');
    expect(langFromLocale('ar-EG')).toBe('ar');
    expect(langFromLocale('ja-JP')).toBe('en');
    expect(langFromLocale('')).toBe('en');
  });

  it('替换占位符', () => {
    expect(t('info.sameSeries', { n: 5 }, 'zh')).toBe('同系列 5 幅');
    expect(t('info.sameSeries', { n: 5 }, 'en')).toBe('5 in this series');
    expect(t('refresh.done', { added: 3, removed: 1 }, 'de')).toBe('Aktualisiert: 3 hinzugefügt, 1 entfernt');
    expect(t('app.name', undefined, 'ko')).toBe('Peekit');
  });

  it('时间轴月份：中文、英文固定写法，其余语言用系统的月份简称', () => {
    expect(monthLabel(11, 'zh')).toBe('11月');
    expect(monthLabel(11, 'en')).toBe('Nov');
    for (const l of LANGS) {
      const labels = Array.from({ length: 12 }, (_, i) => monthLabel(i + 1, l));
      expect(new Set(labels).size, l).toBe(12);
    }
  });
});

describe('颜色模式拨动开关（2026-11-18）', () => {
  it('拖到哪松手就吸附到最近的一档，拖出两头也不越界', () => {
    expect(stopAt(0)).toBe(0);
    expect(stopAt(STOP_PX * 0.4)).toBe(0);
    expect(stopAt(STOP_PX * 0.6)).toBe(1);
    expect(stopAt(STOP_PX * 1.6)).toBe(2);
    expect(stopAt(-50)).toBe(0);
    expect(stopAt(500)).toBe(2);
  });
});
