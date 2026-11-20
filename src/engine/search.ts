// 命令面板的搜索（2026-11-20，Ctrl+K）：作品、系列、预览集、情绪板和常用操作放在一起搜。纯函数，不碰 DOM。
//
// 打分（每个词分开算，全部词都要命中，分数相加）：
//   名字开头命中 100 > 名字里某个词的开头 70 > 名字里任意位置 50 > 副标题 / 关键词里 25 > 名字里按顺序出现（跳着字）10
// 整个查询和名字完全一样再加 60。同分时名字短的在前，再按传进来的顺序（操作 → 系列 → 预览集 → 情绪板 → 作品）。
// 中文没有空格分词，名字里任意位置命中就算；跳字匹配让“午窗”也能找到“午后的窗”。

export type SearchKind = 'action' | 'work' | 'series' | 'set' | 'board';

export interface SearchItem {
  kind: SearchKind;
  label: string;
  /** 灰色副标题：作品的日期和系列、系列的幅数…… */
  sub?: string;
  /** 不显示、但能搜到的词（文件名、操作的别名） */
  keywords?: string;
  /** 右边的快捷键提示 */
  shortcut?: string;
  run: () => void;
}

/** 预先算好的小写形式（几万幅作品时每敲一个字都要过一遍，不能每次都重新转换） */
export interface Prepared {
  item: SearchItem;
  label: string;
  rest: string;
  order: number;
}

/** 统一大小写、全角半角（ＡＢＣ → abc），去掉首尾空白 */
export function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim();
}

export function prepare(items: readonly SearchItem[], offset = 0): Prepared[] {
  return items.map((item, i) => ({
    item,
    label: normalize(item.label),
    rest: normalize(`${item.sub ?? ''} ${item.keywords ?? ''}`),
    order: offset + i,
  }));
}

const WORD_BREAK = /[\s\-_.·/\\()[\]「」『』【】,，、:：]/;

/** text 里按顺序出现 q 的每个字（中间可以隔着别的字） */
export function isSubsequence(q: string, text: string): boolean {
  let j = 0;
  for (let i = 0; i < text.length && j < q.length; i++) if (text[i] === q[j]) j++;
  return j === q.length;
}

/** 一个词在一项上的分数；0 = 没命中 */
export function tokenScore(tok: string, label: string, rest: string): number {
  const at = label.indexOf(tok);
  if (at === 0) return 100;
  if (at > 0) {
    // 名字里某个词的开头（前一个字是空格、连字符这些）
    for (let i = at; i >= 0; i = label.indexOf(tok, i + 1)) {
      if (i > 0 && WORD_BREAK.test(label[i - 1])) return 70;
    }
    return 50;
  }
  if (rest.includes(tok)) return 25;
  if (tok.length >= 2 && isSubsequence(tok, label)) return 10;
  return 0;
}

export function score(query: string, p: Prepared): number {
  const q = normalize(query);
  return q ? scoreTokens(q, q.split(/\s+/), p) : 0;
}

function scoreTokens(q: string, toks: readonly string[], p: Prepared): number {
  let total = 0;
  for (const tok of toks) {
    const s = tokenScore(tok, p.label, p.rest);
    if (!s) return 0;
    total += s;
  }
  if (p.label === q) total += 60;
  return total;
}

/** 搜索：按分数从高到低，最多 limit 项 */
export function search(query: string, items: readonly Prepared[], limit = 50): SearchItem[] {
  const q = normalize(query);
  if (!q) return [];
  const toks = q.split(/\s+/);
  const hits: { p: Prepared; s: number }[] = [];
  for (const p of items) {
    const s = scoreTokens(q, toks, p);
    if (s > 0) hits.push({ p, s });
  }
  hits.sort((a, b) => b.s - a.s || a.p.label.length - b.p.label.length || a.p.order - b.p.order);
  return hits.slice(0, limit).map((h) => h.p.item);
}
