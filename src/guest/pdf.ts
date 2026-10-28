/** A tiny one-page A6 PDF with text lines, used for test labels from the demo provider. */
export function minimalLabelPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (m) => `\\${m}`).replace(/[^\x20-\x7E]/g, '?');
  const W = 298, H = 420; // A6 in points
  let y = H - 40;
  const text = lines.map((l, i) => {
    const size = i === 0 ? 13 : /^(FROM|TO):$/.test(l) ? 9 : 11;
    const out = `BT /F1 ${size} Tf 24 ${y} Td (${esc(l)}) Tj ET`;
    y -= l === '' ? 8 : size + 6;
    return out;
  }).join('\n');
  const stream = `0.9 g 16 ${H - 70} ${W - 32} 44 re f 0 g\n2 w 16 16 ${W - 32} ${H - 32} re S\n${text}`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
