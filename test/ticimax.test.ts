import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeCustomer, ukReq } from './helpers.ts';
import { countryCode, parseXml, readWsdl } from '../src/integrations/ticimax.ts';

const DC = 'http://schemas.datacontract.org/2004/07/Ticimax.Test';
const WSDL = `<?xml version="1.0"?>
<wsdl:definitions targetNamespace="http://tempuri.org/" xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xs="http://www.w3.org/2001/XMLSchema">
<wsdl:types>
 <xs:schema elementFormDefault="qualified" targetNamespace="http://tempuri.org/">
  <xs:element name="SelectSiparis"><xs:complexType><xs:sequence>
   <xs:element minOccurs="0" name="UyeKodu" nillable="true" type="xs:string"/>
   <xs:element minOccurs="0" name="f" nillable="true" type="q1:WebSiparisFiltre" xmlns:q1="${DC}"/>
   <xs:element minOccurs="0" name="s" nillable="true" type="q2:WebSiparisSayfalama" xmlns:q2="${DC}"/>
  </xs:sequence></xs:complexType></xs:element>
  <xs:element name="SaveKargoTakipNo"><xs:complexType><xs:sequence>
   <xs:element minOccurs="0" name="UyeKodu" type="xs:string"/><xs:element minOccurs="0" name="siparisId" type="xs:int"/><xs:element minOccurs="0" name="kargoKodu" type="xs:string"/>
   <xs:element minOccurs="0" name="kargoTakipNo" type="xs:string"/><xs:element minOccurs="0" name="kargoTakipLink" type="xs:string"/><xs:element minOccurs="0" name="BarkodBilgisi" type="xs:string"/>
   <xs:element minOccurs="0" name="KargoTakipLinkGoster" type="xs:boolean"/>
  </xs:sequence></xs:complexType></xs:element>
  <xs:element name="SetSiparisKargoyaVerildi"><xs:complexType><xs:sequence>
   <xs:element minOccurs="0" name="UyeKodu" type="xs:string"/><xs:element minOccurs="0" name="siparisId" type="xs:int"/>
  </xs:sequence></xs:complexType></xs:element>
 </xs:schema>
 <xs:schema elementFormDefault="qualified" targetNamespace="${DC}">
  <xs:complexType name="WebSiparisFiltre"><xs:sequence>
   <xs:element minOccurs="0" name="DurumTarihiBas" nillable="true" type="xs:dateTime"/>
   <xs:element minOccurs="0" name="EntegrasyonAktarildi" type="xs:int"/>
   <xs:element minOccurs="0" name="EntegrasyonParams" nillable="true" type="tns:WebSiparisEntegrasyon"/>
   <xs:element minOccurs="0" name="IptalEdilmisUrunler" type="xs:boolean"/>
   <xs:element minOccurs="0" name="SiparisDurumu" type="xs:int"/>
   <xs:element minOccurs="0" name="SiparisID" type="xs:int"/>
   <xs:element minOccurs="0" name="SiparisNo" nillable="true" type="xs:string"/>
   <xs:element minOccurs="0" name="UrunGetir" nillable="true" type="xs:boolean"/>
   <xs:element minOccurs="0" name="UyeID" type="xs:int"/>
  </xs:sequence></xs:complexType>
  <xs:complexType name="WebSiparisEntegrasyon"><xs:sequence>
   <xs:element minOccurs="0" name="AlanDeger" nillable="true" type="xs:string"/><xs:element minOccurs="0" name="EntegrasyonParamsAktif" type="xs:boolean"/>
  </xs:sequence></xs:complexType>
  <xs:complexType name="WebSiparisSayfalama"><xs:sequence>
   <xs:element minOccurs="0" name="BaslangicIndex" type="xs:int"/><xs:element minOccurs="0" name="KayitSayisi" type="xs:int"/>
   <xs:element minOccurs="0" name="SiralamaDegeri" nillable="true" type="xs:string"/><xs:element minOccurs="0" name="SiralamaYonu" nillable="true" type="xs:string"/>
  </xs:sequence></xs:complexType>
 </xs:schema>
</wsdl:types>
<wsdl:binding name="b" type="tns:ISiparisServis">
 <wsdl:operation name="SelectSiparis"><soap:operation soapAction="http://tempuri.org/ISiparisServis/SelectSiparis" style="document"/></wsdl:operation>
 <wsdl:operation name="SaveKargoTakipNo"><soap:operation soapAction="http://tempuri.org/ISiparisServis/SaveKargoTakipNo" style="document"/></wsdl:operation>
 <wsdl:operation name="SetSiparisKargoyaVerildi"><soap:operation soapAction="http://tempuri.org/ISiparisServis/SetSiparisKargoyaVerildi" style="document"/></wsdl:operation>
</wsdl:binding>
</wsdl:definitions>`;

const order = (id: number, durum: number) => `<a:WebSiparis><a:AdiSoyadi>Ayşe Kaya</a:AdiSoyadi><a:Durum>${durum}</a:Durum><a:ID>${id}</a:ID><a:Mail>ayse@example.com</a:Mail><a:ParaBirimi>TL</a:ParaBirimi>
<a:SiparisNo>TCX${id}</a:SiparisNo><a:SiparisTarihi>2026-10-30T12:00:00</a:SiparisTarihi><a:SiparisToplamTutari>450,5</a:SiparisToplamTutari>
<a:TeslimatAdresi><a:Adres>Flat 3, 12 Baker Street</a:Adres><a:AliciAdi>Ayşe Kaya</a:AliciAdi><a:AliciTelefon>07700900222</a:AliciTelefon><a:Il>London</a:Il><a:Ilce>Marylebone</a:Ilce><a:PostaKodu>nw1 6xe</a:PostaKodu><a:Ulke>İngiltere</a:Ulke></a:TeslimatAdresi>
<a:Urunler><a:WebSiparisUrun><a:Adet>2</a:Adet><a:DurumAd>Onaylandı</a:DurumAd><a:StokKodu>LK1</a:StokKodu><a:Tutar>12.5</a:Tutar><a:UrunAdi>Lokum &amp; çay</a:UrunAdi></a:WebSiparisUrun></a:Urunler></a:WebSiparis>`;
const env = (inner: string) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${inner}</s:Body></s:Envelope>`;

function fakeTicimax(goodKey = 'TCMX-KEY-123456') {
  const calls: Array<{ action: string; body: string }> = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('?singleWsdl')) return new Response(WSDL);
    const body = String(init.body);
    const action = String(new Headers(init.headers).get('soapaction'));
    calls.push({ action, body });
    if (!body.includes(`<UyeKodu>${goodKey}</UyeKodu>`)) return new Response(env('<s:Fault><faultcode>s:Client</faultcode><faultstring>Yetkisiz erişim: UyeKodu hatalı</faultstring></s:Fault>'), { status: 500 });
    if (action.includes('SelectSiparis')) {
      const st = /:SiparisDurumu>(-?\d+)</.exec(body)![1];
      const list = st === '2' ? order(501, 2) : st === '4' ? order(502, 4) : order(500, 7);
      return new Response(env(`<SelectSiparisResponse xmlns="http://tempuri.org/"><SelectSiparisResult xmlns:a="${DC}" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${list}</SelectSiparisResult></SelectSiparisResponse>`));
    }
    if (action.includes('SaveKargoTakipNo')) return new Response(env('<SaveKargoTakipNoResponse xmlns="http://tempuri.org/"><SaveKargoTakipNoResult>OK</SaveKargoTakipNoResult></SaveKargoTakipNoResponse>'));
    if (action.includes('SetSiparisKargoyaVerildi')) return new Response(env('<SetSiparisKargoyaVerildiResponse xmlns="http://tempuri.org/"/>'));
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, f };
}

test('Ticimax WSDL is read for field order and namespaces; XML answers and country names are understood', () => {
  const w = readWsdl(WSDL);
  assert.equal(w.tns, 'http://tempuri.org/');
  assert.deepEqual(w.params.SelectSiparis!.map((p) => p.name), ['UyeKodu', 'f', 's']);
  assert.equal(w.types.WebSiparisFiltre!.ns, DC);
  assert.equal(w.actions.SaveKargoTakipNo, 'http://tempuri.org/ISiparisServis/SaveKargoTakipNo');
  assert.equal(parseXml('<a><b>x &amp; y</b></a>').children[0]!.children[0]!.text, 'x & y');
  assert.deepEqual(['İngiltere', 'Türkiye', 'gb', 'Almanya', 'Birleşik Krallık'].map(countryCode), ['GB', 'TR', 'GB', 'DE', 'GB']);
});

test('Ticimax: connect with Yetki Kodu → approved + packing orders → ship → tracking saved, status Kargoya verildi', async () => {
  const { app } = await makeApp();
  const { calls, f } = fakeTicimax();
  app.ticimax.fetch = f;
  app.ticimax.lookup = async () => ['93.184.216.34'];
  const c = await makeCustomer(app);

  await assert.rejects(app.ticimax.connect(c, 'www.lokumcu.com', 'WRONG-KEY-999'), /Yetki Kodu/);
  await app.ticimax.connect(c, 'www.lokumcu.com', 'TCMX-KEY-123456');
  const row = await app.db.get<{ token: string; shop: string }>("SELECT token, shop FROM shop_connections WHERE platform = 'ticimax'");
  assert.equal(row!.shop, 'https://www.lokumcu.com');
  assert.ok(!row!.token.includes('TCMX-KEY'));

  // the filter goes in the WSDL's order, in its namespace, with "no filter" values for the rest
  const sel = calls.find((x) => x.body.includes('<d0:SiparisDurumu>2<'))!.body;
  assert.match(sel, /<f><d0:DurumTarihiBas i:nil="true"\/><d0:EntegrasyonAktarildi>-1<\/d0:EntegrasyonAktarildi><d0:EntegrasyonParams><d0:AlanDeger i:nil="true"\/><d0:EntegrasyonParamsAktif>false/);
  assert.match(sel, /<d0:SiparisID>0<\/d0:SiparisID><d0:SiparisNo i:nil="true"\/><d0:UrunGetir>true<\/d0:UrunGetir><d0:UyeID>0<\/d0:UyeID><\/f>/);
  assert.match(sel, new RegExp(`xmlns:d0="${DC.replace(/\./g, '\\.')}"`));

  const ov = await app.stores.overview(c);
  assert.equal(ov.ticimax.stores.length, 1);
  assert.equal(ov.orders.length, 2);
  const o = ov.orders.find((x) => x.name === '#TCX501')!;
  assert.deepEqual([o.platform, o.to.city, o.to.postcode, o.to.country, o.items[0]], ['ticimax', 'London', 'NW1 6XE', 'GB', '2 × Lokum & çay']);

  await app.wallet.topUp(c, 5000, 'pi_t');
  const q = (await app.quotes.quote(c, ukReq())).quotes[0]!;
  const b = await app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'tcx1' });
  const linked = await app.stores.link(c, o.id, b.shipment.id);
  assert.ok(linked.pushedAt, String(linked.pushError));
  const save = calls.find((x) => x.action.includes('SaveKargoTakipNo'))!.body;
  assert.match(save, /<siparisId>501<\/siparisId>/);
  assert.match(save, /<kargoTakipNo>[^<]+<\/kargoTakipNo>/);
  assert.ok(calls.some((x) => x.action.includes('SetSiparisKargoyaVerildi') && x.body.includes('<siparisId>501</siparisId>')));
  assert.equal(await app.stores.pushTracking(b.shipment.id), false, 'sent once only');
});
