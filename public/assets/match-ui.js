/* Kargom FreightMatch: categories, icons and small helpers shared by the board, the job page and the post form. */
import { esc, gbp } from './market-ui.js';

const sv = (d, w = 24) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  furniture: sv('<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2z"/><path d="M5 18v2M19 18v2"/>'),
  boxes: sv('<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
  home: sv('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  office: sv('<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10.5 21v-3h3v3"/>'),
  pallets: sv('<rect x="4" y="3" width="16" height="11" rx="1"/><path d="M4 8.5h16M2 14h20M3 14v5M12 14v5M21 14v5M2 19h20"/>'),
  cars: sv('<path d="M5 16H3v-4l2-5h14l2 5v4h-2"/><path d="M5 12h14"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/>'),
  motorbikes: sv('<circle cx="5.5" cy="16.5" r="3"/><circle cx="18.5" cy="16.5" r="3"/><path d="M5.5 16.5l4-6h5l4 6M9.5 10.5L8 7H5M14.5 10.5l1.5-3h3"/>'),
  vehicles: sv('<path d="M2 6h12v10H2zM14 9h4l4 4v3h-8z"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>'),
  boats: sv('<path d="M2 20c1.5 0 2.5-1 4-1s2.5 1 4 1 2.5-1 4-1 2.5 1 4 1 2.5-1 4-1"/><path d="M4 16l-1-4h18l-2 4"/><path d="M12 12V3l6 7"/>'),
  pianos: sv('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 12h18M7 12v7M11 12v7M15 12v7M8.5 12v4M12.5 12v4"/>'),
  machinery: sv('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  international: sv('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>'),
  other: sv('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
  pin: sv('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>', 18),
  flag: sv('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>', 18),
  cal: sv('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 18),
  route: sv('<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>', 18),
  search: sv('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>', 20),
  check: sv('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 18),
  camera: sv('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>', 20),
  filter: sv('<path d="M3 5h18M6 12h12M10 19h4"/>', 20),
  chev: sv('<path d="M9 6l6 6-6 6"/>', 18),
  tag: sv('<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>', 18),
};

export const CATS = {
  furniture: 'Furniture and general items', boxes: 'Boxes and parcels', home: 'Home move', office: 'Office move', pallets: 'Pallets and haulage',
  cars: 'Cars', motorbikes: 'Motorbikes', vehicles: 'Vans, caravans and other vehicles', boats: 'Boats', pianos: 'Pianos', machinery: 'Machinery and equipment', other: 'Other',
};
/** Short names for chips and cards. */
export const CAT_SHORT = { furniture: 'Furniture', boxes: 'Boxes', home: 'Home move', office: 'Office move', pallets: 'Pallets', cars: 'Cars', motorbikes: 'Motorbikes',
  vehicles: 'Vans and vehicles', boats: 'Boats', pianos: 'Pianos', machinery: 'Machinery', international: 'International', other: 'Other' };
export const VEHICLE_CATS = ['cars', 'motorbikes', 'vehicles', 'boats'];
export const ACCESS_CATS = ['furniture', 'home', 'office', 'pianos'];
export const PLACEHOLDER = {
  furniture: 'e.g. Three-seater sofa and a double wardrobe', boxes: 'e.g. 12 boxes of books and kitchen things', home: 'e.g. 2 bedroom flat, mostly boxes and a sofa',
  office: 'e.g. 15 desks, chairs, 2 printers and filing cabinets', pallets: 'e.g. 4 pallets of flooring, 900 kg', cars: 'e.g. 2015 VW Golf hatchback',
  motorbikes: 'e.g. Honda CB500F', vehicles: 'e.g. Ford Transit van, or a 4-berth caravan', boats: 'e.g. 5 m dinghy on a road trailer', pianos: 'e.g. Upright piano',
  machinery: 'e.g. Mini digger, 1.5 tonnes', other: 'Tell transport companies what needs moving',
};

export const priceRange = (e) => (e ? `${gbp(e.lowPence).replace('.00', '')} – ${gbp(e.highPence).replace('.00', '')}` : '');
export const dayTxt = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Flexible');
export const catTile = (cat, size = 56) => `<span class="fm-ic fm-ic-${esc(cat)}" style="width:${size}px;height:${size}px">${ICON[cat] || ICON.other}</span>`;
