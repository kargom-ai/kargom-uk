import { Pdf, kargomLogo, wrap } from './pdf.ts';

/**
 * The quote-request sheet: everything a removal company or haulier needs to price the job,
 * on one clear page, with the customer's photos after it. The customer sends it themselves
 * (WhatsApp, email), so it carries their name and phone number.
 */

type Addr = { line1: string; line2?: string; city: string; postcode: string; country: string };
export type SheetJob = {
  ref: number; kind: string; title: string; details: Record<string, any>; from: Addr; to: Addr; date: string | null;
  distanceMiles: number | null; createdAt: string; contactName: string; contactPhone: string;
};

const L = {
  moveType: { home: 'Home move', office: 'Office move', items: 'A few items' },
  size: { studio: 'Studio flat', 1: '1 bedroom', 2: '2 bedrooms', 3: '3 bedrooms', 4: '4 bedrooms', 5: '5+ bedrooms', small: 'Small office (up to 10 desks)', medium: 'Medium office (10-30 desks)', large: 'Large office (30+ desks)' },
  floor: { ground: 'Ground floor', 1: '1st floor', 2: '2nd floor', 3: '3rd floor', '4+': '4th floor or higher' },
  parking: { easy: 'Easy parking outside', permit: 'Permit or paid parking', hard: 'Hard to park nearby' },
  dateFlex: { exact: 'This date only', week: 'Within a few days', flexible: 'Flexible' },
  load: { ftl: 'Full truck load (FTL)', ltl: 'Part load / pallets (LTL)' },
  vehicle: { van: 'Large van (up to 1.2 t)', '7.5t': '7.5 tonne lorry', '18t': '18 tonne rigid', '26t': '26 tonne rigid', artic: 'Articulated lorry (13.6 m)' },
  palletType: { uk: 'UK standard 120 x 100 cm', euro: 'Euro 120 x 80 cm', half: 'Half pallet', quarter: 'Quarter pallet', other: 'Other / mixed' },
  collectWindow: { any: 'Any time', am: 'Morning', pm: 'Afternoon' },
} as Record<string, Record<string, string>> & { floor: Record<string, string>; parking: Record<string, string>; collectWindow: Record<string, string>; moveType: Record<string, string>; size: Record<string, string>; dateFlex: Record<string, string>; load: Record<string, string>; vehicle: Record<string, string>; palletType: Record<string, string> };
const day = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-');
const place = (a: Addr) => [a.city, a.postcode, a.country !== 'GB' ? a.country : ''].filter(Boolean).join(' ');
const yes = (b: unknown) => (b ? 'Yes' : 'No');

export function requestSheet(job: SheetJob, photos: Buffer[]): Buffer {
  const pdf = new Pdf();
  const M = 40, R = pdf.W - M, CW = R - M;
  const d = job.details;
  const rem = job.kind === 'removals';

  // header
  const logo = kargomLogo();
  if (logo) pdf.image(logo, M, 34, 190, 26); else pdf.text('Kargom.co.uk', M, 54, { size: 18, bold: true });
  pdf.text(rem ? 'MOVING QUOTE REQUEST' : 'FREIGHT QUOTE REQUEST', R, 42, { size: 8, bold: true, color: '#586579', align: 'right' });
  pdf.text(`#${job.ref}`, R, 60, { size: 16, bold: true, align: 'right' });
  pdf.text(`Sent ${day(job.createdAt)}`, R, 73, { size: 8, color: '#586579', align: 'right' });

  // title band
  pdf.rect(M, 88, CW, 66, '#2463DB');
  pdf.text(job.title, M + 18, 116, { size: 19, bold: true, color: '#FFFFFF' });
  pdf.text(`${place(job.from)}  ->  ${place(job.to)}${job.distanceMiles ? `   ·   ~${job.distanceMiles} miles` : ''}`, M + 18, 138, { size: 11, color: '#DCE4F2' });

  // A / B cards
  let y = 170;
  const half = (CW - 14) / 2;
  const card = (x: number, tag: string, color: string, title: string, a: Addr, lines: string[]) => {
    pdf.rect(x, y, half, 112, '#F5F8FC', '#E1E7EF');
    pdf.rect(x + 14, y + 14, 22, 22, color);
    pdf.text(tag, x + 21, y + 29.5, { size: 11, bold: true, color: '#FFFFFF' });
    pdf.text(title, x + 46, y + 23, { size: 8, bold: true, color: '#586579' });
    pdf.text(place(a), x + 46, y + 37, { size: 12, bold: true });
    lines.forEach((l, i) => pdf.text(l, x + 14, y + 60 + i * 14, { size: 9.5, color: '#3E4A5C' }));
  };
  if (rem) {
    const p = (k: 'fromPlace' | 'toPlace') => { const v = d[k] ?? {}; return [`${L.floor[v.floor] ?? '-'}${v.lift ? ', lift available' : ', no lift'}`, L.parking[v.parking] ?? '']; };
    card(M, 'A', '#2463DB', 'MOVING FROM', job.from, p('fromPlace'));
    card(M + half + 14, 'B', '#16A34A', 'MOVING TO', job.to, p('toPlace'));
  } else {
    card(M, 'A', '#2463DB', 'COLLECTION', job.from, [`${day(job.date)} · ${L.collectWindow[d.collectWindow] ?? 'Any time'}`, `Tail lift needed: ${yes(d.tailLiftCollection)}`]);
    card(M + half + 14, 'B', '#16A34A', 'DELIVERY', job.to, [`Deliver by: ${d.deliverBy ? day(d.deliverBy) : 'Flexible'}`, `Tail lift needed: ${yes(d.tailLiftDelivery)}`]);
  }
  y += 130;

  // key details
  pdf.text(rem ? 'The move' : 'The load', M, y, { size: 13, bold: true });
  y += 10;
  const rows: Array<[string, string]> = rem ? [
    ['Type of move', L.moveType[d.moveType] ?? '-'],
    ...(d.size ? [['Size', L.size[d.size] ?? d.size] as [string, string]] : []),
    ...(d.items?.length ? [['Items', d.items.join(', ')] as [string, string]] : []),
    ['Moving date', `${day(job.date)} (${L.dateFlex[d.dateFlex] ?? 'This date only'})`],
    ['Packing service', yes(d.packing)],
    ['Dismantle and reassemble furniture', yes(d.dismantling)],
    ['Storage needed', yes(d.storage)],
    ...(job.distanceMiles ? [['Distance', `About ${job.distanceMiles} miles by road`] as [string, string]] : []),
  ] : [
    ['Load', `${L.load[d.load] ?? '-'}${d.load === 'ftl' ? ` · ${L.vehicle[d.vehicle] ?? ''}` : ` · ${d.pallets} x ${L.palletType[d.palletType] ?? ''}`}`],
    ['Goods', String(d.goods ?? '-')],
    ['Total weight', `${Number(d.weightKg ?? 0).toLocaleString('en-GB')} kg`],
    ['Stackable', yes(d.stackable)],
    ['Hazardous (ADR)', yes(d.adr)],
    ['Temperature controlled', yes(d.tempControlled)],
    ...(job.distanceMiles ? [['Distance', `About ${job.distanceMiles} miles by road`] as [string, string]] : []),
  ];
  for (const [k, v] of rows) {
    const lines = wrap(v, 10.5, CW - 210, true);
    const h = Math.max(24, 10 + lines.length * 14);
    pdf.line(M, y, R, y);
    pdf.text(k, M + 2, y + 16, { size: 10, color: '#586579' });
    lines.forEach((l, i) => pdf.text(l, M + 200, y + 16 + i * 14, { size: 10.5, bold: true }));
    y += h;
  }
  pdf.line(M, y, R, y);
  y += 22;

  if (d.notes) {
    const lines = wrap(String(d.notes), 10, CW - 28).slice(0, 10);
    const h = 30 + lines.length * 14;
    pdf.rect(M, y, CW, h, '#FFF8EC', '#F6DDB0');
    pdf.text('Notes from the customer', M + 14, y + 18, { size: 9, bold: true, color: '#7A4700' });
    lines.forEach((l, i) => pdf.text(l, M + 14, y + 34 + i * 14, { size: 10, color: '#3E4A5C' }));
    y += h + 16;
  }

  // contact
  pdf.rect(M, y, CW, 58, '#1F2A3C');
  pdf.text('Please reply with your best price', M + 16, y + 22, { size: 12, bold: true, color: '#FFFFFF' });
  pdf.text(`${job.contactName} · ${job.contactPhone}`, M + 16, y + 42, { size: 11, color: '#DCE4F2' });
  if (photos.length) pdf.text(`${photos.length} photo${photos.length > 1 ? 's' : ''} on the next page`, R - 16, y + 42, { size: 9, color: '#8FB4F5', align: 'right' });
  y += 76;

  pdf.text('Sent with Kargom.co.uk, free quotes for moves and freight. Are you a removal company or haulier? Get jobs like this free: kargom.co.uk/partner', M, Math.max(y, pdf.H - 30), { size: 7.5, color: '#8593A8' });

  // photos: two per row, as many pages as needed
  if (photos.length) {
    pdf.newPage();
    pdf.text(`Photos · request #${job.ref}`, M, 50, { size: 14, bold: true });
    const gw = (CW - 14) / 2, gh = 230;
    let py = 70;
    photos.forEach((ph, i) => {
      const col = i % 2;
      if (col === 0 && i > 0) py += gh + 14;
      if (py + gh > pdf.H - 40) { pdf.newPage(); py = 40; }
      const x = M + col * (gw + 14);
      pdf.rect(x, py, gw, gh, '#EEF2F7');
      pdf.image(ph, x + 4, py + 4, gw - 8, gh - 8);
    });
  }
  return pdf.build();
}
