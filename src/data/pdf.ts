// 最小的 PDF 写入（2026-11-21，导出 PDF 作品集用）：每页一张 JPEG 铺满整页，文字已经画在图里。
// 不引入 PDF 库：页面、图片、交叉引用表都是几行固定格式，JPEG 原样放进去（DCTDecode），不用再压缩。
export interface PdfImagePage {
  jpeg: Uint8Array;
  /** 图片像素尺寸 */
  px: number;
  py: number;
  /** 页面尺寸（点，1/72 英寸） */
  w: number;
  h: number;
}

const enc = new TextEncoder();

/** PDF 文本字符串：UTF-16BE + BOM，写成十六进制，中文标题也不会乱码 */
function pdfText(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const num = (n: number): string => String(Math.round(n * 100) / 100);

export function buildPdf(pages: readonly PdfImagePage[], title = '', now = new Date()): Uint8Array {
  const chunks: Uint8Array[] = [];
  let pos = 0;
  const offsets: number[] = [];
  const push = (b: Uint8Array | string) => {
    const u = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(u);
    pos += u.length;
  };
  const obj = (id: number, body: string) => {
    offsets[id] = pos;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  // 头：第二行几个大于 127 的字节，告诉传输工具这是二进制文件
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const n = pages.length;
  const pageId = (k: number) => 4 + k * 3;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, k) => `${pageId(k)} 0 R`).join(' ')}] /Count ${n} >>`);
  obj(3, `<< /Title ${pdfText(title)} /Producer (Peekit) /CreationDate (${pdfDate(now)}) >>`);
  pages.forEach((p, k) => {
    const id = pageId(k);
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.w)} ${num(p.h)}] ` +
      `/Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const content = `q\n${num(p.w)} 0 0 ${num(p.h)} 0 0 cm\n/Im0 Do\nQ\n`;
    obj(id + 1, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`);
    offsets[id + 2] = pos;
    push(`${id + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${Math.round(p.px)} /Height ${Math.round(p.py)} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg);
    push('\nendstream\nendobj\n');
  });

  const size = 4 + n * 3;
  const xref = pos;
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
