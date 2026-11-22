// Flipimudel: ostuhind + remont + kulud vs. müügihind pärast remonti (ARV). Tallinn + Harjumaa.
// Eeldab data/kv_sale_harju.json (node scraper/flip_scrape.js). Kasutus: node scraper/flip.js [--top 10] [--min-profit 10000]
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };

const CFG = {
  maxPurchase: 80000, // laenu ülempiir = ostuhinna ülempiir
  maxReno: 20000, // oma raha remondiks
  minProfit: +arg('--min-profit', 10000), // puhaskasum pärast tulumaksu
  minArea: 25,
  loanRate: 0.045, // aastas
  months: 4,
  loanFee: 0.01, // 1% laenu sõlmimistasu
  buyCosts: 0.007, // notar + riigilõiv + kinnistusraamat
  holdPerMonth: 150, // ühistu + kommunaalid + kindlustus
  brokerFee: 0.03, // müügil vahendustasu
  vat: 0.24, // käibemaks vahendustasult
  saleFixed: 600, // energiamärgis, fotod, esitlus
  contingency: 0.15, // remondi ootamatused
  taxRate: 0.22, // OÜ tulumaks kasumilt
  arvHaircut: 0.92, // kuulutuse hind -> eeldatav tehinguhind
  minComps: 4,
  stoveRe: /ahi-?k[üu]t|ahjuk[üu]t|ahjuk[üu]te|ahjud?\b|puuk[üu]te|puuk[üu]tte|kaminak[üu]t|puuahi|ahjuga|ahi\b/i,
};
const RENOVATED = /renoveeritud|uus\s+remont|uuendatud|kapitaalselt|heas\s+(korras|seisukorras)|san\.?\s*remont\s+tehtud|valmis\s+(sisse|kolimiseks)|uus\s+(torustik|elektrisüsteem)|\buus\s*,/i;
const NEEDS = /vajab\s+(san\.?\s*)?(remon|reno|uuenda)|remonti\s+vajav|täielikku remonti|halvas/i;

const sale = JSON.parse(fs.readFileSync(path.join(D, 'kv_sale_harju.json'), 'utf8'));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const parts = (a) => a.split(',').map((s) => s.trim()).filter(Boolean);
const districtOf = (a) => { const p = parts(a); return p.length >= 4 ? p[1] : p[p.length - 2] || p[0]; };
const yearOf = (d) => { const m = /ehitusaasta\s+(\d{4})/i.exec(d || ''); return m ? +m[1] : null; };
const era = (y) => (y === null ? null : y < 1960 ? 'a' : y < 1990 ? 'b' : y < 2010 ? 'c' : 'd');
const floorOf = (d) => { const m = /Korrus\s+(-?\d+)\s*\//i.exec(d || ''); return m ? +m[1] : null; };
const maxId = Math.max(...sale.map((x) => +x.id));
const ageDays = (l) => Math.round((maxId - +l.id) / 500);

// remondi hinnang €/m² seisukorra järgi
function renoPerM2(l) {
  const t = `${l.details} ${l.title}`;
  const y = yearOf(l.details);
  let base, cls;
  if (NEEDS.test(l.details)) { base = 380; cls = 'vajab remonti'; }
  else if (RENOVATED.test(l.details)) { base = 60; cls = 'heas korras'; }
  else if (/keskmises\s+seisukorras|korras/i.test(l.details)) { base = 180; cls = 'keskmine'; }
  else { base = 200; cls = 'seisukord teadmata'; }
  if (y && y < 1960) base *= 1.1;
  return { perM2: base, cls };
}

// ARV: renoveeritud sarnased korterid (sama linnaosa/linn, suurus ±25%, sama ehitusaja klass)
function arv(l) {
  const dist = districtOf(l.address);
  const c0 = sale.filter((x) => x.id !== l.id && x.price >= 20000 && RENOVATED.test(x.details) && !NEEDS.test(x.details) && !/sokli|keldri|kelder/i.test(`${x.details} ${x.title}`) && !/kaasomand/i.test(x.details));
  const sizeOK = (x) => Math.abs(x.area - l.area) / l.area <= 0.25;
  const eraOK = (x) => era(yearOf(x.details)) === null || era(yearOf(l.details)) === null || era(yearOf(x.details)) === era(yearOf(l.details));
  const tries = [
    [c0.filter((x) => districtOf(x.address) === dist && x.city === l.city && sizeOK(x) && eraOK(x)), 'linnaosa+suurus'],
    [c0.filter((x) => x.city === l.city && sizeOK(x) && eraOK(x)), 'linn+suurus'],
    [c0.filter((x) => x.county === l.county && sizeOK(x) && eraOK(x) && /Tallinn/.test(l.city) === /Tallinn/.test(x.city)), 'maakond+suurus'],
  ];
  for (const [arr, lvl] of tries) {
    if (arr.length >= CFG.minComps) {
      const perM2 = arr.map((x) => x.price / x.area);
      const m = pctl(perM2, 0.4); // konservatiivne: 40. protsentiil
      return { perM2: m * CFG.arvHaircut, rawMed: med(perM2), n: arr.length, level: lvl, comps: arr, medAge: med(arr.map(ageDays)) };
    }
  }
  return null;
}

function evaluate(l) {
  const text = `${l.details} ${l.title} ${l.note}`;
  const fl = floorOf(l.details);
  if (l.price > CFG.maxPurchase || l.area < CFG.minArea || l.price < 8000 || l.price / l.area < 300) return { skip: 'hind/pindala' };
  if (CFG.stoveRe.test(text)) return { skip: 'ahiküte' };
  if ((fl !== null && fl <= 0) || /sokli|keldri|kelder/i.test(`${l.details} ${l.title}`)) return { skip: 'sokkel' };
  if (/kaasomand/i.test(l.details) || /kaks\s+(eraldiseisvat\s+)?korterit|kahe\s+korteri/i.test(`${l.title} ${l.note}`)) return { skip: 'kaasomand/mitu korterit' };
  if (/kiire\s+ost|ostan\b|ostame\b|soovin\s+osta|igas\s+seisukorras/i.test(`${l.title} ${l.note}`)) return { skip: 'ostjapoolne' };
  const r = renoPerM2(l);
  const reno = Math.round(r.perM2 * l.area * (1 + CFG.contingency));
  if (reno > CFG.maxReno) return { skip: 'remont üle 20 000 €' };
  const a = arv(l);
  if (!a) return { skip: 'ARV võrdlusi liiga vähe' };
  const arvPrice = Math.round(a.perM2 * l.area);
  const loan = Math.min(l.price, 80000);
  const interest = Math.round(loan * CFG.loanRate * CFG.months / 12);
  const buyCosts = Math.round(l.price * CFG.buyCosts + loan * CFG.loanFee);
  const hold = CFG.holdPerMonth * CFG.months;
  const saleCosts = Math.round(arvPrice * CFG.brokerFee * (1 + CFG.vat) + CFG.saleFixed);
  const totalCost = l.price + reno + interest + buyCosts + hold + saleCosts;
  const gross = arvPrice - totalCost;
  const tax = Math.max(0, Math.round(gross * CFG.taxRate));
  const net = gross - tax;
  const invested = l.price + reno + buyCosts + hold; // koguinvesteering (enne laenu)
  const own = Math.max(0, l.price - loan) + reno + buyCosts + hold + interest; // oma raha
  const rule70 = (l.price + reno) / arvPrice; // 70% reegel
  const slow = a.medAge > 120;
  return {
    id: l.id, url: l.url, address: l.address, city: l.city, area: l.area, rooms: l.rooms, price: l.price, perM2: Math.round(l.price / l.area), details: l.details, title: l.title,
    renoCls: r.cls, reno, arvPerM2: Math.round(a.perM2), arvRaw: Math.round(a.rawMed), arvPrice, compN: a.n, compLevel: a.level, compMedAge: Math.round(a.medAge),
    interest, buyCosts, hold, saleCosts, totalCost, gross, tax, net, roiOwn: own > 0 ? net / own : null, roiCost: net / totalCost, rule70, own, slow,
    ageDays: ageDays(l), comps: a.comps.sort((x, y) => Math.abs(x.area - l.area) - Math.abs(y.area - l.area)).slice(0, 3).map((x) => ({ price: x.price, area: x.area, perM2: Math.round(x.price / x.area), addr: x.address.split(',').slice(0, 3).join(','), url: x.url, details: x.details })),
  };
}

const all = sale.map(evaluate);
const skipped = {};
all.filter((x) => x.skip).forEach((x) => (skipped[x.skip] = (skipped[x.skip] || 0) + 1));
const ok = all.filter((x) => !x.skip);
const good = ok.filter((x) => x.net >= CFG.minProfit);
// järjestus: puhaskasum, korrigeeritud riskiga (kiirus, ARV usaldus, 70% reegel)
const risk = (x) => (x.slow ? 0.85 : 1) * (x.compN >= 8 ? 1 : x.compN >= 5 ? 0.92 : 0.85) * (x.rule70 <= 0.7 ? 1 : x.rule70 <= 0.75 ? 0.95 : 0.88);
good.forEach((x) => (x.rankScore = x.net * risk(x)));
good.sort((a, b) => b.rankScore - a.rankScore);
fs.writeFileSync(path.join(D, 'flip.json'), JSON.stringify(good, null, 1));
console.log('kõik', sale.length, 'hinnatud', ok.length, 'kasum >=', CFG.minProfit, ':', good.length);
console.log('välja jäetud:', skipped);
good.slice(0, +arg('--top', 15)).forEach((x, i) => console.log(`${i + 1}) neto ${x.net}€ bruto ${x.gross}€ | ost ${x.price} + remont ${x.reno} (${x.renoCls}) → ARV ${x.arvPrice} (${x.arvPerM2}€/m², ${x.compN} võrd., ${x.compLevel}, med.vanus ${x.compMedAge}p) | 70%-reegel ${(x.rule70 * 100).toFixed(0)}% | ${x.area}m² | ${x.address.split(',').slice(0, 3).join(',')} | ${x.url}`));
