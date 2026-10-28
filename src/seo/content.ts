/**
 * Guides and destination notes. Plain, practical British English.
 * `{{UK_PRICES}}` inside a guide is replaced with the live UK price table.
 */

export type Guide = { slug: string; title: string; h1: string; description: string; updated: string; minutes: number; body: string };

export const GUIDES: Guide[] = [
  {
    slug: 'cheapest-way-to-send-a-parcel-uk',
    title: 'Cheapest Way to Send a Parcel in the UK (Live Prices)',
    h1: 'The cheapest way to send a parcel in the UK',
    description: 'Live prices from Evri, InPost, Royal Mail, Yodel and DPD for parcels from 0.5 kg to 30 kg, plus five ways to pay less every time you send.',
    updated: '2026-10-28', minutes: 6,
    body: `
<p>The short answer: for a small parcel, the cheapest option is usually a locker or shop drop-off with InPost, Evri or Yodel. For heavier parcels the gap between couriers grows, and the cheapest one changes with the weight. The table below is our live price for each weight, so you can see it for yourself.</p>
{{UK_PRICES}}
<h2>Why the cheapest courier changes with weight</h2>
<p>Each courier prices in weight bands. Evri and InPost are strong on light parcels because they are built around shops and lockers, which keeps the cost of each delivery down. Once a parcel gets heavier, couriers with van networks built for bigger boxes, such as DPD and Parcelforce, often come out ahead. That is why it pays to compare every time instead of always using the same courier.</p>
<h2>Five ways to pay less</h2>
<h3>1. Drop it off instead of booking a collection</h3>
<p>A driver coming to your door costs the courier money, and the price shows it. If there is a shop or locker within walking distance, drop-off is almost always cheaper for the same courier.</p>
<h3>2. Use the smallest box the item fits in</h3>
<p>Couriers charge for size as well as weight. A light item in a big box can be charged as if it were much heavier, because of <a href="/guides/volumetric-weight-explained">volumetric weight</a>. Cut the box down or use a padded bag for soft items.</p>
<h3>3. Weigh it properly</h3>
<p>Kitchen scales are fine. If you guess low, the courier can re-weigh the parcel and charge the difference. If you guess high, you pay for weight you did not send. On Kargom we only charge an adjustment when the courier's price actually changes.</p>
<h3>4. Choose two days instead of next day</h3>
<p>For most parcels nobody notices one extra day, and two-day services are often noticeably cheaper.</p>
<h3>5. Buy the label online</h3>
<p>Prices at the counter are usually higher than the same courier booked online. Booking online also means you have the tracking number before you leave the house.</p>
<h2>What about the Post Office?</h2>
<p>You can hand Royal Mail and Parcelforce parcels in at the Post Office with a label you bought online, and you skip paying at the counter. Royal Mail is also often the best value for the Scottish Highlands, islands and Northern Ireland, because it charges the same for every UK address while other couriers add a surcharge for remote areas.</p>
`,
  },
  {
    slug: 'volumetric-weight-explained',
    title: 'Volumetric Weight Explained (with Free Calculator)',
    h1: 'Volumetric weight: why a light box can cost more',
    description: 'How couriers work out volumetric weight, the formula they use, worked examples, and how to keep a big but light parcel cheap.',
    updated: '2026-10-28', minutes: 4,
    body: `
<p>A courier van fills up with space long before it fills up with weight. So couriers charge for whichever is greater: the real weight of your parcel or its <b>volumetric weight</b>, which is a weight worked out from its size.</p>
<h2>The formula</h2>
<p>Most couriers use the same calculation. Multiply length × width × height in centimetres and divide by 5,000. The result is the volumetric weight in kilograms.</p>
<p class="calc-line">length × width × height ÷ 5,000 = volumetric weight (kg)</p>
<p>Some services use a different divisor, such as 4,000 or 6,000, but 5,000 is the most common. Try it with our <a href="/tools/volumetric-weight-calculator">free volumetric weight calculator</a>.</p>
<h2>Worked examples</h2>
<table class="tbl"><thead><tr><th>Parcel</th><th>Size (cm)</th><th>Real weight</th><th>Volumetric</th><th>Charged as</th></tr></thead><tbody>
<tr><td>Shoebox</td><td>33 × 20 × 12</td><td>1.2 kg</td><td>1.6 kg</td><td>1.6 kg</td></tr>
<tr><td>Duvet in a box</td><td>50 × 40 × 30</td><td>3 kg</td><td>12 kg</td><td>12 kg</td></tr>
<tr><td>Books</td><td>30 × 20 × 15</td><td>6 kg</td><td>1.8 kg</td><td>6 kg</td></tr>
</tbody></table>
<p>The duvet shows the trap. It only weighs 3 kg, but the box is big enough to be charged as 12 kg.</p>
<h2>How to keep big, light parcels cheap</h2>
<ul>
<li>Use the smallest box that fits. Every centimetre counts, because the three sides multiply together.</li>
<li>Soft items such as clothes and bedding can go in a strong mailing bag, which takes up far less space than a box.</li>
<li>Vacuum bags work well for duvets and pillows.</li>
<li>Compare couriers. They do not all treat size the same way, and Kargom prices your exact size and weight with each one.</li>
</ul>
`,
  },
  {
    slug: 'how-to-package-a-parcel',
    title: 'How to Package a Parcel So It Arrives in One Piece',
    h1: 'How to package a parcel so it arrives in one piece',
    description: 'A practical checklist: choosing a box, padding, taping and labelling, plus what to do with fragile items and liquids.',
    updated: '2026-10-28', minutes: 5,
    body: `
<p>Parcels travel on conveyor belts, get stacked in vans and are sometimes dropped. Packing for that, not for a gentle hand delivery, is what stops damage. It also matters for claims: couriers can refuse compensation if the packaging was not up to the job.</p>
<h2>1. Pick a sturdy box</h2>
<p>Use a strong corrugated cardboard box, ideally double-walled for anything heavy or fragile. Old supermarket boxes are fine if they are not soft, torn or water-damaged. Leave about 5 cm on every side for padding.</p>
<h2>2. Pad every side</h2>
<p>The item should not move when you shake the box. Bubble wrap, packing paper, air pillows and crumpled newspaper all work. Put a layer on the bottom, wrap the item, then fill every gap.</p>
<h2>3. Tape it like you mean it</h2>
<p>Use proper parcel tape, at least 5 cm wide, in an H pattern across the top and bottom seams. Do not use sticky tape, masking tape or string.</p>
<h2>4. Label it clearly</h2>
<p>Stick the label flat on the largest side, away from seams. Remove or cover old labels and barcodes so the scanners only read the new one. Put a note with the delivery and return address inside the box too, in case the outside label is damaged.</p>
<h2>Fragile items</h2>
<p>Wrap each piece separately, and use the box-in-a-box method for anything breakable: pack the item in a small box, then pack that box inside a bigger one with padding between them. A "fragile" sticker is nice to have, but it does not change how parcels are handled.</p>
<h2>Liquids</h2>
<p>Seal the lid with tape, put the bottle in a sealed plastic bag and pad it upright. Check the courier's prohibited items list before sending anything flammable, such as perfume or nail varnish, especially abroad.</p>
<h2>Soft items</h2>
<p>Clothes do not need a box. A strong, waterproof mailing bag is cheaper to send because it takes up less space. See <a href="/guides/volumetric-weight-explained">why size affects price</a>.</p>
`,
  },
  {
    slug: 'drop-off-or-collection',
    title: 'Parcel Drop-Off vs Collection: Which Is Better?',
    h1: 'Drop-off or collection: which should you choose?',
    description: 'The real difference in price, time and hassle between dropping a parcel at a shop or locker and booking a courier to collect it.',
    updated: '2026-10-28', minutes: 3,
    body: `
<p>When you compare prices on Kargom, each service shows how it starts its journey: dropped off at a shop, dropped into a locker, or collected from your door. Here is how to choose.</p>
<h2>Drop-off at a shop or locker</h2>
<p><b>Usually cheaper.</b> The courier saves a trip to your house, and you get the saving. Shops are often open early and late, and lockers are open all day and night. You get a receipt or a scan straight away, so the parcel is tracked from the moment you hand it over.</p>
<p>Best for: small and medium parcels, and anyone with a shop or locker nearby.</p>
<h2>Collection from your door</h2>
<p><b>More convenient for heavy or awkward parcels.</b> You do not have to carry anything, which matters for heavy boxes or several parcels at once. The catch is that you usually need to be in for a collection window on the collection day.</p>
<p>Best for: heavy parcels, several parcels at once, and businesses.</p>
<h2>A quick rule of thumb</h2>
<ul>
<li>Under about 5 kg and a shop nearby: drop it off.</li>
<li>Over 10 kg, or more than one parcel: collection is worth the small extra cost.</li>
<li>Out all day: a locker drop-off fits around you.</li>
</ul>
`,
  },
  {
    slug: 'sending-a-parcel-abroad-customs',
    title: 'Sending a Parcel Abroad from the UK: Customs Explained',
    h1: 'Sending a parcel abroad from the UK: customs made simple',
    description: 'What a customs declaration is, what to write on it, who pays import tax and duty, and how to avoid parcels getting stuck.',
    updated: '2026-10-28', minutes: 6,
    body: `
<p>Every parcel going from Great Britain to another country needs a customs declaration, and that includes the EU since Brexit. It tells the destination country what is inside and what it is worth, so it can decide whether any tax or duty is due.</p>
<h2>What you need to declare</h2>
<ul>
<li><b>A clear description of each item.</b> "Women's cotton T-shirt" is right. "Clothes", "gift" or "goods" are the main reason parcels get held at customs.</li>
<li><b>Quantity and value.</b> What you paid, or a fair value for second-hand items, in pounds.</li>
<li><b>Country of origin.</b> Where the item was made, not where you are sending from.</li>
<li><b>Whether it is a gift, a sale, or a return.</b> This changes how some countries tax it.</li>
</ul>
<p>When you book an international service on Kargom, we ask for these details and put them on the paperwork for you.</p>
<h2>Who pays tax and duty?</h2>
<p>Usually the recipient. Most countries charge import VAT or sales tax, and sometimes customs duty, when the parcel arrives. The courier pays it on the recipient's behalf and then asks them for it, often with a handling fee, before delivering. Sellers who want to avoid surprising their customers can look into schemes that collect tax at checkout, such as the EU's IOSS for lower-value orders.</p>
<h2>The EU</h2>
<p>Parcels from Great Britain to EU countries need a customs declaration and are subject to the destination's import VAT. Correct descriptions and values keep them moving.</p>
<h2>The USA</h2>
<p>The USA ended duty-free entry for low-value parcels in 2025, so duty can now apply even to small parcels. Describe items precisely and check what applies before you send.</p>
<h2>Items you cannot send</h2>
<p>Every courier has a list of prohibited and restricted items. Common ones are aerosols, flammable liquids such as perfume and nail varnish, loose lithium batteries, cash, and food in some countries. Check the courier's list before you pack.</p>
<p>Official guidance is on <a href="https://www.gov.uk/goods-sent-from-abroad" rel="nofollow noopener" target="_blank">GOV.UK</a>.</p>
`,
  },
];

export const guideBySlug = (slug: string) => GUIDES.find((g) => g.slug === slug);

/** Notes shown on destination pages, by region. Kept general: rules change, prices come live. */
export function destinationNotes(code: string): string[] {
  const EU = ['DE', 'FR', 'IE', 'NL', 'ES', 'IT', 'PL', 'BE'];
  if (EU.includes(code)) return [
    'Parcels from Great Britain to the EU need a customs declaration. We ask for the details when you book and print them with the label.',
    'The recipient may be asked to pay import VAT before delivery. Describing items precisely, with their real value, stops parcels being held.',
  ];
  if (code === 'US') return [
    'Every parcel needs a customs declaration. Describe each item precisely, for example "men\'s leather wallet" rather than "gift".',
    'The USA ended duty-free entry for low-value parcels in 2025, so the recipient may be asked to pay duty even on small parcels.',
  ];
  return [
    'Every parcel needs a customs declaration. We ask for the details when you book and print them with the label.',
    'The recipient may have to pay import tax or duty before delivery, depending on what is inside and its value.',
  ];
}
