// Lühiajalise üüri (Airbnb/Booking) tootlus: ostuhind + remont + sisustus -> aastatulu - kulud. Kristiine, Mustamäe, Kesklinn.
// Eeldab data/kv_sale_harju.json (flip_scrape.js) ja ADR-andmeid (Booking.com avalikud otsingutulemused, kogutud eraldi).
// Kasutus: node scraper/airbnb.js [--max-price 100000] [--top 15]
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const MAX_PRICE = +arg('--max-price', 100000);

// Booking.com öö-hinna mediaanid 1-toalistele/stuudiotele (€/öö, 2 ööd, 2 täiskasvanut; kogutud 2026-11-22)
const ADR = {
  Kesklinn: { talv: 62, kevad: 89, suvi: 110 },
  Kristiine: { talv: 52, kevad: 61.5, suvi: 71 },
  Mustamäe: { talv: 59, kevad: 59, suvi: 69 },
};
const SEASON_W = { talv: 0.42, kevad: 0.33, suvi: 0.25 }; // kuude osakaal aastas
const adrYear = (a) => Object.entries(SEASON_W).reduce((s, [k, w]) => s + ADR[a][k] * w, 0);

const CFG = {
  realizedFactor: 0.9, // kuulutuse hind -> tegelikult teenitav keskmine (allahindlused, madalhooaeg)
  occupancy: { low: 0.45, base: 0.55, high: 0.65 },
  adrMult: { low: 0.85, base: 1.0, high: 1.1 },
  platformFee: 0.12, // Booking ~15%, Airbnb ~3-15,5%: kaalutud
  cleaning: 0.08, // koristus/pesu, mida külaline ei kata
  supplies: 0.05,
  repairs: 0.03,
  utilitiesPerMonth: 130, // elekter, küte, vesi, internet
  kuPerM2Month: 1.6, // ühistu
  manager: 0.20, // kui haldab keegi teine
  buyCosts: 0.01,
  setup: 800, // fotod, kuulutused, lukud
  taxRate: 0.22, // OÜ
};
const FURNISH = (area) => (area < 28 ? 5000 : area < 40 ? 6500 : area < 55 ? 9000 : 12000);
const sizeMult = (area) => (area < 28 ? 0.8 : area < 40 ? 1.0 : area < 55 ? 1.35 : 1.7);
const RENOVATED = /renoveeritud|uus\s+remont|uuendatud|kapitaalselt|heas\s+(korras|seisukorras)|san\.?\s*remont\s+tehtud|valmis\s+(sisse|kolimiseks)|uus\s+(torustik|elektrisüsteem)|\buus\s*,/i;
const NEEDS = /vajab\s+(san\.?\s*)?(remon|reno|uuenda)|remonti\s+vajav|täielikku remonti|halvas/i;
const STOVE = /ahi-?k[üu]t|ahjuk[üu]t|ahjuk[üu]te|ahjud?\b|puuk[üu]te|puuk[üu]tte|kaminak[üu]t|puuahi|ahjuga|ahi\b/i;
const WOOD = /puitmaja|palkmaja|puidust|puit\b/i;
const renoPerM2 = (d) => (NEEDS.test(d) ? 450 : RENOVATED.test(d) ? 60 : /keskmises\s+seisukorras|korras/i.test(d) ? 220 : 250);
const condName = (d) => (NEEDS.test(d) ? 'vajab remonti' : RENOVATED.test(d) ? 'heas korras' : /keskmises\s+seisukorras|korras/i.test(d) ? 'keskmine' : 'teadmata');
const floorOf = (d) => { const m = /Korrus\s+(-?\d+)\s*\//i.exec(d || ''); return m ? +m[1] : null; };
const yearOf = (d) => { const m = /ehitusaasta\s+(\d{4})/i.exec(d || ''); return m ? +m[1] : null; };
const areaOf = (a) => (/Mustamäe/i.test(a) ? 'Mustamäe' : /Kristiine/i.test(a) ? 'Kristiine' : /Kesklinn|Südalinn|Kassisaba|Kalamaja|Vanalinn|Uus Maailm|Kadriorg/i.test(a) && !/Põhja-Tallinn/i.test(a) ? 'Kesklinn' : null);
// Kalamaja/Kadriorg on Põhja-Tallinn/Kesklinn: võtame ainult selgelt Kesklinna märgitud
const sale = JSON.parse(fs.readFileSync(path.join(D, 'kv_sale_harju.json'), 'utf8'));
const maxId = Math.max(...sale.map((x) => +x.id));

function model(l, area, scen) {
  const adr = adrYear(area) * sizeMult(l.area) * CFG.realizedFactor * CFG.adrMult[scen];
  const rev = adr * 365 * CFG.occupancy[scen];
  const varCosts = rev * (CFG.platformFee + CFG.cleaning + CFG.supplies + CFG.repairs);
  const fixed = CFG.utilitiesPerMonth * 12 + CFG.kuPerM2Month * l.area * 12;
  const noi = rev - varCosts - fixed;
  const noiManaged = noi - rev * CFG.manager;
  return { adr, rev, noi, noiManaged };
}

const out = [];
for (const l of sale) {
  const a = areaOf(l.address);
  if (!a || l.price > MAX_PRICE || l.price < 15000 || l.area < 18) continue;
  const text = `${l.details} ${l.title} ${l.note}`;
  const fl = floorOf(l.details);
  if (STOVE.test(text) || WOOD.test(l.details)) continue;
  if ((fl !== null && fl <= 0) || /sokli|keldri|kelder/i.test(`${l.details} ${l.title}`)) continue;
  if (/kaasomand/i.test(l.details) || /kaks\s+(eraldiseisvat\s+)?korterit|kahe\s+korteri/i.test(`${l.title} ${l.note}`)) continue;
  if (/kiire\s+ost|ostan\b|ostame\b|soovin\s+osta|igas\s+seisukorras/i.test(`${l.title} ${l.note}`)) continue;
  if (/üürilepinguga|koormatud|müüdud/i.test(`${l.title} ${l.note}`)) continue;
  if (/enampakkumi|kohtutäitur/i.test(`${l.title} ${l.note}`)) continue;
  if ((yearOf(l.details) || 0) >= 2025) continue;
  const reno = Math.round(renoPerM2(l.details) * l.area * 1.15); // +15% reservi
  const furnish = FURNISH(l.area);
  const invest = l.price * (1 + CFG.buyCosts) + reno + furnish + CFG.setup;
  const res = {};
  for (const s of ['low', 'base', 'high']) {
    const m = model(l, a, s);
    res[s] = { adr: Math.round(m.adr), rev: Math.round(m.rev), noi: Math.round(m.noi), yld: m.noi / invest, yldManaged: m.noiManaged / invest, afterTax: (m.noi * (1 - CFG.taxRate)) / invest };
  }
  out.push({
    id: l.id, url: l.url, address: l.address, area: a, m2: l.area, rooms: l.rooms, price: l.price, perM2: Math.round(l.price / l.area), cond: condName(l.details), details: l.details, title: l.title, note: l.note,
    reno, furnish, invest: Math.round(invest), ageDays: Math.round((maxId - +l.id) / 500), floor: fl, res,
  });
}
out.sort((a, b) => b.res.base.yld - a.res.base.yld);
fs.writeFileSync(path.join(D, 'airbnb.json'), JSON.stringify(out, null, 1));
const f = (v) => (v * 100).toFixed(1) + '%';
console.log(`ADR aastas (1-toaline): ${Object.keys(ADR).map((k) => k + ' ' + adrYear(k).toFixed(0) + '€').join(', ')} | korterit: ${out.length} (hind <=${MAX_PRICE})`);
for (const a of ['Kesklinn', 'Kristiine', 'Mustamäe']) console.log(a, out.filter((x) => x.area === a).length);
out.slice(0, +arg('--top', 20)).forEach((x, i) => console.log(`${i + 1}) ${f(x.res.base.yld)} (low ${f(x.res.low.yld)} / high ${f(x.res.high.yld)}) | ${x.price}€ + remont ${x.reno} + sisustus ${x.furnish} = ${x.invest}€ | ${x.m2}m² ${x.rooms}t | ADR ${x.res.base.adr}€ tulu ${x.res.base.rev}€ NOI ${x.res.base.noi}€ | ${x.cond} | ${x.address.split(',').slice(0, 3).join(',')} | ${x.ageDays}p | ${x.url}`));
