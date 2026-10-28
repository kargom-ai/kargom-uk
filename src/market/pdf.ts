import { readFileSync } from 'node:fs';

/**
 * A small A4 PDF writer: Helvetica text, filled boxes and JPEG images. No dependencies.
 * Enough for the one-page "quote request" sheet a customer sends to a removal company.
 */

const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

/** Make text safe for WinAnsi Helvetica: swap the few symbols it lacks. */
export function winAnsi(s: string) {
  return String(s ?? '').replace(/[→⟶]/g, '->').replace(/≈/g, '~').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/–/g, '-').replace(/—/g, '-').replace(/…/g, '...')
    .replace(/[^\x20-\x7E£·×é]/g, '');
}
const code = (ch: string) => (ch === '£' ? 0xa3 : ch === '·' ? 0xb7 : ch === '×' ? 0xd7 : ch === 'é' ? 0xe9 : ch.charCodeAt(0));
export function textWidth(s: string, size: number, bold = false) {
  const t = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const ch of winAnsi(s)) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? t[c - 32]! : 556; }
  return (w * size) / 1000;
}
export function wrap(s: string, size: number, maxW: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of winAnsi(s).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) <= maxW || !line) line = next; else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

type Img = { name: string; data: Buffer; w: number; h: number; cs: string };
export function jpegInfo(buf: Buffer): { w: number; h: number; cs: string } | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1]!;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = buf.readUInt16BE(i + 5), w = buf.readUInt16BE(i + 7), n = buf[i + 9];
      return { w, h, cs: n === 1 ? '/DeviceGray' : n === 4 ? '/DeviceCMYK' : '/DeviceRGB' };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

export class Pdf {
  readonly W = 595.28;
  readonly H = 841.89;
  private pages: string[] = [];
  private cur: string[] = [];
  private imgs: Img[] = [];
  constructor() { this.newPage(); }

  newPage() { if (this.cur.length) this.pages.push(this.cur.join('\n')); this.cur = []; this.pages.length; return this; }

  private hex(s: string) { return Buffer.from([...winAnsi(s)].map(code)).toString('hex'); }
  private rgb(c: string) { const n = parseInt(c.replace('#', ''), 16); return `${((n >> 16) & 255) / 255} ${((n >> 8) & 255) / 255} ${(n & 255) / 255}`; }

  /** y is measured from the top of the page. */
  text(s: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'right' } = {}) {
    const size = o.size ?? 10;
    const xx = o.align === 'right' ? x - textWidth(s, size, o.bold) : x;
    this.cur.push(`BT ${this.rgb(o.color ?? '#1F2A3C')} rg /${o.bold ? 'F2' : 'F1'} ${size} Tf ${xx.toFixed(2)} ${(this.H - y).toFixed(2)} Td <${this.hex(s)}> Tj ET`);
  }
  rect(x: number, y: number, w: number, h: number, fill: string, stroke?: string) {
    this.cur.push(`${this.rgb(fill)} rg ${stroke ? `${this.rgb(stroke)} RG 0.8 w ` : ''}${x.toFixed(2)} ${(this.H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${stroke ? 'B' : 'f'}`);
  }
  line(x1: number, y1: number, x2: number, y2: number, color = '#E1E7EF', width = 1) {
    this.cur.push(`${this.rgb(color)} RG ${width} w ${x1} ${this.H - y1} m ${x2} ${this.H - y2} l S`);
  }
  /** Draws a JPEG fitted inside the box, keeping its shape. Returns false if it is not a JPEG. */
  image(jpeg: Buffer, x: number, y: number, boxW: number, boxH: number) {
    const info = jpegInfo(jpeg);
    if (!info) return false;
    const name = `Im${this.imgs.length + 1}`;
    this.imgs.push({ name, data: jpeg, ...info });
    const k = Math.min(boxW / info.w, boxH / info.h);
    const w = info.w * k, h = info.h * k;
    const dx = x + (boxW - w) / 2, dy = y + (boxH - h) / 2;
    this.cur.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${dx.toFixed(2)} ${(this.H - dy - h).toFixed(2)} cm /${name} Do Q`);
    return true;
  }

  build(): Buffer {
    if (this.cur.length) this.pages.push(this.cur.join('\n'));
    this.cur = [];
    const objs: Array<string | Buffer> = [];
    const add = (o: string | Buffer) => { objs.push(o); return objs.length; };
    const catalog = add(''), pagesId = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imgIds = this.imgs.map((im) => add(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace ${im.cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n`, 'latin1'),
      im.data, Buffer.from('\nendstream', 'latin1')])));
    const xobj = this.imgs.map((im, i) => `/${im.name} ${imgIds[i]} 0 R`).join(' ');
    const pageIds = this.pages.map((content) => {
      const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
      return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Contents ${c} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> /XObject << ${xobj} >> >> >>`);
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    let len = parts[0]!.length;
    const offsets: number[] = [];
    objs.forEach((o, i) => {
      offsets.push(len);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), typeof o === 'string' ? Buffer.from(o, 'latin1') : o, Buffer.from('\nendobj\n', 'latin1')]);
      parts.push(b); len += b.length;
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${len}\n%%EOF\n`;
    parts.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(parts);
  }
}

let logo: Buffer | null | undefined;
export function kargomLogo(): Buffer | null {
  if (logo === undefined) {
    try { logo = readFileSync(new URL('../../public/assets/logo-pdf.jpg', import.meta.url)); } catch { logo = null; }
  }
  return logo;
}
