/**
 * Courier guide content. Written by hand, kept factual and general on purpose:
 * anything that changes often (prices, exact size limits) comes from live quotes instead.
 */

export type Faq = { q: string; a: string };
export type CarrierInfo = {
  key: string;            // our carrier code
  slug: string;
  name: string;
  logo: string;
  short: string;          // one line for cards and meta descriptions
  intro: string[];        // paragraphs
  ways: Array<[string, string]>; // how to hand it over: [title, text]
  goodFor: string[];
  track: {
    url: (n: string) => string;
    deep: boolean;        // true when the link opens the result directly; false = we copy the number and open the page
    format: string;       // human description of the tracking number
    example?: string;
    where: string;        // where to find the number
    statuses: Array<[string, string]>;
  };
  faq: Faq[];
};

const enc = encodeURIComponent;

export const CARRIERS: CarrierInfo[] = [
  {
    key: 'royal_mail', slug: 'royal-mail', name: 'Royal Mail', logo: '/assets/carriers/royalmail.png',
    short: 'The UK postal service: Tracked 24 and Tracked 48, with drop-off at Post Offices and parcel postboxes.',
    intro: [
      'Royal Mail is the UK\'s postal service and reaches every address in the country, including the Highlands, islands and Northern Ireland, at the same price as anywhere else. That universal reach is the main reason people still choose it for small parcels.',
      'For parcels the useful services are Tracked 24 (aims for next working day) and Tracked 48 (aims for two working days). Both come with a tracking number and a delivery photo or signature, which matters if you sell online and need proof of delivery.',
      'Booked through Kargom you pay online, print the label at home and hand the parcel over like any other post. There is no queue at the counter to pay.',
    ],
    ways: [
      ['Post Office', 'Hand it over at any Post Office branch. Many are open on Saturdays and some on Sundays.'],
      ['Parcel postbox', 'Small parcels with a printed label can go in a Royal Mail parcel postbox, if there is one near you.'],
      ['Collection', 'On some services Royal Mail can collect from your door with the postie or a separate collection.'],
    ],
    goodFor: ['Small and light parcels', 'Remote UK addresses at standard prices', 'Online sellers who need proof of delivery'],
    track: {
      url: (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${enc(n)}`, deep: true,
      format: 'Two letters, nine numbers and the letters GB, for example AB123456789GB.', example: 'AB123456789GB',
      where: 'On your Kargom label and booking email, or on the receipt if you posted at a Post Office.',
      statuses: [
        ['Item received', 'Royal Mail has scanned the parcel in. It is on its way through the network.'],
        ['Out for delivery', 'It is with the local delivery office and should arrive today.'],
        ['Delivered', 'Delivered, usually with a photo or a signature you can see on Royal Mail\'s page.'],
        ['Something for you card', 'Nobody was in. The card says whether it was left with a neighbour or taken back to the delivery office.'],
      ],
    },
    faq: [
      { q: 'How long does Royal Mail Tracked 48 take?', a: 'Royal Mail aims to deliver Tracked 48 parcels within two working days and Tracked 24 the next working day. These are targets, not guarantees, and they do not count Sundays or bank holidays.' },
      { q: 'Can I post a Royal Mail parcel in a postbox?', a: 'Small parcels with a printed label can go in a parcel postbox. Larger parcels need to go to a Post Office branch.' },
      { q: 'Does Royal Mail deliver to the Scottish Highlands at the same price?', a: 'Yes. Royal Mail charges the same for any UK address, which often makes it the cheapest choice for the Highlands, islands and Northern Ireland, where other couriers add a surcharge.' },
    ],
  },
  {
    key: 'evri', slug: 'evri', name: 'Evri', logo: '/assets/carriers/evri.png',
    short: 'Low-cost UK delivery with thousands of ParcelShops and lockers, plus collection from your door.',
    intro: [
      'Evri is the company that used to be called Hermes in the UK. It changed its name in 2022 but it is the same network, and it handles a large share of the UK\'s online shopping deliveries.',
      'Evri is usually one of the cheapest ways to send a parcel within the UK, which is why it often tops the price list on Kargom. You can drop the parcel at a local ParcelShop, which is often a corner shop or petrol station, or book a collection from your door.',
      'Evri is a good fit for everyday parcels that do not need a guaranteed time slot: clothes, books, small electronics and second-hand sales.',
    ],
    ways: [
      ['ParcelShop', 'Drop off at a local shop in the Evri network. Most are open long hours, including weekends.'],
      ['Locker', 'Some areas have Evri lockers where you can drop off at any time.'],
      ['Collection', 'Book a courier to collect from your home. Collection services cost a little more than drop-off.'],
    ],
    goodFor: ['The lowest price on everyday parcels', 'Clothes, books and marketplace sales', 'People with a ParcelShop nearby'],
    track: {
      url: (n) => `https://www.evri.com/track/parcel/${enc(n)}/details`, deep: true,
      format: 'Usually 16 characters, letters and numbers, often starting with H.', example: 'H01ABC0012345678',
      where: 'On your Kargom label and booking email, or on the ParcelShop receipt.',
      statuses: [
        ['We\'ve got it', 'Evri has received the parcel from the ParcelShop or the collection courier.'],
        ['At the hub', 'The parcel is being sorted at one of Evri\'s depots.'],
        ['With your courier', 'It is with the local courier and should arrive today.'],
        ['Delivered', 'Delivered. Evri often shows a photo of where it was left.'],
      ],
    },
    faq: [
      { q: 'Is Evri the same as Hermes?', a: 'Yes. Hermes UK renamed itself Evri in 2022. The ParcelShops, couriers and tracking all moved to the Evri name.' },
      { q: 'How do I drop off an Evri parcel?', a: 'Print your label, stick it on the parcel and take it to any Evri ParcelShop or locker. The shop scans it and gives you a receipt.' },
      { q: 'Why is Evri so cheap?', a: 'Evri runs a very large network with self-employed couriers and shop drop-offs, which keeps its costs low. You give up a guaranteed delivery time, but for most parcels that does not matter.' },
    ],
  },
  {
    key: 'dpd', slug: 'dpd', name: 'DPD', logo: '/assets/carriers/dpd.png',
    short: 'Next-day delivery with a one-hour delivery window sent to the recipient on the morning of delivery.',
    intro: [
      'DPD is known for its delivery window: on the morning of delivery the recipient gets a one-hour slot by text or email and can change the day or send it to a Pickup shop if they will be out. That makes failed deliveries rare.',
      'DPD focuses on next-day delivery in the UK and handles heavier parcels well, so it is a common choice for business parcels and for anything valuable or awkward that you want to arrive quickly.',
      'On Kargom you will see DPD services for both drop-off at a DPD Pickup shop and collection from your door.',
    ],
    ways: [
      ['DPD Pickup shop', 'Drop off at a local shop in the DPD Pickup network.'],
      ['Locker', 'Some areas have DPD lockers for drop-off.'],
      ['Collection', 'A DPD driver collects from your door. Good for heavier parcels.'],
    ],
    goodFor: ['Next-day delivery', 'Heavier and valuable parcels', 'Recipients who are often out'],
    track: {
      url: (n) => `https://track.dpd.co.uk/parcels/${enc(n)}`, deep: true,
      format: 'A 14-digit parcel number, or a 10-digit consignment number.', example: '15501234567890',
      where: 'On your Kargom label and booking email, and in DPD\'s text or email to the recipient.',
      statuses: [
        ['Received at hub', 'DPD has the parcel and it is being sorted overnight.'],
        ['Out for delivery', 'It is on the van. The recipient\'s one-hour window is on DPD\'s page.'],
        ['Delivered', 'Delivered, usually with a photo or signature.'],
        ['Delivered to Pickup shop', 'The recipient chose a shop, or nobody was in. The parcel waits there for collection.'],
      ],
    },
    faq: [
      { q: 'What is the DPD one-hour delivery window?', a: 'On the morning of delivery DPD sends the recipient a one-hour time slot. They can follow the driver live or move the delivery to another day or a Pickup shop.' },
      { q: 'Does DPD deliver on Saturdays?', a: 'DPD offers weekend delivery on some services. If a service on Kargom delivers on a Saturday, it says so in the service name.' },
      { q: 'Is DPD good for heavy parcels?', a: 'Yes. DPD is one of the stronger choices for heavier parcels, and collection from your door saves carrying a heavy box to a shop.' },
    ],
  },
  {
    key: 'inpost', slug: 'inpost', name: 'InPost', logo: '/assets/carriers/inpost.png',
    short: 'Send and receive through 24/7 lockers: no queue, no opening hours, often the cheapest small-parcel option.',
    intro: [
      'InPost runs a large network of parcel lockers across the UK, in supermarket car parks, train stations and high streets. You drop your parcel into a locker whenever suits you, and the recipient collects from a locker near them with a code.',
      'Because nobody has to come to the door, locker-to-locker delivery is often the cheapest way to send a small parcel. It also avoids missed deliveries completely.',
      'The trade-off is size: the parcel has to fit in a locker. When you enter your parcel size on Kargom, we only show InPost if it fits.',
    ],
    ways: [
      ['Locker drop-off', 'Scan or type your code at any InPost locker and the right door opens.'],
      ['Shop drop-off', 'Some services also accept parcels at partner shops.'],
    ],
    goodFor: ['Small parcels at the lowest price', 'Sending at any time of day', 'Recipients who are rarely home'],
    track: {
      url: () => 'https://inpost.co.uk/', deep: false,
      format: 'Shown on your label and in InPost\'s texts and emails. Recipients also get a collection code.',
      where: 'On your Kargom label and booking email. The recipient gets a text with a code to open the locker.',
      statuses: [
        ['Ready to send', 'The label is created. Drop it into a locker when you are ready.'],
        ['In transit', 'InPost has collected it from the locker.'],
        ['Ready to collect', 'It is in the recipient\'s locker. They have a code by text and email.'],
        ['Collected', 'The recipient has taken it out of the locker.'],
      ],
    },
    faq: [
      { q: 'How does InPost locker-to-locker work?', a: 'You book and print a label, then drop the parcel into any InPost locker using the code you are given. The recipient picks a locker near them and gets a code to open it when the parcel arrives.' },
      { q: 'How long does the recipient have to collect?', a: 'InPost holds parcels in the locker for a limited number of days and sends reminders. If nobody collects, the parcel is returned.' },
      { q: 'What size parcels fit an InPost locker?', a: 'Lockers come in a few door sizes, and the largest takes a medium box. Enter your parcel size on Kargom and we only show InPost when it fits.' },
    ],
  },
  {
    key: 'yodel', slug: 'yodel', name: 'Yodel', logo: '/assets/carriers/yodel.png',
    short: 'UK parcels with drop-off at Yodel Stores in local shops, and delivery to homes or a store.',
    intro: [
      'Yodel is one of the big UK parcel networks and delivers for many large retailers. For individual senders the main route is a Yodel Store: a local shop where you drop off your parcel or the recipient collects one.',
      'Yodel is usually priced close to Evri, so it is worth comparing the two for everyday parcels. Some people prefer it simply because there is a Yodel Store closer to them.',
    ],
    ways: [
      ['Yodel Store', 'Drop off at a local shop in the Yodel network. Many are open early and late.'],
      ['Collection', 'Some Yodel services collect from your door.'],
    ],
    goodFor: ['Everyday parcels at a low price', 'People with a Yodel Store nearby'],
    track: {
      url: (n) => `https://www.yodel.co.uk/track/${enc(n)}`, deep: true,
      format: 'Usually starts with JD followed by around 16 numbers.', example: 'JD0002200000000000',
      where: 'On your Kargom label and booking email, or the Yodel Store receipt.',
      statuses: [
        ['Parcel received', 'Yodel has the parcel and it is moving through the network.'],
        ['Out for delivery', 'It is with the driver today.'],
        ['Delivered', 'Delivered, often with a photo.'],
        ['At Yodel Store', 'It is waiting at a store for the recipient to collect.'],
      ],
    },
    faq: [
      { q: 'Where can I drop off a Yodel parcel?', a: 'At any Yodel Store, which are local shops in the Yodel network. You can find the nearest on Yodel\'s website.' },
      { q: 'Is Yodel cheaper than Evri?', a: 'It depends on the parcel. The two are usually close, which is why Kargom shows them side by side for your exact size and weight.' },
    ],
  },
  {
    key: 'parcelforce', slug: 'parcelforce', name: 'Parcelforce', logo: '/assets/carriers/parcelforce.png',
    short: 'Royal Mail Group\'s express service for heavier parcels, with drop-off at Post Offices.',
    intro: [
      'Parcelforce Worldwide is the express parcel arm of the Royal Mail group. Where Royal Mail is built for letters and small parcels, Parcelforce is built for heavier boxes and for international express.',
      'Its UK services are named for their target time, such as express 24 and express 48, and include tracking and compensation cover. You can hand parcels in at Post Office branches or book a collection.',
    ],
    ways: [
      ['Post Office', 'Drop off at most Post Office branches.'],
      ['Depot', 'Take it to a Parcelforce depot.'],
      ['Collection', 'Book a collection from your home or business.'],
    ],
    goodFor: ['Heavier parcels', 'International express', 'Senders who like the Post Office drop-off'],
    track: {
      url: (n) => `https://www.parcelforce.com/track-trace?trackNumber=${enc(n)}`, deep: true,
      format: 'Two letters and seven numbers in the UK, for example PB1234567. International parcels may use 13 characters ending in GB.', example: 'PB1234567',
      where: 'On your Kargom label and booking email, or the Post Office receipt.',
      statuses: [
        ['Collected / Accepted', 'Parcelforce has the parcel.'],
        ['At hub', 'It is being sorted.'],
        ['Out for delivery', 'It is with the driver today.'],
        ['Delivered', 'Delivered, with a signature or photo.'],
      ],
    },
    faq: [
      { q: 'Is Parcelforce part of Royal Mail?', a: 'Parcelforce Worldwide is part of the same group as Royal Mail but runs its own express network for heavier and time-critical parcels.' },
      { q: 'Can I drop off Parcelforce at the Post Office?', a: 'Yes, most Post Office branches accept Parcelforce parcels.' },
    ],
  },
  {
    key: 'ups', slug: 'ups', name: 'UPS', logo: '/assets/carriers/ups.png',
    short: 'Global courier for fast international and heavier parcels, with UPS Access Point shops.',
    intro: [
      'UPS is one of the world\'s largest couriers and a strong choice for sending abroad, especially to the USA, Europe and Asia, where it runs its own network end to end.',
      'In the UK you can drop parcels at UPS Access Point shops and lockers or book a collection. Express services can reach many countries in one to three working days.',
    ],
    ways: [
      ['Access Point', 'Drop off at a UPS Access Point shop or locker.'],
      ['Collection', 'A UPS driver collects from your door.'],
    ],
    goodFor: ['Fast international delivery', 'Business parcels', 'Heavier boxes'],
    track: {
      url: (n) => `https://www.ups.com/track?tracknum=${enc(n)}`, deep: true,
      format: 'Starts with 1Z followed by 16 letters and numbers.', example: '1Z999AA10123456784',
      where: 'On your Kargom label and booking email.',
      statuses: [
        ['Label created', 'The shipment is booked but UPS has not scanned it yet.'],
        ['In transit', 'UPS has the parcel and it is moving.'],
        ['Customs', 'For international parcels, it is going through customs in the destination country.'],
        ['Delivered', 'Delivered.'],
      ],
    },
    faq: [
      { q: 'How long does UPS take to the USA?', a: 'Express services often take one to three working days. Cheaper economy services take longer. Kargom shows the expected time next to each price.' },
      { q: 'Where is my nearest UPS drop-off?', a: 'UPS Access Points are local shops and lockers. You can find them on the UPS website.' },
    ],
  },
  {
    key: 'dhl', slug: 'dhl', name: 'DHL', logo: '/assets/carriers/dhl.png',
    short: 'International express specialist, often the fastest way to get a parcel abroad.',
    intro: [
      'DHL Express is built for international delivery and is often the quickest way to send a parcel abroad, with its own planes and customs teams in most countries.',
      'For important documents, samples and gifts that need to arrive by a date, DHL Express is usually the first one to compare.',
    ],
    ways: [
      ['DHL ServicePoint', 'Drop off at a DHL ServicePoint shop.'],
      ['Collection', 'A DHL courier collects from your door.'],
    ],
    goodFor: ['Fast international delivery', 'Documents and time-critical parcels'],
    track: {
      url: (n) => `https://www.dhl.com/gb-en/home/tracking/tracking-express.html?submit=1&tracking-id=${enc(n)}`, deep: true,
      format: 'DHL Express waybills are usually 10 numbers.', example: '1234567890',
      where: 'On your Kargom label and booking email.',
      statuses: [
        ['Shipment picked up', 'DHL has collected the parcel.'],
        ['Processed at hub', 'It is moving through DHL\'s network.'],
        ['Clearance processing complete', 'Customs has released it in the destination country.'],
        ['Delivered', 'Delivered, with the name of whoever signed.'],
      ],
    },
    faq: [
      { q: 'Is DHL the fastest courier for international parcels?', a: 'DHL Express is often among the fastest, especially outside Europe. Compare the delivery time shown next to each price on Kargom.' },
      { q: 'Will the recipient pay customs charges?', a: 'Outside the UK, the recipient may have to pay import VAT or duty before delivery, depending on the country and the value. See our customs guide for how this works.' },
    ],
  },
  {
    key: 'fedex', slug: 'fedex', name: 'FedEx', logo: '/assets/carriers/fedex.png',
    short: 'International courier with express and economy options worldwide.',
    intro: [
      'FedEx runs a global express network and offers both fast priority services and cheaper economy options for sending abroad.',
      'It is a good one to compare against UPS and DHL for parcels to North America and Asia.',
    ],
    ways: [
      ['Drop-off point', 'Drop off at a FedEx location or partner shop.'],
      ['Collection', 'A FedEx driver collects from your door.'],
    ],
    goodFor: ['International parcels', 'Choice between express and economy'],
    track: {
      url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${enc(n)}`, deep: true,
      format: 'Usually 12 numbers, sometimes 15.', example: '123456789012',
      where: 'On your Kargom label and booking email.',
      statuses: [
        ['Label created', 'The shipment is booked.'],
        ['In transit', 'FedEx has the parcel.'],
        ['Clearance delay', 'Customs needs more information or payment.'],
        ['Delivered', 'Delivered.'],
      ],
    },
    faq: [
      { q: 'What is the difference between FedEx Priority and Economy?', a: 'Priority is faster and costs more. Economy takes a few more days for a lower price. Kargom shows both side by side when they are available.' },
    ],
  },
];

export const carrierBySlug = (slug: string) => CARRIERS.find((c) => c.slug === slug);
export const carrierByKey = (key: string) => CARRIERS.find((c) => c.key === key);

/** Guess the courier from a tracking number. Returns the most likely first. */
export const TRACK_PATTERNS: Array<[RegExp, string]> = [
  [/^1Z[0-9A-Z]{16}$/, 'ups'],
  [/^[A-Z]{2}\d{9}GB$/, 'royal_mail'],
  [/^[A-Z]{2}\d{7}$/, 'parcelforce'],
  [/^JJ?D\d{14,20}$/, 'yodel'],
  [/^H[0-9A-Z]{15}$/, 'evri'],
  [/^\d{16}$/, 'evri'],
  [/^\d{14}$/, 'dpd'],
  [/^\d{10}$/, 'dhl'],
  [/^\d{10}$/, 'dpd'],
  [/^(\d{12}|\d{15})$/, 'fedex'],
];
