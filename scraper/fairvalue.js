// Õiglane turuväärtus vs küsitav hind. Tallinn ja Harjumaa (v.a Tallinn), kõik hinnaklassid kuni 300 000 €.
// Eeldab data/kv_sale_harju.json. Kasutus: node scraper/fairvalue.js [--top 5]
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const topN = +arg('--top', 5);
const NO_WOOD = process.argv.includes('--no-wood');
const NEAR = process.argv.includes('--near'); // lähedus Tallinnale + õiglane hind alla piiri
const MAX_KM = +arg('--max-km', 20);
const MAX_FAIR = +arg('--max-fair', 100000);
const MAX_PRICE = +arg('--max-price', 0); // küsitava hinna ülempiir (0 = ei piira)
const ONLY_CITY = arg('--city', null);
const WOOD = /puitmaja|palkmaja|puidust|puit\b/i;

const sale = JSON.parse(fs.readFileSync(path.join(D, 'kv_sale_harju.json'), 'utf8'));
const parts = (a) => a.split(',').map((s) => s.trim()).filter(Boolean);
const geo = (a) => {
  const p = parts(a);
  const ti = p.findIndex((x) => /^Tallinn$/i.test(x));
  if (ti > 0) return { city: 'Tallinn', district: p[ti - 1] };
  if (p.length >= 3) return { city: p[p.length - 1].replace(/,?\s*Harjumaa$/i, ''), district: p[1] };
  return { city: p[p.length - 1], district: p[p.length - 1] }; // 'Tänav, Maardu' -> asum = linn
};
sale.forEach((x) => { const g = geo(x.address); x.city = g.city; x.district = g.district; });
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const yearOf = (d) => { const m = /ehitusaasta\s+(\d{4})/i.exec(d || ''); return m ? +m[1] : null; };
const era = (y) => (y === null ? null : y < 1960 ? 'a' : y < 1990 ? 'b' : y < 2010 ? 'c' : 'd');
const floorOf = (d) => { const m = /Korrus\s+(-?\d+)\s*\//i.exec(d || ''); return m ? +m[1] : null; };
const NEEDS = /vajab\s+(san\.?\s*)?(remon|reno|uuenda)|remonti\s+vajav|täielikku remonti|halvas/i;
const RENOVATED = /renoveeritud|uus\s+remont|uuendatud|kapitaalselt|heas\s+(korras|seisukorras)|san\.?\s*remont\s+tehtud|valmis\s+(sisse|kolimiseks)|uus\s+(torustik|elektrisüsteem)|\buus\s*,/i;
const cond = (d) => (NEEDS.test(d) ? 'N' : RENOVATED.test(d) ? 'R' : 'M');
const CONDNAME = { N: 'vajab remonti', R: 'heas korras / renoveeritud', M: 'keskmine / teadmata' };
const maxId = Math.max(...sale.map((x) => +x.id));
const ageDays = (l) => Math.round((maxId - +l.id) / 500);
const STOVE = /ahi-?k[üu]t|ahjuk[üu]t|ahjuk[üu]te|ahjud?\b|puuk[üu]te|puuk[üu]tte|kaminak[üu]t|puuahi|ahjuga|ahi\b/i;

function excluded(l) {
  const text = `${l.details} ${l.title} ${l.note}`;
  const fl = floorOf(l.details);
  if (l.area < 25 || l.price < 15000 || l.price / l.area < 300) return 'hind/pindala';
  if (STOVE.test(text)) return 'ahiküte';
  if (NO_WOOD && WOOD.test(l.details)) return 'puitmaja';
  if ((fl !== null && fl <= 0) || /sokli|keldri|kelder/i.test(`${l.details} ${l.title}`)) return 'sokkel';
  if (/kaasomand/i.test(l.details) || /kaks\s+(eraldiseisvat\s+)?korterit|kahe\s+korteri|korterid\s+koos/i.test(`${l.title} ${l.note}`)) return 'kaasomand/mitu';
  if (/kiire\s+ost|ostan\b|ostame\b|soovin\s+osta|igas\s+seisukorras/i.test(`${l.title} ${l.note}`)) return 'ostjapoolne';
  if (/üürilepinguga|koormatud|üürnik(uga)?\b/i.test(`${l.title} ${l.note}`)) return 'üürnikuga/koormatud';
  if (/uusarendus|uusehitus|broneeri|valmib\s+20(2[6-9])|esimesed majad/i.test(`${l.title} ${l.note}`) || (yearOf(l.details) || 0) >= 2025) return 'uusarendus';
  return null;
}

const pool = sale.filter((x) => !excluded(x) || true); // võrdlusbaas: kõik kuulutused
const compPool = sale.filter((x) => !(NO_WOOD && WOOD.test(x.details)) && !/sokli|keldri|kelder/i.test(`${x.details} ${x.title}`) && !/kaasomand/i.test(x.details) && x.price >= 15000 && x.area >= 20 && !/uusarendus|broneeri|valmib\s+20(2[6-9])|esimesed majad/i.test(`${x.title} ${x.note}`) && (yearOf(x.details) || 0) < 2025);

function fair(l) {
  const sizeOK = (x) => Math.abs(x.area - l.area) / l.area <= 0.25;
  const eraOK = (x) => era(yearOf(x.details)) === null || era(yearOf(l.details)) === null || era(yearOf(x.details)) === era(yearOf(l.details));
  const sameCond = (x) => cond(x.details) === cond(l.details);
  const base = compPool.filter((x) => x.id !== l.id && sizeOK(x) && eraOK(x));
  const tries = [
    [base.filter((x) => x.district === l.district && x.city === l.city && sameCond(x)), 'asum+suurus+seisukord', 4],
    ...(NEAR ? [[base.filter((x) => x.city === l.city && sameCond(x)), 'vald+suurus+seisukord', 8]] : []),
  ];
  for (const [arr, lvl, minN] of tries) {
    if (arr.length >= minN) {
      const perM2 = arr.map((x) => x.price / x.area);
      return { perM2: med(perM2), n: arr.length, level: lvl, comps: arr, medAge: med(arr.map(ageDays)) };
    }
  }
  return null;
}

const rows = [];
const skip = {};
for (const l of sale) {
  const ex = excluded(l);
  if (ex) { skip[ex] = (skip[ex] || 0) + 1; continue; }
  const f = fair(l);
  if (!f) { skip.võrdlusiVähe = (skip.võrdlusiVähe || 0) + 1; continue; }
  const fairPrice = Math.round(f.perM2 * l.area);
  const disc = 1 - l.price / fairPrice;
  rows.push({
    id: l.id, url: l.url, address: l.address, city: l.city, district: l.district, area: l.area, rooms: l.rooms, price: l.price, perM2: Math.round(l.price / l.area),
    details: l.details, title: l.title, note: l.note, cond: CONDNAME[cond(l.details)], ageDays: ageDays(l),
    fairPerM2: Math.round(f.perM2), fairPrice, disc, saving: fairPrice - l.price, compN: f.n, compLevel: f.level, compMedAge: Math.round(f.medAge),
    comps: [...f.comps].sort((a, b) => Math.abs(a.area - l.area) - Math.abs(b.area - l.area)).slice(0, 3).map((x) => ({ price: x.price, area: x.area, perM2: Math.round(x.price / x.area), addr: x.address.split(',').slice(0, 3).join(','), url: x.url, details: x.details })),
    flags: [],
  });
}
for (const r of rows) {
  if (/enampakkumi|kohtutäitur/i.test(`${r.title} ${r.note}`)) r.flags.push('enampakkumine/kohtutäitur');
  if (r.compN < 6) r.flags.push(`${r.compN} võrdlust`);
  if (r.disc > 0.5) r.flags.push('allahindlus üle 50%: kontrolli, miks');
  if (r.ageDays > 300) r.flags.push(`üleval ~${Math.round(r.ageDays / 30)} kuud`);
  if (r.cond === 'vajab remonti') r.flags.push('vajab remonti');
}
// sama maja kontroll: teised kuulutused samal tänavanumbril
const streetKey = (a) => parts(a)[0].toLowerCase().replace(/[-\/]\s*\d+.*$/, '').replace(/\s+/g, ' ').trim() + '|' + geo(a).district.toLowerCase();
const byBuilding = {};
sale.forEach((x) => { (byBuilding[streetKey(x.address)] = byBuilding[streetKey(x.address)] || []).push(x); });
for (const r of rows) {
  const others = (byBuilding[streetKey(r.address)] || []).filter((x) => x.id !== r.id && x.area >= 20 && x.price >= 15000 && Math.abs(x.area - r.area) / r.area <= 0.4);
  r.sameBuilding = others.map((x) => ({ price: x.price, area: x.area, perM2: Math.round(x.price / x.area), details: x.details, url: x.url, cond: CONDNAME[cond(x.details)] }));
  r.sameN = others.length;
  r.sameMedPerM2 = others.length ? Math.round(med(others.map((x) => x.price / x.area))) : null;
  r.sameDisc = r.sameMedPerM2 ? 1 - r.perM2 / r.sameMedPerM2 : null;
}
// kvaliteedifilter: vähemalt 5 võrdlust ja allahindlus tõsiselt tõenäoline (alla 55%)
const ok = rows.filter((x) => x.compN >= 4 && x.disc < 0.6);
const tallinn = ok.filter((x) => x.city === 'Tallinn').sort((a, b) => b.disc - a.disc);
const harju = ok.filter((x) => x.city !== 'Tallinn').sort((a, b) => b.disc - a.disc);
fs.writeFileSync(path.join(D, 'fair_tallinn.json'), JSON.stringify(tallinn.slice(0, 30), null, 1));
fs.writeFileSync(path.join(D, 'fair_harju.json'), JSON.stringify(harju.slice(0, 30), null, 1));
console.log('hinnatud', rows.length, 'välja jäetud', skip, 'Tallinn', tallinn.length, 'Harju', harju.length);
const show = (arr) => arr.slice(0, 15).forEach((x, i) => console.log(`${i + 1}) -${Math.round(x.disc * 100)}% (maja: ${x.sameN ? (x.sameDisc >= 0 ? '-' : '+') + Math.abs(Math.round(x.sameDisc * 100)) + '% vs ' + x.sameN + ' teist' : 'ei ole'}) | ${x.price}€ vs õiglane ${x.fairPrice}€ (${x.fairPerM2}€/m², ${x.compN} võrd., ${x.compLevel}) | ${x.area}m² | ${x.cond} | ${x.address.split(',').slice(0, 3).join(',')} | vanus ${x.ageDays}p | ${x.flags.join(';')} | ${x.url}`));
console.log('\nTALLINN'); show(tallinn);
console.log('\nHARJUMAA'); show(harju);

// ===== lähedus Tallinnale (ligikaudne maanteekaugus km) =====
const KM = [
  [/^Tallinn$/i, 0], [/Maardu/i, 17], [/Haabneeme|Viimsi|Püünsi|Pirita|Pringi|Lubja|Randvere|Haabneeme|Miiduranna|Rohuneeme|Muuga|Kelvingi|Metsakasti/i, 14],
  [/Peetri|Jüri|Assaku|Rae vald|Lagedi|Kulna|Rae,|Vaida|Mäo|Patika|Järveküla|Veskitaguse|Kopli/i, 14], [/Laagri|Saue vald|Tänassilma|Urda|Kasemetsa|Kütise|Haiba|Ääsmäe|Saue linn|Nehatu/i, 99], // Saue valla täpne kaugus eraldi allpool
  [/Saku|Kiisa|Tammemäe|Kurtna|Metsanurga|Männiku|Roobuka|Rahula|Saku vald/i, 99], [/Kiili|Kangru|Luige|Sausti|Mõisaküla|Kiili vald/i, 99],
  [/Tabasalu|Harku|Rannamõisa|Muraste|Kumna|Naage|Laabi|Harku vald/i, 99], [/Loo alevik|Jõelähtme|Kostivere|Maardu|Iru|Ülgase|Jõelähtme vald/i, 99],
];
const KMS = { Laagri: 12, Peetri: 10, Jüri: 15, Assaku: 12, Lagedi: 15, Saku: 19, Kiili: 18, Tabasalu: 16, Harku: 14, Rannamõisa: 14, Viimsi: 12, Haabneeme: 12, Püünsi: 12, Maardu: 17, Loo: 18, Jõelähtme: 20, Kostivere: 25, Saue: 21, Keila: 28, Kehra: 40, Paldiski: 52, Aruküla: 30, Kose: 40, Vääna: 24, Kumna: 16, Muraste: 14, Rummu: 40, Laitse: 35, Riisipere: 40, Turba: 30, Haiba: 28, Kurtna: 17, Nõmme: 8 };
function kmOf(l) {
  if (l.city === 'Tallinn') return 0;
  const hay = `${l.district}, ${l.city}`; // ainult asula/linn/vald, mitte tänav
  for (const [k, v] of Object.entries(KMS)) if (new RegExp('(^|[ ,])' + k + '([ ,]|$)', 'i').test(hay)) return v;
  return 99;
}
if (NEAR) {
  const cands = rows.filter((x) => x.compN >= 4 && x.disc > 0 && x.disc < 0.6 && (MAX_PRICE ? x.price <= MAX_PRICE : x.fairPrice < MAX_FAIR) && (ONLY_CITY ? x.city === ONLY_CITY : kmOf(x) <= MAX_KM))
    .map((x) => ({ ...x, km: kmOf(x) })).sort((a, b) => b.disc - a.disc);
  fs.writeFileSync(path.join(D, 'fair_near.json'), JSON.stringify(cands.slice(0, 40), null, 1));
  console.log(`\nLÄHEDAL (<=${MAX_KM} km, õiglane hind <${MAX_FAIR}, ei puitmaja/ahi/sokkel): ${cands.length}`);
  cands.slice(0, 20).forEach((x, i) => console.log(`${i + 1}) -${Math.round(x.disc * 100)}% | ${x.price}€ vs õiglane ${x.fairPrice}€ (${x.compN} võrd.) | ${x.km}km | ${x.area}m² | ${x.cond} | ${x.address.split(',').slice(0, 3).join(',')} | ${x.ageDays}p | ${x.flags.join(';')} | ${x.url}`));
}

// ===== Tallinna hinnang 0-10 ja kauplemise sihthinnad (--rate) =====
if (process.argv.includes('--rate')) {
  const rentAll = JSON.parse(fs.readFileSync(path.join(D, 'kv_rent.json'), 'utf8'));
  const rentT = rentAll.map((x) => ({ ...x, ...geo(x.address) })).filter((x) => x.city === 'Tallinn' && x.area > 0 && x.price > 80 && x.price < 3000);
  const clamp = (v, a = 0, b = 10) => Math.max(a, Math.min(b, v));
  const NOLAS = /Lasnamäe/i;
  const W = { disc: 0.40, yld: 0.30, cheap: 0.10, conf: 0.20 };
  function rentEst(l) {
    const near = (x) => Math.abs(x.area - l.area) / l.area <= 0.3;
    const a = rentT.filter((x) => x.district === l.district && near(x));
    const b = rentT.filter((x) => near(x));
    const pool = a.length >= 5 ? a : b;
    if (pool.length < 5) return null;
    return { value: med(pool.map((x) => x.price / x.area)) * l.area, n: pool.length, level: a.length >= 5 ? 'linnaosa' : 'Tallinn' };
  }
  const renoOf = (l) => (l.cond === 'vajab remonti' ? 10000 : l.cond === 'keskmine / teadmata' ? 3000 : 0);
  function rate(l, price, re) {
    const cost = price + renoOf(l);
    const disc = 1 - price / l.fairPrice; // allahindlus õiglasest hinnast
    const net = (re.value * 12 * 0.85) / cost;
    const sc = {
      disc: clamp((disc / 0.30) * 10), // 30% alla õiglase = 10
      yld: clamp(((net - 0.04) / 0.04) * 10), // neto 4% = 0, 8% = 10
      cheap: clamp(10 * (1 - (cost - 40000) / 60000)), // kogusumma 40 000 € = 10, 100 000 € = 0
      conf: clamp(0.6 * Math.min(10, l.compN / 3) + 0.4 * Math.min(10, re.n / 2)),
    };
    return { total: Object.keys(W).reduce((s, k) => s + sc[k] * W[k], 0), sc, net, cost, disc };
  }
  function priceFor(l, re, goal) {
    const lo = Math.round(l.price * 0.55);
    if (rate(l, lo, re).total < goal) return null; // ei saavutata isegi -45% korral
    if (rate(l, l.price, re).total >= goal) return l.price;
    let a = lo, b = l.price;
    for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (rate(l, m, re).total >= goal) a = m; else b = m; }
    return Math.round(a / 100) * 100;
  }
  const out = [];
  for (const l of rows) {
    if (l.city !== 'Tallinn' || NOLAS.test(`${l.district} ${l.address}`)) continue;
    if ((MAX_PRICE ? l.price > MAX_PRICE : l.fairPrice > MAX_FAIR) || l.disc <= 0 || l.disc >= 0.6 || l.compN < 4) continue;
    if (/enampakkumi|kohtutäitur/i.test(`${l.title} ${l.note}`)) continue;
    const re = rentEst(l);
    if (!re) continue;
    const now = rate(l, l.price, re);
    out.push({ ...l, rent: Math.round(re.value), rentN: re.n, rentLevel: re.level, reno: renoOf(l), score: now.total, sc: now.sc, net: now.net, price8: priceFor(l, re, 8), price9: priceFor(l, re, 9), price10: priceFor(l, re, 9.7), maxScore: rate(l, Math.round(l.price * 0.55), re).total });
  }
  out.sort((a, b) => b.score - a.score);
  fs.writeFileSync(path.join(D, MAX_PRICE ? 'tallinn_rated_price.json' : 'tallinn_rated.json'), JSON.stringify(out, null, 1));
  console.log('\nTALLINN (ilma Lasnamäeta, puitmajadeta, sokliteta; õiglane hind <=' + MAX_FAIR + '):', out.length);
  out.slice(0, 20).forEach((x, i) => console.log(`${i + 1}) ${x.score.toFixed(1)} | ${x.price}€ vs õiglane ${x.fairPrice}€ -${Math.round(x.disc * 100)}% | ${x.area}m² | üür ~${x.rent} (${x.rentN}) neto ${(x.net * 100).toFixed(1)}% | 8: ${x.price8 ?? '-'} 9: ${x.price9 ?? '-'} | max ${x.maxScore.toFixed(1)} | ${x.address.split(',').slice(0, 3).join(',')} | ${x.cond} | ${x.ageDays}p | ${x.url}`));
}
