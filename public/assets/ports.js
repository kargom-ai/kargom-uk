/**
 * Main container ports and cargo airports per country: [code, name, 'sea' | 'air'].
 * Codes are UN/LOCODEs for ports and IATA codes for airports, as forwarders write them.
 */
const P = (code, name) => [code, name, 'sea'];
const A = (code, name) => [code, name, 'air'];
export const PORTS = {
  GB: [P('GBFXT', 'Felixstowe'), P('GBLGP', 'London Gateway'), P('GBSOU', 'Southampton'), P('GBLIV', 'Liverpool'), P('GBTIL', 'Tilbury'), P('GBIMM', 'Immingham'), P('GBTEE', 'Teesport'), P('GBGRG', 'Grangemouth'), P('GBBEL', 'Belfast'),
    A('LHR', 'London Heathrow'), A('STN', 'London Stansted'), A('MAN', 'Manchester Airport'), A('EMA', 'East Midlands Airport'), A('BHX', 'Birmingham Airport')],
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
