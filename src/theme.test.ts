// 2026-11-17 新增：外观（浅色 / 深色 / 跟随系统）、深色变量、关于对话框的架构标签
import { describe, it, expect } from 'vitest';
import { resolveTheme } from './theme';
import { color, colorDark, shadow, shadowDark, tokenCss, DARK_SCOPES } from './tokens';
import { archLabel } from './view/about';

describe('外观', () => {
  it('浅色 / 深色固定；跟随系统时看系统', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('每个颜色、阴影变量都有深色值', () => {
    expect(Object.keys(colorDark).sort()).toEqual(Object.keys(color).sort());
    expect(Object.keys(shadowDark).sort()).toEqual(Object.keys(shadow).sort());
    // 黄色强调色两种模式一致
    expect(colorDark['color-accent']).toBe(color['color-accent']);
  });

  it('变量写成样式表：浅色在 :root，深色挂在深色模式和全屏弹出层上', () => {
    const css = tokenCss();
    const [light, dark] = css.split('\n');
    expect(light.startsWith(':root{')).toBe(true);
    expect(light).toContain(`--color-bg:${color['color-bg']};`);
    expect(light).toContain('--radius-menu:16px;');
    expect(dark.startsWith(DARK_SCOPES.join(','))).toBe(true);
    expect(dark).toContain(`--color-bg:${colorDark['color-bg']};`);
    expect(dark).toContain('--glass-fill:');
    // 圆角、字体和深浅无关，不重复写
    expect(dark).not.toContain('--radius-menu');
    expect(DARK_SCOPES).toContain('.app.is-fullscreen .menu-panel');
    expect(DARK_SCOPES).toContain('.app.is-fullscreen .ctx-menu');
  });
});

describe('关于', () => {
  it('从 WebView2 的 UA 里认出架构', () => {
    expect(archLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/131')).toBe('x64');
    expect(archLabel('Mozilla/5.0 (Windows NT 10.0; ARM64) AppleWebKit/537.36')).toBe('ARM64');
    expect(archLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('');
  });
});
