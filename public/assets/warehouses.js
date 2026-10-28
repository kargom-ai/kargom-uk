/**
 * Marketplace warehouses sellers ship stock into, so the customer can pick one instead of typing
 * an address. Sources: amzprep.com UK list (Oct 2026), flexfulfillment.eu, amzprep.com TikTok list.
 * Seller Central / Seller Center shipping plans always have the final address.
 */
export const AMAZON = {
  GB: [
    ['BHX1', 'Rugeley', 'WS15 1LX'], ['BHX2', 'Coalville', 'LE67 1FB'], ['BHX3', 'Daventry', 'NN11 8QL'], ['BHX4', 'Coventry', 'CV5 9FA'], ['BHX5', 'Rugby', 'CV23 0XF'],
    ['BHX7', 'Hinckley', 'LE10 3FF'], ['BHX8', 'Redditch', 'B98 9AY'], ['BRS1', 'Bristol', 'BS35 4DJ'], ['BRS2', 'Swindon', 'SN3 4DB'], ['CWL1', 'Swansea', 'SA1 8QX'],
    ['EDI4', 'Dunfermline', 'KY11 8ST'], ['EMA1', 'Kegworth', 'DE74 2BB'], ['EMA2', 'Sutton-in-Ashfield', 'NG17 5NB'], ['EMA3', 'Eastwood', 'NG16 3UA'], ['EMA4', 'Sutton Coldfield', 'B76 9AH'],
    ['EUK5', 'Peterborough', 'PE2 9EN'], ['LBA2', 'Doncaster', 'DN11 0BG'], ['LBA3', 'Doncaster', 'DN4 5JP'], ['LBA4', 'Doncaster', 'DN11 0BF'], ['LBA8', 'Leeds', 'LS15 0AT'],
    ['LCY2', 'Tilbury', 'RM18 7AN'], ['LCY3', 'Dartford', 'DA1 5PT'], ['LCY8', 'Rochester', 'ME3 9GX'], ['LTN1', 'Ridgmont', 'MK43 0ZA'], ['LTN4', 'Dunstable', 'LU5 4FE'],
    ['LTN7', 'Bedford', 'MK43 9RT'], ['MAN1', 'Manchester Airport', 'M90 5DL'], ['MAN2', 'Warrington', 'WA5 3XA'], ['MAN3', 'Bolton', 'BL5 1BT'], ['MAN4', 'Chesterfield', 'S43 4PZ'],
    ['MAN8', 'Haydock', 'WA11 9FS'], ['MME1', 'Darlington', 'DL1 4PG'], ['MME2', 'Durham', 'DH6 5NR'], ['NCL1', 'Gateshead', 'NE10 8YA'], ['STN8', 'Milton Keynes', 'MK17 8EW'],
  ],
  US: [
    ['ABE8', 'Florence, NJ', '08518'], ['ATL6', 'East Point, GA', '30344'], ['AVP1', 'Hazleton, PA', '18202'], ['BFI4', 'Kent, WA', '98032'], ['CLT2', 'Charlotte, NC', '28214'],
    ['CMH1', 'Etna, OH', '43062'], ['DFW7', 'Fort Worth, TX', '76177'], ['DTW1', 'Romulus, MI', '48174'], ['EWR4', 'Robbinsville, NJ', '08691'], ['FTW1', 'Dallas, TX', '75241'],
    ['IND9', 'Greenwood, IN', '46143'], ['JFK8', 'Staten Island, NY', '10314'], ['LAX9', 'Fontana, CA', '92337'], ['LGB8', 'Rialto, CA', '92376'], ['MCO1', 'Orlando, FL', '32824'],
    ['MDW2', 'Joliet, IL', '60433'], ['MEM1', 'Memphis, TN', '38118'], ['ONT8', 'Moreno Valley, CA', '92551'], ['PHX7', 'Phoenix, AZ', '85043'], ['RDU1', 'Garner, NC', '27529'],
    ['SAV3', 'Macon, GA', '31216'], ['SMF3', 'Stockton, CA', '95206'], ['STL4', 'Edwardsville, IL', '62025'], ['TEB9', 'Somerset, NJ', '08873'],
  ],
};

/** TikTok does not publish warehouse codes, so these are by town: [town, postcode]. */
export const TIKTOK = {
  GB: [['West Midlands (Coventry / Rugby area)', 'CV23']],
  US: [
    ['Rialto, CA', '92376'], ['Fontana, CA', '92337'], ['Eastvale, CA', '91752'], ['Chino, CA', '91708'],
    ['Middlesex, NJ', '08846'], ['Old Bridge, NJ', '08857'], ['Port Reading, NJ', '07064'],
    ['Stafford, TX', '77477'], ['Houston, TX', '77085'], ['Carol Stream, IL', '60188'], ['Joliet, IL', '60436'], ['Buford, GA', '30518'],
  ],
};
