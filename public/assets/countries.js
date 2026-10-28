/**
 * Countries for the homepage search and the freight page, in the order customers expect:
 * the UK and its parts first, then the USA, China, Europe and the rest of the world.
 * code: ISO country; pc: a representative postcode so we can price without a full address;
 * city: the place used for freight estimates when the customer gives no town.
 */
export const SEP = '──────────';

export const UK_PLACES = [
  { n: 'United Kingdom', code: 'GB', pc: 'M1 1AE', city: 'Manchester' },
  { n: 'England', code: 'GB', pc: 'M1 1AE', city: 'Manchester' },
  { n: 'Scotland', code: 'GB', pc: 'EH1 1YZ', city: 'Edinburgh' },
  { n: 'Wales', code: 'GB', pc: 'CF10 1EP', city: 'Cardiff' },
  { n: 'Northern Ireland', code: 'GB', pc: 'BT1 1AA', city: 'Belfast' },
  { n: 'Scottish Highlands & Islands', code: 'GB', pc: 'IV1 1AA', city: 'Inverness' },
  { n: 'Channel Islands', code: 'JE', pc: 'JE2 3AB', city: 'St Helier' },
];

export const WORLD = [
  { n: 'United States', code: 'US', pc: '10001', city: 'New York' },
  { n: 'China', code: 'CN', pc: '518000', city: 'Shenzhen' },
  // Europe
  { n: 'Germany', code: 'DE', pc: '10115', city: 'Berlin' },
  { n: 'France', code: 'FR', pc: '75001', city: 'Paris' },
  { n: 'Ireland', code: 'IE', pc: 'D02 X285', city: 'Dublin' },
  { n: 'Netherlands', code: 'NL', pc: '1012 AB', city: 'Amsterdam' },
  { n: 'Belgium', code: 'BE', pc: '1000', city: 'Brussels' },
  { n: 'Spain', code: 'ES', pc: '28001', city: 'Madrid' },
  { n: 'Italy', code: 'IT', pc: '00184', city: 'Rome' },
  { n: 'Portugal', code: 'PT', pc: '1100-148', city: 'Lisbon' },
  { n: 'Poland', code: 'PL', pc: '00-001', city: 'Warsaw' },
  { n: 'Austria', code: 'AT', pc: '1010', city: 'Vienna' },
  { n: 'Denmark', code: 'DK', pc: '1050', city: 'Copenhagen' },
  { n: 'Sweden', code: 'SE', pc: '111 20', city: 'Stockholm' },
  { n: 'Switzerland', code: 'CH', pc: '8001', city: 'Zurich' },
  { n: 'Czech Republic', code: 'CZ', pc: '110 00', city: 'Prague' },
  { n: 'Greece', code: 'GR', pc: '105 57', city: 'Athens' },
  // rest of the world
  { n: 'Turkey', code: 'TR', pc: '34000', city: 'Istanbul' },
  { n: 'United Arab Emirates', code: 'AE', pc: '00000', city: 'Dubai' },
  { n: 'India', code: 'IN', pc: '110001', city: 'New Delhi' },
  { n: 'Hong Kong', code: 'HK', pc: '999077', city: 'Hong Kong' },
  { n: 'Vietnam', code: 'VN', pc: '700000', city: 'Ho Chi Minh City' },
  { n: 'Japan', code: 'JP', pc: '100-0001', city: 'Tokyo' },
  { n: 'South Korea', code: 'KR', pc: '04524', city: 'Seoul' },
  { n: 'Singapore', code: 'SG', pc: '018989', city: 'Singapore' },
  { n: 'Pakistan', code: 'PK', pc: '74000', city: 'Karachi' },
  { n: 'Bangladesh', code: 'BD', pc: '1000', city: 'Dhaka' },
  { n: 'Saudi Arabia', code: 'SA', pc: '11564', city: 'Riyadh' },
  { n: 'Australia', code: 'AU', pc: '2000', city: 'Sydney' },
  { n: 'New Zealand', code: 'NZ', pc: '1010', city: 'Auckland' },
  { n: 'Canada', code: 'CA', pc: 'M5V 2T6', city: 'Toronto' },
  { n: 'Mexico', code: 'MX', pc: '06000', city: 'Mexico City' },
  { n: 'Brazil', code: 'BR', pc: '01310-100', city: 'Sao Paulo' },
  { n: 'South Africa', code: 'ZA', pc: '2000', city: 'Johannesburg' },
  { n: 'Nigeria', code: 'NG', pc: '100001', city: 'Lagos' },
];

export const ALL_PLACES = [...UK_PLACES, ...WORLD];
export const place = (name) => ALL_PLACES.find((p) => p.n === name) || null;
export const placeByCode = (code) => ALL_PLACES.find((p) => p.code === code && p.n !== 'England') || null;
export const isUk = (name) => UK_PLACES.some((p) => p.n === name);
/** Option list with a gap after the UK, for <select>. */
export const OPTIONS = [...UK_PLACES.map((p) => p.n), SEP, ...WORLD.map((p) => p.n)];
