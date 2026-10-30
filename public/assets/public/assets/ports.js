/**
 * Main container ports and cargo airports per country: [code, name, 'sea' | 'air'].
 * Codes are UN/LOCODEs for ports and IATA codes for airports, as forwarders write them.
 */
const P = (code, name, pc) => [code, name, 'sea', pc];
const A = (code, name, pc) => [code, name, 'air', pc];
export const PORTS = {
  // UK entries carry the terminal postcode, so a port works as a UK address
  GB: [P('GBFXT', 'Felixstowe', 'IP11 3SY'), P('GBLGP', 'London Gateway', 'SS17 9DY'), P('GBSOU', 'Southampton', 'SO15 1HJ'), P('GBLIV', 'Liverpool', 'L20 1BY'), P('GBTIL', 'Tilbury', 'RM18 7EH'), P('GBIMM', 'Immingham', 'DN40 2LZ'), P('GBTEE', 'Teesport', 'TS6 6UD'), P('GBGRG', 'Grangemouth', 'FK3 8UE'), P('GBBEL', 'Belfast', 'BT3 9AG'),
    A('LHR', 'London Heathrow', 'TW6 2GA'), A('STN', 'London Stansted', 'CM24 1QW'), A('MAN', 'Manchester Airport', 'M90 1QX'), A('EMA', 'East Midlands Airport', 'DE74 2SA'), A('BHX', 'Birmingham Airport', 'B26 3QJ')],
  CN: [P('CNSHA', 'Shanghai'), P('CNNGB', 'Ningbo'), P('CNYTN', 'Shenzhen (Yantian)'), P('CNSHK', 'Shenzhen (Shekou)'), P('CNNSA', 'Guangzhou (Nansha)'), P('CNTAO', 'Qingdao'), P('CNXMN', 'Xiamen'), P('CNTXG', 'Tianjin (Xingang)'), P('CNDLC', 'Dalian'),
    A('PVG', 'Shanghai Pudong Airport'), A('CAN', 'Guangzhou Airport'), A('SZX', 'Shenzhen Airport'), A('PEK', 'Beijing Airport'), A('HGH', 'Hangzhou Airport'), A('CGO', 'Zhengzhou Airport')],
  HK: [P('HKHKG', 'Hong Kong'), A('HKG', 'Hong Kong Airport')],
  TW: [P('TWKHH', 'Kaohsiung'), P('TWKEL', 'Keelung'), A('TPE', 'Taipei Airport')],
  KR: [P('KRPUS', 'Busan'), A('ICN', 'Seoul Incheon Airport')],
  JP: [P('JPTYO', 'Tokyo'), P('JPYOK', 'Yokohama'), P('JPUKB', 'Kobe'), A('NRT', 'Tokyo Narita Airport'), A('KIX', 'Osaka Kansai Airport')],
  VN: [P('VNSGN', 'Ho Chi Minh City'), P('VNHPH', 'Haiphong'), A('SGN', 'Ho Chi Minh City Airport'), A('HAN', 'Hanoi Airport')],
  TH: [P('THLCH', 'Laem Chabang'), A('BKK', 'Bangkok Airport')],
  MY: [P('MYPKG', 'Port Klang'), P('MYTPP', 'Tanjung Pelepas'), A('KUL', 'Kuala Lumpur Airport')],
  SG: [P('SGSIN', 'Singapore'), A('SIN', 'Singapore Airport')],
  ID: [P('IDTPP', 'Jakarta (Tanjung Priok)'), P('IDSUB', 'Surabaya'), A('CGK', 'Jakarta Airport')],
  IN: [P('INNSA', 'Nhava Sheva (Mumbai)'), P('INMUN', 'Mundra'), P('INMAA', 'Chennai'), A('BOM', 'Mumbai Airport'), A('DEL', 'Delhi Airport'), A('MAA', 'Chennai Airport')],
  BD: [P('BDCGP', 'Chittagong'), A('DAC', 'Dhaka Airport')],
  PK: [P('PKKHI', 'Karachi'), A('KHI', 'Karachi Airport'), A('LHE', 'Lahore Airport')],
  AE: [P('AEJEA', 'Jebel Ali (Dubai)'), P('AEKHL', 'Khalifa (Abu Dhabi)'), A('DXB', 'Dubai Airport'), A('DWC', 'Dubai World Central')],
  SA: [P('SAJED', 'Jeddah'), P('SADMM', 'Dammam'), A('RUH', 'Riyadh Airport')],
  TR: [P('TRAMR', 'Istanbul (Ambarli)'), P('TRMER', 'Mersin'), P('TRIZM', 'Izmir'), P('TRGEM', 'Gemlik'), A('IST', 'Istanbul Airport'), A('SAW', 'Istanbul Sabiha Gokcen Airport')],
  US: [P('USLAX', 'Los Angeles'), P('USLGB', 'Long Beach'), P('USNYC', 'New York / New Jersey'), P('USSAV', 'Savannah'), P('USHOU', 'Houston'), P('USSEA', 'Seattle'), P('USOAK', 'Oakland'), P('USCHS', 'Charleston'), P('USORF', 'Norfolk'), P('USMIA', 'Miami'),
    A('JFK', 'New York JFK Airport'), A('LAX', 'Los Angeles Airport'), A('ORD', 'Chicago O\'Hare Airport'), A('MIA', 'Miami Airport'), A('ATL', 'Atlanta Airport'), A('DFW', 'Dallas Airport')],
  CA: [P('CAVAN', 'Vancouver'), P('CAMTR', 'Montreal'), P('CAHAL', 'Halifax'), A('YYZ', 'Toronto Airport'), A('YVR', 'Vancouver Airport')],
  MX: [P('MXZLO', 'Manzanillo'), P('MXVER', 'Veracruz'), A('MEX', 'Mexico City Airport')],
  BR: [P('BRSSZ', 'Santos'), A('GRU', 'Sao Paulo Airport')],
  AU: [P('AUMEL', 'Melbourne'), P('AUSYD', 'Sydney'), P('AUBNE', 'Brisbane'), A('SYD', 'Sydney Airport'), A('MEL', 'Melbourne Airport')],
  NZ: [P('NZAKL', 'Auckland'), A('AKL', 'Auckland Airport')],
  ZA: [P('ZADUR', 'Durban'), P('ZACPT', 'Cape Town'), A('JNB', 'Johannesburg Airport')],
  NG: [P('NGAPP', 'Lagos (Apapa)'), A('LOS', 'Lagos Airport')],
  EG: [P('EGPSD', 'Port Said'), P('EGALY', 'Alexandria'), A('CAI', 'Cairo Airport')],
  NL: [P('NLRTM', 'Rotterdam'), A('AMS', 'Amsterdam Schiphol Airport')],
  BE: [P('BEANR', 'Antwerp'), P('BEZEE', 'Zeebrugge'), A('LGG', 'Liege Airport'), A('BRU', 'Brussels Airport')],
  DE: [P('DEHAM', 'Hamburg'), P('DEBRV', 'Bremerhaven'), A('FRA', 'Frankfurt Airport'), A('LEJ', 'Leipzig Airport')],
  FR: [P('FRLEH', 'Le Havre'), P('FRMRS', 'Marseille (Fos)'), A('CDG', 'Paris CDG Airport')],
  ES: [P('ESVLC', 'Valencia'), P('ESALG', 'Algeciras'), P('ESBCN', 'Barcelona'), A('MAD', 'Madrid Airport')],
  PT: [P('PTSIE', 'Sines'), P('PTLEI', 'Leixoes (Porto)'), A('LIS', 'Lisbon Airport')],
  IT: [P('ITGOA', 'Genoa'), P('ITSPE', 'La Spezia'), P('ITGIT', 'Gioia Tauro'), A('MXP', 'Milan Malpensa Airport')],
  GR: [P('GRPIR', 'Piraeus'), A('ATH', 'Athens Airport')],
  PL: [P('PLGDN', 'Gdansk'), P('PLGDY', 'Gdynia'), A('WAW', 'Warsaw Airport')],
  DK: [P('DKAAR', 'Aarhus'), A('CPH', 'Copenhagen Airport')],
  SE: [P('SEGOT', 'Gothenburg'), A('ARN', 'Stockholm Airport')],
  NO: [P('NOOSL', 'Oslo'), A('OSL', 'Oslo Airport')],
  FI: [P('FIHEL', 'Helsinki'), A('HEL', 'Helsinki Airport')],
  IE: [P('IEDUB', 'Dublin'), P('IEORK', 'Cork'), A('DUB', 'Dublin Airport')],
};
export const portsFor = (country) => PORTS[country] || [];
export const portByCode = (country, c) => portsFor(country).find(([code]) => code === c) || null;

/** A port or airport as an address for a request: the code stands in for a postcode abroad. */
export function portAddress(country, c) {
  const p = portByCode(country, c);
  if (!p) return null;
  const [code, name, kind, pc] = p;
  return { line1: `${kind === 'air' ? '' : 'Port of '}${name} (${code})`, line2: '', city: name.replace(/ \(.*\)$/, '').replace(/ Airport$/, ''), postcode: pc || code, country };
}

/** Where each port and airport is, for the A → B map on international requests. [lat, lng] */
export const PORT_LL = {
  GBFXT: [51.955, 1.305], GBLGP: [51.505, 0.47], GBSOU: [50.9, -1.43], GBLIV: [53.46, -3.02], GBTIL: [51.46, 0.36], GBIMM: [53.63, -0.19], GBTEE: [54.6, -1.16], GBGRG: [56.03, -3.7], GBBEL: [54.62, -5.9],
  LHR: [51.47, -0.45], STN: [51.885, 0.235], MAN: [53.35, -2.28], EMA: [52.83, -1.33], BHX: [52.45, -1.75],
  CNSHA: [30.63, 122.07], CNNGB: [29.94, 121.88], CNYTN: [22.57, 114.27], CNSHK: [22.48, 113.91], CNNSA: [22.75, 113.6], CNTAO: [36.07, 120.32], CNXMN: [24.48, 118.08], CNTXG: [38.98, 117.75], CNDLC: [38.93, 121.65],
  PVG: [31.14, 121.81], CAN: [23.39, 113.3], SZX: [22.64, 113.81], PEK: [40.08, 116.58], HGH: [30.23, 120.43], CGO: [34.52, 113.84],
  HKHKG: [22.32, 114.12], HKG: [22.31, 113.92], TWKHH: [22.61, 120.28], TWKEL: [25.13, 121.74], TPE: [25.08, 121.23], KRPUS: [35.1, 129.04], ICN: [37.46, 126.44],
  JPTYO: [35.62, 139.78], JPYOK: [35.45, 139.65], JPUKB: [34.68, 135.2], NRT: [35.77, 140.39], KIX: [34.43, 135.24],
  VNSGN: [10.77, 106.75], VNHPH: [20.86, 106.68], SGN: [10.82, 106.66], HAN: [21.22, 105.81], THLCH: [13.08, 100.88], BKK: [13.69, 100.75],
  MYPKG: [3.0, 101.39], MYTPP: [1.36, 103.55], KUL: [2.75, 101.71], SGSIN: [1.26, 103.84], SIN: [1.36, 103.99], IDTPP: [-6.1, 106.88], IDSUB: [-7.2, 112.73], CGK: [-6.13, 106.66],
  INNSA: [18.95, 72.95], INMUN: [22.74, 69.7], INMAA: [13.1, 80.3], BOM: [19.09, 72.87], DEL: [28.56, 77.1], MAA: [12.99, 80.17], BDCGP: [22.31, 91.8], DAC: [23.84, 90.4],
  PKKHI: [24.84, 66.98], KHI: [24.91, 67.16], LHE: [31.52, 74.4], AEJEA: [25.01, 55.06], AEKHL: [24.81, 54.65], DXB: [25.25, 55.36], DWC: [24.9, 55.16],
  SAJED: [21.47, 39.17], SADMM: [26.5, 50.2], RUH: [24.96, 46.7], TRAMR: [40.97, 28.69], TRMER: [36.79, 34.64], TRIZM: [38.44, 27.14], TRGEM: [40.43, 29.11], IST: [41.26, 28.74], SAW: [40.9, 29.31],
  USLAX: [33.73, -118.26], USLGB: [33.75, -118.21], USNYC: [40.67, -74.15], USSAV: [32.12, -81.14], USHOU: [29.73, -95.27], USSEA: [47.58, -122.35], USOAK: [37.8, -122.3], USCHS: [32.8, -79.92],
  USORF: [36.9, -76.33], USMIA: [25.77, -80.17], JFK: [40.64, -73.78], LAX: [33.94, -118.41], ORD: [41.98, -87.9], MIA: [25.8, -80.29], ATL: [33.64, -84.43], DFW: [32.9, -97.04],
  CAVAN: [49.29, -123.1], CAMTR: [45.55, -73.53], CAHAL: [44.64, -63.57], YYZ: [43.68, -79.63], YVR: [49.19, -123.18], MXZLO: [19.06, -104.3], MXVER: [19.21, -96.13], MEX: [19.44, -99.07],
  BRSSZ: [-23.97, -46.3], GRU: [-23.43, -46.47], AUMEL: [-37.82, 144.92], AUSYD: [-33.97, 151.21], AUBNE: [-27.38, 153.17], SYD: [-33.94, 151.18], MEL: [-37.67, 144.84],
  NZAKL: [-36.84, 174.78], AKL: [-37.01, 174.79], ZADUR: [-29.87, 31.03], ZACPT: [-33.91, 18.43], JNB: [-26.14, 28.24], NGAPP: [6.44, 3.36], LOS: [6.58, 3.32],
  EGPSD: [31.26, 32.31], EGALY: [31.18, 29.87], CAI: [30.12, 31.41], NLRTM: [51.95, 4.05], AMS: [52.31, 4.76], BEANR: [51.26, 4.36], BEZEE: [51.33, 3.2], LGG: [50.64, 5.44], BRU: [50.9, 4.48],
  DEHAM: [53.54, 9.93], DEBRV: [53.56, 8.55], FRA: [50.04, 8.56], LEJ: [51.42, 12.24], FRLEH: [49.47, 0.15], FRMRS: [43.4, 4.89], CDG: [49.01, 2.55],
  ESVLC: [39.44, -0.32], ESALG: [36.13, -5.44], ESBCN: [41.34, 2.16], MAD: [40.49, -3.57], PTSIE: [37.95, -8.87], PTLEI: [41.18, -8.7], LIS: [38.77, -9.13],
  ITGOA: [44.4, 8.91], ITSPE: [44.1, 9.84], ITGIT: [38.45, 15.9], MXP: [45.63, 8.72], GRPIR: [37.94, 23.63], ATH: [37.94, 23.94], PLGDN: [54.4, 18.67], PLGDY: [54.53, 18.55], WAW: [52.17, 20.97],
  DKAAR: [56.15, 10.23], CPH: [55.62, 12.65], SEGOT: [57.69, 11.86], ARN: [59.65, 17.92], NOOSL: [59.9, 10.73], OSL: [60.19, 11.1], FIHEL: [60.21, 25.19], HEL: [60.32, 24.96],
  IEDUB: [53.35, -6.21], IEORK: [51.85, -8.3], DUB: [53.42, -6.27],
};
/** When we only know the country: its main business city. */
export const COUNTRY_LL = {
  GB: [51.5, -0.12], IE: [53.35, -6.26], FR: [48.86, 2.35], DE: [50.11, 8.68], NL: [52.37, 4.9], BE: [50.85, 4.35], ES: [40.42, -3.7], IT: [45.46, 9.19], PL: [52.23, 21.01], PT: [38.72, -9.14],
  AT: [48.21, 16.37], DK: [55.68, 12.57], SE: [59.33, 18.07], CZ: [50.08, 14.44], CH: [47.37, 8.54], GR: [37.98, 23.73], US: [40.71, -74.0], CN: [31.23, 121.47], HK: [22.32, 114.17],
  TW: [25.03, 121.56], VN: [10.82, 106.63], IN: [19.08, 72.88], BD: [23.81, 90.41], PK: [24.86, 67.0], TR: [41.01, 28.98], AE: [25.2, 55.27], SA: [24.71, 46.68], JP: [35.68, 139.69],
  KR: [37.57, 126.98], SG: [1.35, 103.82], TH: [13.76, 100.5], MY: [3.14, 101.69], ID: [-6.2, 106.85], CA: [43.65, -79.38], MX: [19.43, -99.13], BR: [-23.55, -46.63], AU: [-33.87, 151.21],
  NZ: [-36.85, 174.76], ZA: [-26.2, 28.05], NG: [6.52, 3.38],
};
