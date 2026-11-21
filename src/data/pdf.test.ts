// 2026-11-21：PDF 作品集的写入
import { describe, it, expect } from 'vitest';
import { buildPdf } from './pdf';

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('PDF 写入', () => {
  const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, ...Array(n).fill(0x42), 0xff, 0xd9]);
  const pdf = buildPdf(
    [
      { jpeg: jpeg(10), px: 200, py: 100, w: 842, h: 595 },
      { jpeg: jpeg(30), px: 100, py: 200, w: 595, h: 842 },
    ],
    '我的作品集',
    new Date(2026, 10, 21, 9, 5, 0),
  );
  const s = latin1(pdf);

  it('头尾和页数', () => {
    expect(s.startsWith('%PDF-1.4\n')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Count 2');
    expect(s).toContain('/MediaBox [0 0 595 842]');
    expect(s).toContain('/Width 200 /Height 100');
    expect(s).toContain('/CreationDate (D:20261121090500)');
  });

  it('标题写成 UTF-16BE', () => {
    expect(s).toContain('/Title <FEFF621176844F5C54C196C6>');
  });

  it('交叉引用表的偏移都指向对应的对象', () => {
    const start = Number(/startxref\n(\d+)\n/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe('xref');
    const lines = s.slice(start).split('\n');
    const size = Number(lines[1].split(' ')[1]);
    expect(size).toBe(10);
    for (let id = 1; id < size; id++) {
      const entry = lines[2 + id];
      expect(entry).toMatch(/^\d{10} 00000 n $/);
      const off = Number(entry.slice(0, 10));
      expect(s.slice(off, off + `${id} 0 obj`.length)).toBe(`${id} 0 obj`);
    }
  });

  it('图片字节原样放进去，长度对得上', () => {
    const m = /\/Length (\d+) >>\nstream\n/g;
    const lens: number[] = [];
    for (let r = m.exec(s); r; r = m.exec(s)) lens.push(Number(r[1]));
    expect(lens).toContain(14);
    expect(lens).toContain(34);
  });
});
