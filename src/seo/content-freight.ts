/**
 * Guides for importers, Amazon sellers and people moving home or office.
 * Plain British English, facts we can stand behind, sources listed on each page.
 * `{{WCI}}` is replaced with this week's container market box (Drewry WCI, entered in admin).
 */
import type { Guide } from './content.ts';

const UPDATED = '2026-10-31';
const GOV_IMPORT = ['GOV.UK: Import goods into the UK, step by step', 'https://www.gov.uk/import-goods-into-uk'] as [string, string];
const GOV_PVA = ['GOV.UK: Check when you can account for import VAT on your VAT Return', 'https://www.gov.uk/guidance/check-when-you-can-account-for-import-vat-on-your-vat-return'] as [string, string];
const GOV_TARIFF = ['GOV.UK: UK Integrated Online Tariff (commodity codes and duty rates)', 'https://www.gov.uk/trade-tariff'] as [string, string];

export const FREIGHT_GUIDES: Guide[] = [
  {
    slug: 'ship-from-china-to-amazon-fba-uk',
    cat: 'freight',
    title: 'How to Ship from China to Amazon FBA UK (2026 Guide)',
    h1: 'How to ship stock from China to Amazon FBA in the UK',
    description: 'Sea, air or express from China to an Amazon UK fulfilment centre: which to choose, carton rules, labels, customs, VAT and a realistic timeline.',
    updated: UPDATED, minutes: 9,
    body: `
<p>The short answer: book your goods from the factory to a UK port or airport with a freight forwarder, clear UK customs in your own name (with your EORI number), then deliver to the Amazon fulfilment centre on your shipment plan, with every carton labelled. Sea freight is the cheapest for most sellers, air is for stock you need within about two weeks, and express couriers suit small, urgent top-ups.</p>
{{WCI}}
<h2>1. Choose how the goods travel</h2>
<table class="tbl"><thead><tr><th>Option</th><th>Typical time, door to door</th><th>Best for</th></tr></thead><tbody>
<tr><td>Sea, full container (FCL)</td><td>About 5 to 7 weeks</td><td>From about 13 m³ of cartons, or one product line in volume</td></tr>
<tr><td>Sea, shared container (LCL)</td><td>About 6 to 8 weeks</td><td>A few cubic metres or a few pallets</td></tr>
<tr><td>Air freight</td><td>About 6 to 10 days</td><td>Light, valuable or urgent stock</td></tr>
<tr><td>Express courier (DHL, UPS, FedEx)</td><td>About 3 to 6 days</td><td>Samples and small top-ups</td></tr>
</tbody></table>
<p>Times include collection, customs and delivery and vary with the season; Chinese New Year and the run-up to Christmas add delays. Not sure which pays off? Read <a href="/guides/air-vs-sea-freight-china-uk">air vs sea freight, LCL or FCL</a>, or put your cartons into our <a href="/freight">freight rate comparison</a>.</p>
<h2>2. Agree the Incoterm with your supplier</h2>
<p>The Incoterm on your order says where the factory's job ends. With <b>EXW</b> you pay for everything from the factory gate; with <b>FOB</b> the factory pays to get the goods onto the ship in China and you pay from there. For a first order, FOB is the usual middle ground. <b>DDP</b> quotes that include "everything to Amazon" look simple, but check who is named as importer: you need the customs entry and the import VAT certificate in your own business name to reclaim VAT. More in <a href="/guides/incoterms-for-importers">Incoterms explained</a>.</p>
<h2>3. Get your UK import basics in place</h2>
<ul>
<li><b>An EORI number</b> starting with GB, in your business's name. Without it goods cannot clear customs.</li>
<li><b>The commodity code</b> for each product. It sets the duty rate. Look it up in the UK tariff or ask your forwarder to check it.</li>
<li><b>VAT registration</b>, if you have it, so you can use postponed VAT accounting and not pay 20% import VAT up front.</li>
</ul>
<p>Step-by-step detail is in <a href="/guides/how-to-import-from-china-to-uk">how to import from China to the UK</a>.</p>
<h2>4. Prepare the cartons the way Amazon UK wants them</h2>
<ul>
<li>Keep standard cartons to <b>23 kg or less</b> and no side longer than about <b>63.5 cm</b>, unless the product itself is bigger. Heavy cartons need heavy-package labels.</li>
<li>Every unit needs a scannable barcode (FNSKU label, unless your product is set up to use the manufacturer's barcode).</li>
<li>Every carton needs its FBA box label from the shipment plan, on a side, not over a seam.</li>
<li>Ask the factory to label units and cartons before collection. Relabelling in the UK costs more than doing it at source.</li>
</ul>
<p>Amazon changes its inbound rules from time to time, so check the current requirements in Seller Central before you book.</p>
<h2>5. Book the delivery into Amazon</h2>
<p>Small shipments can go to the fulfilment centre on your shipment plan as loose cartons by parcel courier. Larger ones go on pallets or in the container with a haulier, and these need a delivery appointment at the fulfilment centre, which your forwarder or haulier books once the goods have cleared customs.</p>
<h2>6. Pay duty and VAT, then keep the paperwork</h2>
<p>Duty is a percentage of the value of the goods plus shipping to the UK, at the rate for the commodity code. Import VAT is usually 20% of the value plus duty and shipping. If you are VAT registered you can account for it on your VAT return with postponed VAT accounting. Keep the commercial invoice, packing list, customs entry and VAT statements.</p>
<h2>A realistic timeline for a first sea shipment</h2>
<ol><li>Week 1: confirm goods ready, Incoterm and forwarder quotes.</li><li>Week 2: collection in China, export clearance, loading.</li><li>Weeks 3 to 7: at sea.</li><li>Week 7 to 8: UK customs, delivery appointment, received into stock.</li></ol>
<p>Order early for peak season: Amazon fulfilment centres book up and check-in slows down from October.</p>
`,
    faq: [
      { q: 'Can Amazon be the importer for my stock?', a: 'No. You, or a company acting for you, must be the importer. Use your own EORI number so the customs entry and import VAT records are in your name.' },
      { q: 'What is the cheapest way to send stock from China to Amazon UK?', a: 'For most sellers, sea freight. Below a few cubic metres a shared container (LCL) is cheaper; from about 13 m³ a full container usually wins. Air only pays off for light, valuable or urgent stock.' },
      { q: 'How long does sea freight from China to an Amazon UK warehouse take?', a: 'Plan on about 5 to 8 weeks door to door, including customs and the delivery appointment. Allow longer around Chinese New Year and before Christmas.' },
    ],
    sources: [GOV_IMPORT, GOV_PVA, ['Amazon UK FBA carton weight and size limits (summary)', 'https://intercom.help/myaccelerlist/en/articles/15183156-amazon-uk-fba-box-weight-carton-dimension-requirements']],
  },
  {
    slug: 'container-shipping-china-to-uk-cost',
    cat: 'freight',
    title: 'Container Shipping China to UK: Cost This Week (20 ft and 40 ft)',
    h1: 'What a container from China to the UK costs this week',
    description: 'This week\'s spot price for a 40 ft container from Asia to North Europe, what is and is not included, and how to estimate your full door-to-door cost.',
    updated: UPDATED, minutes: 6,
    body: `
<p>The headline price most people quote is the ocean spot rate for one 40 ft container from Shanghai to North Europe. We update it every week from the Drewry World Container Index. UK ports such as Felixstowe and Southampton price close to this North Europe benchmark.</p>
{{WCI}}
<h2>What the spot rate does not include</h2>
<p>The index is the port-to-port sea freight only. A door-to-door cost also includes:</p>
<ul>
<li>Collection from the factory and export clearance in China (often paid by the supplier on FOB terms).</li>
<li>UK port and terminal charges, and the customs entry made by your agent.</li>
<li>Haulage from the port to your door or to an Amazon fulfilment centre.</li>
<li>Import duty (depends on the commodity code) and import VAT, usually 20%.</li>
<li>Insurance, if you take it, which we recommend.</li>
</ul>
<h2>20 ft or 40 ft?</h2>
<table class="tbl"><thead><tr><th>Container</th><th>Inside volume</th><th>Good for</th></tr></thead><tbody>
<tr><td>20 ft</td><td>About 33 m³</td><td>Heavy goods, or loads of roughly 13 to 28 m³</td></tr>
<tr><td>40 ft</td><td>About 67 m³</td><td>Most mixed or bulky retail stock</td></tr>
<tr><td>40 ft High Cube</td><td>About 76 m³</td><td>Light, bulky goods such as furniture and textiles</td></tr>
</tbody></table>
<p>You rarely fill a container to its full volume; plan on about 80 to 90% once cartons are stacked. A 40 ft often costs much less than twice a 20 ft, so it can be the better buy even part-full.</p>
<h2>Why the price moves</h2>
<p>Spot rates rise and fall with demand, fuel, peak season and disruption on the shipping routes. The change against last week in the box above shows the direction. Contract rates agreed for a year move less than spot rates.</p>
<h2>Get an estimate for your shipment</h2>
<p>Our <a href="/freight?from=China&amp;to=United%20Kingdom&amp;load=container&amp;box=container40&amp;qty=1">freight rate comparison</a> turns this week's index into a door-to-door estimate for your route and lists freight forwarders who can quote firm prices. Still deciding between a full and shared container? See <a href="/guides/air-vs-sea-freight-china-uk">air vs sea, LCL or FCL</a>.</p>
`,
    faq: [
      { q: 'How much is a 40 ft container from China to the UK?', a: 'The sea freight part follows the weekly spot rate shown on this page for Shanghai to North Europe. Add port charges, customs, UK haulage, duty and VAT for the full door-to-door cost.' },
      { q: 'Is a 20 ft container half the price of a 40 ft?', a: 'Usually not. A 40 ft often costs much less than twice a 20 ft, so compare both before booking.' },
      { q: 'How many cubic metres fit in a 40 ft container?', a: 'About 67 m³ inside, or about 76 m³ in a 40 ft High Cube. In practice plan on filling 80 to 90% of that.' },
    ],
    sources: [['Drewry: World Container Index', 'https://www.drewry.co.uk/'], GOV_TARIFF],
  },
  {
    slug: 'how-to-import-from-china-to-uk',
    cat: 'freight',
    title: 'How to Import from China to the UK: Step by Step (2026)',
    h1: 'How to import goods from China to the UK, step by step',
    description: 'EORI, commodity codes, duty, import VAT, postponed VAT accounting and customs agents: what a small business needs to import from China, in plain English.',
    updated: UPDATED, minutes: 8,
    body: `
<p>To import from China to Great Britain you need a GB EORI number, the right commodity code for each product, someone to make the customs declaration (usually a freight forwarder or customs agent), and a way to pay duty and import VAT. Here is the order to do it in.</p>
<h2>1. Get a GB EORI number</h2>
<p>Every business that imports into Great Britain needs an EORI number starting with GB. It is free and you apply online on GOV.UK. Goods for Northern Ireland may need an XI number too.</p>
<h2>2. Check the supplier can export</h2>
<p>Ask your supplier whether they handle export clearance in China. On FOB terms they do; on EXW terms you or your forwarder must arrange it.</p>
<h2>3. Decide who will clear customs</h2>
<p>You can make the import declaration yourself, but most businesses appoint a freight forwarder or customs agent. Give them your EORI and VAT numbers in writing, and tell them in writing if you want to use postponed VAT accounting.</p>
<h2>4. Find the commodity code</h2>
<p>The commodity code goes on the declaration and sets the duty rate, and whether you need a licence. Look it up in the UK tariff. If you are not sure, ask your agent, because the wrong code can mean paying the wrong duty.</p>
<h2>5. Work out the value and the tax</h2>
<ul>
<li><b>Customs duty</b>: the rate for the code, usually charged on the value of the goods plus shipping and insurance to the UK.</li>
<li><b>Import VAT</b>: usually 20%, charged on the value plus duty and shipping.</li>
<li>Check whether a trade preference or relief lowers the duty for your goods.</li>
</ul>
<h2>6. Use postponed VAT accounting if you are VAT registered</h2>
<p>VAT-registered businesses can account for import VAT on their VAT return instead of paying it at the border. No approval is needed, but your VAT number must be on the declaration. It keeps cash in the business, which matters on large orders.</p>
<h2>7. Check licences, safety and labelling</h2>
<p>Some goods need licences or certificates, for example food, plants, medicines, chemicals and anything with batteries in large numbers. Many consumer products also need UK safety marking (UKCA or CE) and proper labelling. Check before you order, not when the goods arrive.</p>
<h2>8. Clear customs and keep records</h2>
<p>Your agent submits the declaration, you pay what is due, and the goods are released. Keep the commercial invoice, packing list, bill of lading or air waybill, the customs entry and your VAT statements.</p>
<h2>How the goods travel</h2>
<p>Sea freight is cheapest for volume, air is faster, express couriers suit samples. See <a href="/guides/air-vs-sea-freight-china-uk">air vs sea freight, LCL or FCL</a> and <a href="/guides/container-shipping-china-to-uk-cost">this week's container price</a>, then compare <a href="/freight">freight rates</a>.</p>
`,
    faq: [
      { q: 'Do I need a company to import from China?', a: 'No. Sole traders can import too. You still need a GB EORI number, and VAT registration if you want to use postponed VAT accounting.' },
      { q: 'How much tax will I pay on goods from China?', a: 'Customs duty at the rate for the commodity code, plus import VAT, usually 20%. VAT-registered businesses can account for the VAT on their VAT return.' },
      { q: 'Do I need a customs agent?', a: 'It is not required, but most businesses use one. Freight forwarders usually include customs clearance in their price.' },
    ],
    sources: [GOV_IMPORT, GOV_PVA, GOV_TARIFF],
  },
  {
    slug: 'air-vs-sea-freight-china-uk',
    cat: 'freight',
    title: 'Air vs Sea Freight from China to the UK: LCL, FCL or Air?',
    h1: 'Air or sea freight from China: which one pays off?',
    description: 'How air, shared-container (LCL) and full-container (FCL) freight are priced, the break-even points, and a quick way to decide for your shipment.',
    updated: UPDATED, minutes: 6,
    body: `
<p>Sea freight is charged by volume and is far cheaper per kilo; air freight is charged by weight or size, whichever is bigger, and is several times faster. The right choice depends on how big, heavy and valuable your goods are, and how soon you need them.</p>
<h2>How each one is priced</h2>
<ul>
<li><b>Air</b>: charged on the chargeable weight, which is the real weight or the volume weight, whichever is higher. For air freight, 1 m³ counts as 167 kg.</li>
<li><b>Sea, shared container (LCL)</b>: charged per cubic metre (or per 1,000 kg if that is more), plus fixed charges at both ends for consolidating your cargo.</li>
<li><b>Sea, full container (FCL)</b>: one price for the whole container, whatever you put in it.</li>
</ul>
<h2>Rules of thumb</h2>
<table class="tbl"><thead><tr><th>Your shipment</th><th>Usually best</th></tr></thead><tbody>
<tr><td>Under about 100 kg, urgent</td><td>Express courier</td></tr>
<tr><td>Light and valuable (electronics, cosmetics), needed within two weeks</td><td>Air freight</td></tr>
<tr><td>About 2 to 13 m³</td><td>Sea, shared container (LCL)</td></tr>
<tr><td>About 13 m³ or more</td><td>Sea, full 20 ft or 40 ft container (FCL)</td></tr>
<tr><td>Heavy and dense (tools, tiles)</td><td>Sea, almost always</td></tr>
</tbody></table>
<p>The fixed charges on LCL mean that around 13 to 15 m³ a full 20 ft container often costs about the same, with less handling and less risk of damage.</p>
<h2>Do not forget the cost of time</h2>
<p>Sea freight takes weeks longer. If running out of stock costs you sales or Amazon ranking, a split works well: a small air shipment to keep selling, and the bulk by sea.</p>
<h2>Work it out for your cartons</h2>
<p>Enter your cartons or pallets in the <a href="/freight">freight rate comparison</a> and you will see air, LCL and FCL estimates side by side. For the sea benchmark, see <a href="/guides/container-shipping-china-to-uk-cost">this week's container price</a>.</p>
`,
    faq: [
      { q: 'When is a full container cheaper than LCL?', a: 'Often from about 13 to 15 m³. Below that, a shared container is usually cheaper; above it, a full 20 ft container tends to cost about the same or less.' },
      { q: 'How is air freight chargeable weight calculated?', a: 'Airlines charge the higher of the real weight and the volume weight, where 1 cubic metre counts as 167 kg.' },
    ],
    sources: [],
  },
  {
    slug: 'incoterms-for-importers',
    cat: 'freight',
    title: 'Incoterms Explained for Importers: EXW, FOB, CIF, DDP',
    h1: 'Incoterms explained: EXW, FOB, CIF and DDP for UK importers',
    description: 'Who pays for what, and who carries the risk, under the Incoterms you will see on supplier quotes from China. Which one to choose for a first order.',
    updated: UPDATED, minutes: 5,
    body: `
<p>An Incoterm is three letters on the quote that say where the supplier's costs and risk end and yours begin. Getting it right avoids surprise bills at the port.</p>
<table class="tbl"><thead><tr><th>Term</th><th>Supplier pays up to</th><th>Good to know</th></tr></thead><tbody>
<tr><td>EXW (Ex Works)</td><td>Goods ready at the factory</td><td>You arrange and pay for everything, including export clearance in China</td></tr>
<tr><td>FCA (Free Carrier)</td><td>Handed to your forwarder, export cleared</td><td>A cleaner version of EXW</td></tr>
<tr><td>FOB (Free On Board)</td><td>Loaded on the ship in China</td><td>The usual choice for sea freight; you control the main transport</td></tr>
<tr><td>CIF (Cost, Insurance and Freight)</td><td>Sea freight and basic insurance to the UK port</td><td>Risk passes to you when the goods are loaded; UK charges are yours</td></tr>
<tr><td>DDP (Delivered Duty Paid)</td><td>Delivered with duty and tax paid</td><td>Check who is the importer: you may not get the VAT records you need</td></tr>
</tbody></table>
<h2>Which one for a first order?</h2>
<p>FOB is the common middle ground: the factory handles China, and your own forwarder handles the sea leg and UK customs, so you can compare prices and keep control. If the supplier offers CIF, compare it with an FOB price plus your own freight quote; UK destination charges can make CIF dearer than it looks.</p>
<h2>Next steps</h2>
<p>Read <a href="/guides/how-to-import-from-china-to-uk">how to import from China</a>, then compare <a href="/freight">freight rates</a> from the Chinese port to your door.</p>
`,
    faq: [
      { q: 'Is FOB or EXW better when importing from China?', a: 'For most small importers FOB, because the supplier handles export clearance and loading in China, which is harder to arrange from the UK.' },
      { q: 'Should I accept DDP?', a: 'Only if you understand who is named as importer. If you want to reclaim import VAT you need the customs entry in your own business name.' },
    ],
    sources: [GOV_IMPORT],
  },
  {
    slug: 'send-stock-uk-to-amazon-fba-usa',
    cat: 'freight',
    title: 'Sending Stock from the UK to Amazon FBA USA',
    h1: 'How to send stock from the UK to Amazon FBA in the USA',
    description: 'Importer of record, customs broker, bond and shipping options for UK sellers sending inventory to Amazon US fulfilment centres.',
    updated: UPDATED, minutes: 6,
    body: `
<p>You can sell on Amazon.com from the UK and keep stock in US fulfilment centres, but Amazon will not be the importer for you. You, or a company acting for you, must be the importer of record, clear US customs and pay any duties before the goods can be delivered to Amazon.</p>
<h2>What you need before you ship</h2>
<ul>
<li><b>An importer of record</b>: your business, or a freight forwarder or service acting as importer for you.</li>
<li><b>A US customs broker</b>, strongly recommended, to file the entry.</li>
<li><b>A customs bond</b>, often needed as security for duties.</li>
<li><b>A US importer number</b> for your business (an EIN, or a number issued by US Customs).</li>
<li>For sea freight, an <b>ISF ("10+2") filing</b> before the goods are loaded.</li>
</ul>
<p>Amazon's own US seller guidance makes the same point: it will not act as importer of record for FBA stock, whatever the size or value of the shipment.</p>
<h2>How to ship</h2>
<table class="tbl"><thead><tr><th>Option</th><th>Typical time</th><th>Best for</th></tr></thead><tbody>
<tr><td>Express courier</td><td>About 3 to 6 days</td><td>Testing a product, small top-ups</td></tr>
<tr><td>Air freight</td><td>About 1 to 2 weeks</td><td>Medium shipments, fast-selling stock</td></tr>
<tr><td>Sea freight (LCL or FCL)</td><td>About 3 to 6 weeks</td><td>Bulk stock, best cost per unit</td></tr>
</tbody></table>
<h2>Duty and the end of duty-free small parcels</h2>
<p>The USA ended duty-free entry for low-value parcels in 2025, so plan on duty for every shipment. The rate depends on the product's tariff classification and where it was made, not where it ships from: goods made in China and shipped via the UK are usually treated as Chinese for duty.</p>
<h2>Compare options</h2>
<p>Use the <a href="/freight?from=United%20Kingdom&amp;to=United%20States">freight rate comparison</a> for air and sea estimates from the UK to the USA, or <a href="/send-parcel-to/united-states">send smaller boxes by courier</a>.</p>
`,
    faq: [
      { q: 'Can Amazon be my importer of record in the US?', a: 'No. Amazon does not act as importer of record for FBA stock. You or a company acting for you must take that role.' },
      { q: 'Do I need a US company to sell on Amazon.com?', a: 'Not necessarily, but you need an importer of record, and usually a customs broker and bond, to bring stock into the USA.' },
    ],
    sources: [['Amazon Seller Forums: Importing 101 for FBA sellers', 'https://sellercentral.amazon.com/seller-forums/discussions/t/dd6a1e0e-d2dd-4592-b6f1-0ecda906a7b1']],
  },
  {
    slug: 'amazon-fba-europe-from-uk',
    cat: 'freight',
    title: 'Amazon FBA Europe from the UK: Remote Fulfilment or EU Stock?',
    h1: 'Selling in the EU from the UK on Amazon: your FBA options',
    description: 'Remote Fulfilment versus sending stock to EU fulfilment centres: VAT, customs and which UK sellers each one suits.',
    updated: UPDATED, minutes: 5,
    body: `
<p>Since Brexit, stock in UK fulfilment centres and stock in EU fulfilment centres are separate. UK sellers have two main ways to reach EU customers through FBA.</p>
<h2>Option 1: Remote Fulfilment from the UK</h2>
<p>Your stock stays in the UK and Amazon ships EU orders across the border. Amazon handles customs clearance, and collects and pays the VAT on these orders, so you do not need to register for VAT in those countries. It covers Germany, France, Italy, Spain, Sweden and the Netherlands, and products must not cost more than €135 (£122).</p>
<h2>Option 2: Send stock into EU fulfilment centres</h2>
<p>You ship inventory to Amazon in the EU, clear EU customs through your own or a partner broker, and register for VAT in each country where your stock is stored. It costs more to set up but gives faster delivery and suits higher-priced products and larger volumes.</p>
<h2>Which one to start with</h2>
<p>Test demand with Remote Fulfilment if your products are under the price limit. Move stock into the EU once a market sells well enough to pay for VAT registration and a customs process.</p>
<h2>Shipping stock to the EU</h2>
<p>Pallets and cartons to an EU fulfilment centre go by road freight from the UK in a few days. Compare <a href="/freight?from=United%20Kingdom&amp;to=Germany&amp;load=pallets">road freight to Germany</a>, or send smaller boxes with a <a href="/send-parcel-to/germany">courier</a>.</p>
`,
    faq: [
      { q: 'Do I need EU VAT registration to sell on Amazon.de from the UK?', a: 'Not if you use Remote Fulfilment for eligible products; Amazon collects the VAT on those orders. If you store stock in an EU country, you need a VAT number there.' },
      { q: 'What is the price limit for Remote Fulfilment?', a: 'Products must not cost more than €135 or £122.' },
    ],
    sources: [['Amazon UK: Fulfilment between the UK and EU', 'https://sell.amazon.co.uk/fulfilment-by-amazon/fulfilment-between-uk-eu']],
  },
  {
    slug: 'choose-a-freight-forwarder-uk',
    cat: 'freight',
    title: 'How to Choose a Freight Forwarder in the UK (Checklist)',
    h1: 'How to choose a freight forwarder: 9 questions to ask',
    description: 'What a freight forwarder does, how it differs from a customs broker, and the questions that separate a good one from an expensive mistake.',
    updated: UPDATED, minutes: 5,
    body: `
<p>A freight forwarder organises the whole move: collection, booking space on a ship, plane or lorry, customs paperwork and delivery. A customs broker only handles the customs declaration. Most small importers want a forwarder that includes customs clearance.</p>
<h2>Questions to ask before you book</h2>
<ol>
<li>Is the quote door to door, and which charges are not included (port fees, customs entry, delivery, duty and VAT)?</li>
<li>Do you handle the customs entry, and will it be in my name with my EORI number?</li>
<li>Can you use postponed VAT accounting for me?</li>
<li>Do you deliver to Amazon fulfilment centres and book the appointment?</li>
<li>Who are your agents in China, and who do I contact there?</li>
<li>How long is the quote valid, and how do you handle rate changes before sailing?</li>
<li>What insurance do you offer, and what are the limits under your standard trading conditions?</li>
<li>Are you a member of BIFA, the British International Freight Association?</li>
<li>Can you share recent reviews or references from businesses like mine?</li>
</ol>
<h2>Red flags</h2>
<ul>
<li>A price far below everyone else with no breakdown of charges.</li>
<li>No written terms, or terms that leave all risk with you.</li>
<li>Pressure to pay the full amount before the goods are loaded.</li>
</ul>
<h2>Find and compare forwarders</h2>
<p>Our <a href="/freight">freight rate comparison</a> shows an estimate for your route and the best-rated forwarders at both ends, so you can ask two or three for firm quotes and compare them.</p>
`,
    faq: [
      { q: 'What is the difference between a freight forwarder and a customs broker?', a: 'A forwarder organises transport from door to door, and usually customs too. A customs broker only prepares and submits customs declarations.' },
      { q: 'How many forwarder quotes should I get?', a: 'Two or three is enough to see the market, as long as each quote covers the same route, service and charges.' },
    ],
    sources: [['BIFA: British International Freight Association', 'https://www.bifa.org/']],
  },
  {
    slug: 'house-removal-costs-uk',
    cat: 'moving',
    title: 'House Removal Costs UK 2026: Prices by Home Size',
    h1: 'How much does a house removal cost in the UK?',
    description: 'Average UK removal costs for 1 to 4 bedroom homes, what changes the price, and how to get fair quotes from removal companies.',
    updated: UPDATED, minutes: 6,
    body: `
<p>A typical UK house move costs from about £750 for a one-bedroom home to about £1,800 for four bedrooms, with packing included. Your price depends most on how much you are moving, how far, and how easy it is to load.</p>
<h2>Average prices by home size</h2>
<table class="tbl"><thead><tr><th>Home</th><th>Removal only</th><th>Packing</th><th>Average total</th></tr></thead><tbody>
<tr><td>1 bedroom</td><td>£450</td><td>£250</td><td>£750</td></tr>
<tr><td>2 bedrooms</td><td>£600</td><td>£325</td><td>£925</td></tr>
<tr><td>3 bedrooms</td><td>£900</td><td>£400</td><td>£1,300</td></tr>
<tr><td>4 bedrooms</td><td>£1,200</td><td>£600</td><td>£1,800</td></tr>
</tbody></table>
<p class="note">Averages published by Checkatrade, April 2026. A two-person team with a van typically charges £50 to £80 an hour.</p>
<h2>What pushes the price up</h2>
<ul>
<li><b>Distance</b>: a local move within about 50 miles is often £400 to £500 for a small home; long-distance moves cost more.</li>
<li><b>Access</b>: upper-floor flats, no lift, narrow stairs or no parking near the door.</li>
<li><b>Timing</b>: summer, Fridays and the end of the month are busiest. A mid-week date is often cheaper.</li>
<li><b>Extras</b>: packing materials, dismantling furniture, piano or antique handling, storage and waiting time.</li>
</ul>
<h2>How to get fair quotes</h2>
<ol>
<li>List the big items and the number of boxes, or walk the company through a video survey.</li>
<li>Ask two or three companies for a written, fixed quote with what is included.</li>
<li>Check reviews, insurance cover and the cancellation terms.</li>
<li>Book early for summer and month-end dates.</li>
</ol>
<p>On Kargom you can <a href="/movers">find removal companies near you</a> with their Google reviews, and post one request to get offers from several companies.</p>
`,
    faq: [
      { q: 'How much does it cost to move a 3 bedroom house in the UK?', a: 'About £1,300 on average including packing, or about £900 for the removal alone, according to Checkatrade\'s April 2026 figures. Distance and access change it.' },
      { q: 'Is a man and van cheaper than a removal company?', a: 'Usually, for small moves, studio flats and single items. For a whole family home a removal company with a larger team is often faster and better value.' },
      { q: 'When is the cheapest time to move house?', a: 'Mid-week and mid-month, outside the summer peak.' },
    ],
    sources: [['Checkatrade: house removal costs (April 2026)', 'https://www.checkatrade.com/blog/cost-guides/house-removal-costs']],
  },
  {
    slug: 'office-relocation-checklist',
    cat: 'moving',
    title: 'Office Relocation Checklist UK: Plan a Move Without Downtime',
    h1: 'Office move checklist: plan it so the business keeps running',
    description: 'A practical office relocation checklist for UK businesses: timeline, IT and phones, landlord notices, staff, and choosing a commercial removal company.',
    updated: UPDATED, minutes: 6,
    body: `
<p>A good office move is planned three to six months ahead and done over a weekend, with IT moved last and tested first. Use this checklist to keep the business running.</p>
<h2>Three to six months before</h2>
<ul>
<li>Check the notice period and the dilapidations (repair) terms in your current lease.</li>
<li>Name one person to run the move, with a budget and a deadline.</li>
<li>Plan the new layout: desks, meeting rooms, power and data points.</li>
<li>Order broadband and phone lines for the new address early; new lines can take weeks.</li>
</ul>
<h2>One to two months before</h2>
<ul>
<li>Get written quotes from two or three commercial removal companies, after a site visit or video survey.</li>
<li>Ask about out-of-hours moving, crate hire, IT disconnection and insurance cover.</li>
<li>Tell clients, suppliers, your bank, HMRC and Companies House (if the registered office changes).</li>
<li>Book lifts and loading bays at both buildings.</li>
</ul>
<h2>Moving week</h2>
<ul>
<li>Back up data before anything is unplugged.</li>
<li>Label crates and furniture by room and desk number to match the new floor plan.</li>
<li>Give each person one crate for personal items and a clear-out deadline.</li>
<li>Test internet, phones and the main systems on the first morning.</li>
</ul>
<h2>Choosing a commercial removal company</h2>
<p>Look for experience with offices of your size, a named project manager, proper insurance and a fixed written quote. On Kargom you can <a href="/movers">find removal companies near you</a> and post one request to get offers from several.</p>
`,
    faq: [
      { q: 'How long does an office move take to plan?', a: 'Three to six months for most small and medium offices, mainly because of lease notices and new internet and phone lines.' },
      { q: 'Should an office move be done at the weekend?', a: 'Usually yes. Moving over a weekend means the business is ready to work on Monday morning.' },
    ],
    sources: [],
  },
];
