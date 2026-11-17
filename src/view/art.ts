// 画作内容：示例数据用色块拼占位图，真实作品用 <img>（缩略图或原图）。
// 只在一个池子节点换了内容（作品、缩略图到位、换原图、读图失败）时调用，不在每帧调用。
import type { Work } from '../data/types';
import { t } from '../i18n';
import { el } from './dom';

/** 内容的身份：变了才需要重新填充 */
export function artKey(work: Work, src: string | undefined): string {
  return `${work.id}|${src ?? ''}|${work.broken ? 'x' : ''}|${work.bg}`;
}

export function fillArt(canvas: HTMLElement, work: Work, src: string | undefined, onError?: () => void): void {
  canvas.replaceChildren();
  if (work.broken) {
    canvas.style.background = 'var(--color-chip)';
    canvas.append(el('span', { class: 'art-broken', 'data-i18n': 'card.broken' }, [t('card.broken')]));
    return;
  }
  // 加载中只显示纯色底：该画作的主色
  canvas.style.background = work.bg;
  if (src) {
    const img = el('img', { src, alt: '', draggable: 'false', decoding: 'async' });
    if (onError) img.addEventListener('error', onError, { once: true });
    canvas.append(img);
    return;
  }
  for (const s of work.shapes ?? []) {
    const span = el('span');
    const st = span.style;
    st.left = `${s.l}%`;
    st.top = `${s.t}%`;
    st.width = `${s.w}%`;
    st.height = `${s.h}%`;
    st.borderRadius = s.r;
    st.background = s.c;
    if (s.rot) st.transform = `rotate(${s.rot}deg)`;
    canvas.append(span);
  }
}
