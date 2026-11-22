// Kinnisvara top 3 strateegia kohta (pikaajaline üür, lühiajaline üür, flip, otse edasimüük) + mega diili tuvastus.
// Kasutus:
//   node scraper/top3.js --report      -> data/raport.txt (täisraport)
//   node scraper/top3.js --daily       -> data/daily_result.json + data/mega_email.txt (kui leidub uusi mega diile)
//   node scraper/top3.js --mark-sent   -> lisab data/mega_ids.json diilid faili data/saadetud_diilid.csv
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');
const has = (f) => process.argv.includes(f);

// ===================== PARAMEETRID (vt prompt) =====================
const BASE = {
  maxPrice: 100000, minPrice: 15000, // alla 15 000 € objekte ei võta edetabelisse (ebalikviidne, tehingukulud ja NOI liiga väikesed): minu täiendus
  flipCostWarn: 140000,
  ltv: 0.7, rate: 0.045, years: 30,
  buyCosts: 0.015, sellCosts: 0.035,
  baseNeg: 0.04, // keskmine allahindlus küsitud hinnast
  vacancy: { top: 1, mid: 2, low: 3 }, // tühjad kuud
  reserve: 0.01, insurance: 100, kuPerM2: 1.2, incomeTax: 0.22,
  adrRealized: 0.9, platform: 0.15, mgmt: 0.22, furnish: 6000,
  occ: { centre: 0.55, other: 0.5 },
  reno: { cosm: 250, mid: 450, full: 700 }, renoReserve: 0.12, flipMonths: 6, holdUtil: 50,
  directMonths: 2.5, directMinDisc: 0.20,
  flipMinProfit: 12000, flipMinPct: 0.15,
  saleDiscount: 0.04, // tehinguhind alla küsitud hinna
  megaDirectDisc: 0.30, megaFlipProfit: 25000, megaFlipPct: 0.25, megaLT: 0.07, megaST: 0.10,
  rentMult: 1, saleMult: 1, renoMult: 1,
};
const P = { ...BASE };

// ===================== ANDMED =====================
const read = (f, d) => (fs.existsSync(path.join(D, f)) ? JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')) : d);
const rawSale = [...read('kv_sale.json', []), ...read('kv_sale_harju.json', [])];
const rawRent = read('kv_rent.json', []);
const booking = read('booking_adr.json', {});

const parts = (a) => String(a || '').split(',').map((s) => s.trim()).filter(Boolean);
const TALLINN_D = /^(Kesklinn|Kristiine|Mustamäe|Lasnamäe|Pirita|Haabersti|Nõmme|Põhja-Tallinn)$/i;
function geo(address) {
  let p = parts(address);
  let county = null;
  if (p.length && /maa$/i.test(p[p.length - 1]) && !/^Tallinn$/i.test(p[p.length - 1])) { county = p[p.length - 1]; p = p.slice(0, -1); }
  const ti = p.findIndex((x) => /^Tallinn$/i.test(x));
  if (ti > 0) return { county: 'Harjumaa', city: 'Tallinn', district: p[ti - 1] };
  if (p.length >= 2 && TALLINN_D.test(p[p.length - 1])) return { county: 'Harjumaa', city: 'Tallinn', district: p[p.length - 1] };
  let city = [...p].slice(1).reverse().find((x) => /\blinn$/i.test(x)) || p[p.length - 1] || '';
  city = city.replace(/\s+linn$/i, '');
  const district = p.length >= 3 ? p[1] : city;
  return { county, city, district: district.replace(/\s+linn$/i, '') };
}
const URBAN_DISTRICT = /^(Kesklinn|Südalinn|Kassisaba|Vanalinn|Uus Maailm|Kadriorg|Kristiine|Mustamäe|Lasnamäe|Pirita|Haabersti|Nõmme|Põhja-Tallinn|Annelinn|Karlova|Supilinn|Tammelinn|Ropka|Variku|Veeriku|Vaksali|Raadi|Raadi-Kruusamäe|Jaamamõisa|Ülejõe|Ihaste|Rannarajoon|Mai|Rääma|Port Artur|Papsaare|Sauga|Vana-Pärnu|Ahtme|Järve|Sompa|Oru|Kukruse|Kreenholm|Fama|Joaorg|Kulgu|Vahtra|Kesklinn)$/i;
const isVillage = (x) => x.city !== 'Tallinn' && x.district !== x.city && !URBAN_DISTRICT.test(x.district);
const num = (x) => (typeof x === 'number' ? x : null);
const _unused = (x) => (typeof x === 'number' ? x : null);
const yearOf = (d) => { const m = /ehitusaasta\s+(\d{4})/i.exec(d || ''); return m ? +m[1] : null; };
const era = (y) => (y === null ? null : y < 1960 ? 'a' : y < 1990 ? 'b' : y < 2010 ? 'c' : 'd');
const floorOf = (d) => { const m = /Korrus\s+(-?\d+)\s*\//i.exec(d || ''); return m ? +m[1] : null; };
const NEEDS = /vajab\s+(san\.?\s*)?(remon|reno|uuenda)|remonti\s+vajav|täielikku remonti|halvas/i;
const RENOV = /renoveeritud|uus\s+remont|uuendatud|kapitaalselt|heas\s+(korras|seisukorras)|san\.?\s*remont\s+tehtud|valmis\s+(sisse|kolimiseks)|uus\s+(torustik|elektrisüsteem)|\buus\s*,/i;
const PREM = /täielikult\s+(projekti|renov)|projekti\s+järgi|disain|luksus|kapitaalselt\s+renov|põhjalikult\s+renov/i;
const cond = (d, x = '') => (NEEDS.test(d) ? 'N' : PREM.test(`${d} ${x}`) ? 'P' : RENOV.test(d) ? 'R' : 'M');
const STOVE = /ahi-?k[üu]t|ahjuk[üu]t|ahjuk[üu]te|ahjud?\b|puuk[üu]te|puuk[üu]tte|kaminak[üu]t|puuahi|ahjuga|ahi\b/i;
const WOOD = /puitmaja|palkmaja|puidust|puit\b/i;
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const sale = new Map();
for (const x of rawSale) {
  const g = geo(x.address);
  const o = { ...x, id: String(x.id), ...g, cond: cond(x.details, `${x.title} ${x.note}`), year: yearOf(x.details), floor: floorOf(x.details) };
  if (!o.county && g.city === 'Tallinn') o.county = 'Harjumaa';
  if (!o.county && x.county) o.county = x.county;
  sale.set(o.id, o);
}
const saleAll = [...sale.values()];
const rentAll = rawRent.map((x) => ({ ...x, ...geo(x.address) })).filter((x) => x.price > 80 && x.price < 4000 && x.area > 10);
const maxId = Math.max(...saleAll.map((x) => +x.id));
const ageDays = (x) => Math.round((maxId - +x.id) / 500);

// ===================== PUHASTUS =====================
const FLAGS = [
  [/kaasomand|mõtteline\s+osa|osaühis/i, 'kaasomand/mõtteline osa'],
  [/kaks\s+(eraldiseisvat\s+)?korterit|kahe\s+korteri|korterid\s+koos/i, 'mitu korterit'],
  [/kiire\s+ost|ostan\b|ostame\b|soovin\s+osta|igas\s+seisukorras/i, 'ostjapoolne kuulutus'],
  [/üürilepinguga|koormatud|üürnik(uga)?\b|rentnik/i, 'üürnikuga/koormatud'],
  [/enampakkumi|kohtutäitur/i, 'enampakkumine/täitur'],
  [/ametiruum|äripind|mitteeluruum|hoonestusõigus/i, 'ei ole tavaline eluruum'],
  [/valesti\s+ehitatud|katus[^.]{0,40}(lekk|probleem|valesti)/i, 'hoone/katuse probleem'],
  [/müüdud|broneeritud/i, 'müüdud/broneeritud'],
  [/uusarendus|broneeri\s+oma|valmib\s+20(2[6-9])|esimesed\s+majad/i, 'uusarendus'],
];
const BLACK = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'blacklist.json'), 'utf8')); } catch (e) { return {}; } })();
const dedup = new Map();
const excluded = [];
for (const x of saleAll) {
  const text = `${x.title} ${x.note} ${x.details} ${x.address}`;
  let reason = BLACK[x.id] ? 'käsitsi välistatud: ' + BLACK[x.id] : null;
  if (reason) { /* must nimekiri */ }
  else if (!parts(x.address).length || !(x.area >= 15) || !(x.price >= 6000)) reason = 'vigased andmed (aadress/m²/hind)';
  else if ((x.floor !== null && x.floor <= 0) || /sokli|keldri|kelder/i.test(`${x.details} ${x.title}`)) reason = 'sokli-/keldrikorrus';
  else for (const [re, name] of FLAGS) if (re.test(text) && !(name === 'üürnikuga/koormatud' && /üürnikud?\s+puuduvad/i.test(text))) { reason = name; break; }
  if (!reason && (x.year || 0) >= 2025) reason = 'uusarendus';
  if (reason) { x.excl = reason; excluded.push(x); continue; }
  const key = `${parts(x.address)[0].toLowerCase().replace(/\s+/g, ' ')}|${x.district}|${Math.round(x.area)}|${x.floor}`;
  const prev = dedup.get(key);
  if (!prev || +x.id > +prev.id) dedup.set(key, x);
}
const clean = [...dedup.values()];
clean.forEach((x) => { x.village = isVillage(x); });

// ===================== PIIRKONNA RISK =====================
const CENTERS = /^(Pärnu|Viljandi|Rakvere|Haapsalu|Kuressaare|Võru|Valga|Paide|Rapla|Jõgeva|Põlva|Kärdla)$/i;
const HARJU_NEAR = /Maardu|Saue|Saku|Rae vald|Viimsi|Harku|Kiili|Jõelähtme|Keila|Raasiku/i;
function region(x) {
  if (x.city === 'Tallinn') return { pp: 0, vac: 1, label: 'Tallinn' };
  if (/Tartu/i.test(x.city) && !/Tartu vald/i.test(x.city)) return { pp: 0.5, vac: 1, label: 'Tartu' };
  if (/Ida-Virumaa/i.test(x.county || '') || /Narva|Sillamäe|Kohtla|Jõhvi|Kiviõli|Narva-Jõesuu/i.test(x.city)) return { pp: 3, vac: 3, label: 'Ida-Virumaa' };
  if (/Harjumaa/i.test(x.county || '') && HARJU_NEAR.test(`${x.city} ${x.district}`)) return { pp: 0.5, vac: 2, label: 'Harjumaa (Tallinna ümbrus)' };
  if (CENTERS.test(x.city)) return { pp: 1.5, vac: 2, label: 'maakonnakeskus' };
  return { pp: 3, vac: 3, label: 'väikelinn/asula' };
}
function extras(x) {
  const e = [];
  if (STOVE.test(`${x.details} ${x.title} ${x.note}`)) e.push('ahiküte');
  if (x.year && x.year < 1960 && x.cond !== 'R' && x.cond !== 'P') e.push('hoone <1960 ilma renoveerimiseta');
  return e;
}
const grade = (n, level, village) => (level === 'maakond' || (village && level !== 'asum') ? 'madal' : n >= 10 ? 'kõrge' : n >= 5 ? 'keskmine' : 'madal'); // maakonnatasandi laiendus = alati madal
const gradeRank = { madal: 0, keskmine: 1, kõrge: 2 };

// ===================== VÕRDLUSED =====================
const eraOK = (a, b) => era(a) === null || era(b) === null || era(a) === era(b);
function saleComps(x, condSet, minN = 5) {
  const pool = saleAll.filter((y) => y.id !== x.id && !y.excl && condSet.includes(y.cond) && Math.abs(y.area - x.area) / x.area <= 0.25 && eraOK(y.year, x.year) && y.price >= 15000);
  const tries = [
    pool.filter((y) => y.city === x.city && y.district === x.district),
    pool.filter((y) => y.city === x.city),
    pool.filter((y) => (x.county ? y.county === x.county : y.city === x.city)),
  ];
  let best = null; const lv = ['asum', 'linn', 'maakond'];
  for (let i = 0; i < tries.length; i++) { const t = tries[i]; if (t.length >= minN) return { perM2: med(t.map((y) => y.price / y.area)), n: t.length, level: lv[i], comps: t }; if (!best || t.length > best.n) best = { perM2: t.length ? med(t.map((y) => y.price / y.area)) : null, n: t.length, level: lv[i], comps: t }; }
  return best;
}
function rentComps(x) {
  const pool = rentAll.filter((y) => Math.abs(y.area - x.area) / x.area <= 0.30);
  const tries = [pool.filter((y) => y.city === x.city && y.district === x.district), pool.filter((y) => y.city === x.city), pool.filter((y) => (x.county ? y.county === x.county : false))];
  let best = null; const lv = ['asum', 'linn', 'maakond'];
  for (let i = 0; i < tries.length; i++) { const t = tries[i]; if (t.length >= 5) return { perM2: med(t.map((y) => y.price / y.area)), n: t.length, level: lv[i], comps: t }; if (!best || t.length > best.n) best = { perM2: t.length ? med(t.map((y) => y.price / y.area)) : null, n: t.length, level: lv[i], comps: t }; }
  return best;
}

// ===================== LÄBIRÄÄKIMINE =====================
const cityAge = {};
for (const c of new Set(clean.map((x) => x.city))) cityAge[c] = med(clean.filter((x) => x.city === c).map(ageDays)) || 30;
function negotiation(x) {
  const t = `${x.title} ${x.note}`;
  let neg = P.baseNeg; const why = [];
  const ratio = ageDays(x) / Math.max(15, cityAge[x.city] || 30);
  if (ratio > 4) { neg += 0.06; why.push(`üleval ~${ageDays(x)} päeva (>4× piirkonna mediaan)`); }
  else if (ratio > 2) { neg += 0.03; why.push(`üleval ~${ageDays(x)} päeva (>2× piirkonna mediaan)`); }
  if (/uus\s+hind|hind\s+(alandatud|langes|langenud)|hinda\s+langetatud/i.test(t)) { neg += 0.02; why.push('hinda on alandatud'); }
  if (/kiire|pakkumised?|pärand|kolin|välismaale|kiirmüük|lepime\s+hinnas/i.test(t)) { neg += 0.02; why.push('müüja viited kiirele müügile'); }
  neg = Math.min(neg, 0.14);
  return { neg, lo: Math.max(0.02, neg - 0.03), hi: neg + 0.03, why };
}

// ===================== FINANTSEERIMINE =====================
function loan(price, rate) {
  const L = price * P.ltv, i = rate / 12, n = P.years * 12;
  const m = (L * i) / (1 - Math.pow(1 + i, -n));
  let bal = L, interest = 0;
  for (let k = 0; k < 12; k++) { const it = bal * i; interest += it; bal -= m - it; }
  return { L, pay: m * 12, interest, monthlyInterest: (L * rate) / 12 };
}
const kuOf = (x) => P.kuPerM2 * x.area; // kuus (hinnang)

// ===================== STRATEEGIAD =====================
function prep(x) {
  const reg = region(x); const ex = extras(x); const ng = negotiation(x);
  const bid = Math.round(x.price * (1 - ng.neg));
  return { reg, ex, ng, bid, premium: reg.pp + 0.5 * ex.length };
}

function ltModel(x, pr, rent, reno) {
  const gross = rent * (12 - pr.reg.vac);
  const ku = kuOf(x) * 12, reserve = P.reserve * pr.bid, tax = P.incomeTax * gross;
  const noi = gross - ku - reserve - P.insurance - tax;
  const invest = pr.bid * (1 + P.buyCosts) + reno;
  const ln = loan(pr.bid, P.rate);
  const equity = (1 - P.ltv) * pr.bid + pr.bid * P.buyCosts + reno;
  return { gross, ku, reserve, tax, noi, invest, equity, netY: noi / invest, coc: (noi - ln.pay) / equity, withPrincipal: (noi - ln.interest) / equity, debt: ln.pay };
}

function stArea(x) {
  const d = x.district;
  if (x.city === 'Tallinn') {
    if (/Kesklinn|Südalinn|Kassisaba|Vanalinn|Uus Maailm|Kadriorg/i.test(d)) return 'Kesklinn';
    return TALLINN_D.test(d) ? d : null;
  }
  if (x.city === 'Tartu') return /Annelinn|Karlova|Supilinn|Tammelinn|Ropka|Variku|Veeriku|Vaksali|Raadi|Jaamamõisa|Kesklinn|Ülejõe|Ihaste|Tartu$/i.test(x.district) ? 'Tartu' : null;
  if (x.city === 'Pärnu') return /Kesklinn|Rannarajoon|Ülejõe|^Mai$|Rääma|Port Artur|Papsaare|Sauga|Vana-Pärnu|^Pärnu$/i.test(x.district) ? 'Pärnu' : null; // Ahaste, Audru, Lavassaare jt külad välja
  return null;
}
const sizeMult = (m2) => (m2 < 28 ? 0.8 : m2 < 40 ? 1.0 : m2 < 55 ? 1.35 : 1.7);
function stModel(x, pr, reno, adrMult = 1) {
  const a = stArea(x); const b = a && booking[a];
  if (!b) return null;
  const adrY = (0.42 * b.talv + 0.33 * b.kevad + 0.25 * b.suvi) * sizeMult(x.area) * P.adrRealized * adrMult;
  const occ = a === 'Kesklinn' || a === 'Tartu' || a === 'Pärnu' ? P.occ.centre : P.occ.other;
  const rev = adrY * 365 * occ;
  const util = (x.area < 30 ? 120 : x.area <= 45 ? 150 : 180) * 12;
  const costs = rev * (P.platform + P.mgmt) + util + kuOf(x) * 12 + P.reserve * pr.bid + P.insurance;
  const noi = rev - costs;
  const invest = pr.bid * (1 + P.buyCosts) + reno + P.furnish;
  const ln = loan(pr.bid, P.rate);
  const equity = (1 - P.ltv) * pr.bid + pr.bid * P.buyCosts + reno + P.furnish;
  return { area: a, adr: adrY, occ, rev, noi, afterPayout: noi * 0.78, invest, equity, netY: noi / invest, coc: (noi - ln.pay) / equity, debt: ln.pay, n: b.n || 0 };
}

function renoRate(x) { return x.cond === 'N' ? P.reno.full : x.cond === 'M' ? P.reno.mid : P.reno.cosm; }
function flipModel(x, pr, arvPerM2, months = P.flipMonths, rateOverride) {
  const rr = renoRate(x);
  const reno = rr * x.area * P.renoMult; const reserve = reno * P.renoReserve;
  const arv = arvPerM2 * x.area * (1 - P.saleDiscount) * P.saleMult;
  const ln = loan(pr.bid, rateOverride || P.rate);
  const hold = ln.monthlyInterest * months + kuOf(x) * months + P.holdUtil * months;
  const buy = pr.bid * P.buyCosts;
  const sellC = arv * P.sellCosts;
  const profit = arv - sellC - pr.bid - buy - reno - reserve - hold;
  const tax = Math.max(0, profit) * P.incomeTax;
  const net = profit - tax;
  const outlay = pr.bid + buy + reno + reserve + hold;
  const equity = (1 - P.ltv) * pr.bid + buy + reno + reserve + hold;
  const adj = net * (1 - 0.05 * pr.premium);
  return { reno, reserve, arv, sellC, hold, buy, profit, tax, net, adj, outlay, equity, roe: net / equity, annual: (net / equity) * (12 / months), pct: net / outlay, annualUnlev: (net / outlay) * (12 / months), months, renoCls: x.cond === 'N' ? 'täisremont' : x.cond === 'M' ? 'keskmine' : 'kosmeetiline' };
}
function directModel(x, pr, mv, months = P.directMonths) {
  const sell = mv * x.area * (1 - P.saleDiscount) * P.saleMult;
  const ln = loan(pr.bid, P.rate);
  const hold = ln.monthlyInterest * months + kuOf(x) * months + P.holdUtil * months;
  const buy = pr.bid * P.buyCosts, sellC = sell * P.sellCosts;
  const profit = sell - sellC - pr.bid - buy - hold;
  const tax = Math.max(0, profit) * P.incomeTax; const net = profit - tax;
  const outlay = pr.bid + buy + hold; const equity = (1 - P.ltv) * pr.bid + buy + hold;
  return { sell, sellC, hold, buy, profit, net, adj: net * (1 - 0.05 * pr.premium), outlay, equity, roe: net / equity, annual: (net / equity) * (12 / months), annualUnlev: (net / outlay) * (12 / months), months };
}

// ===================== KOGU ARVUTUS =====================
function evaluate(list = clean) {
  const out = { lt: [], st: [], flip: [], direct: [] };
  for (const x of list) {
    if (x.price > P.maxPrice || x.price < P.minPrice) continue;
    const pr = prep(x);
    const rc = rentComps(x);
    const mvSame = saleComps(x, [x.cond]);
    const mvReno = saleComps(x, ['R', 'P']);
    const base = { id: x.id, url: x.url, address: x.address, city: x.city, district: x.district, area: x.area, rooms: x.rooms, ask: x.price, bid: pr.bid, neg: pr.ng, cond: x.cond, details: x.details, title: x.title, note: x.note, ageDays: ageDays(x), reg: pr.reg.label, premium: pr.premium, extras: pr.ex, perM2: Math.round(x.price / x.area), mvPerM2: mvSame && mvSame.perM2, mvN: mvSame ? mvSame.n : 0 };
    // pikaajaline üür
    if (rc && rc.perM2 && rc.n >= 3) {
      const rent = rc.perM2 * x.area * P.rentMult;
      const reno = x.cond === 'N' ? P.reno.cosm * x.area * P.renoMult : 0;
      const m = ltModel(x, pr, rent, reno);
      out.lt.push({ ...base, rent, rentPerM2: rc.perM2, rentN: rc.n, rentLevel: rc.level, rentGrade: grade(rc.n, rc.level, x.village), m, reno, riskAdj: m.netY - pr.premium / 100, conf: grade(rc.n, rc.level, x.village), strategy: 'lt' });
    }
    // lühiajaline üür
    {
      const reno = x.cond === 'N' ? P.reno.cosm * x.area * P.renoMult : 0;
      const m = stModel(x, pr, reno);
      if (m) out.st.push({ ...base, m, reno, riskAdj: m.netY - pr.premium / 100, conf: m.n >= 10 ? 'kõrge' : m.n >= 5 ? 'keskmine' : 'madal', village: x.village, strategy: 'st' });
    }
    // flip
    if ((x.cond === 'N' || x.cond === 'M') && mvReno && mvReno.perM2 && mvReno.n >= 3) {
      const m = flipModel(x, pr, mvReno.perM2);
      const ok = m.net >= P.flipMinProfit && m.pct >= P.flipMinPct && m.arv / (x.price) <= 2.2;
      out.flip.push({ ...base, m, ok, arvPerM2: mvReno.perM2, arvN: mvReno.n, arvLevel: mvReno.level, conf: grade(mvReno.n, mvReno.level, x.village), strategy: 'flip', riskAdj: m.adj });
    }
    // otse edasimüük
    if (mvSame && mvSame.perM2 && mvSame.n >= 3) {
      const mvPrice = mvSame.perM2 * x.area;
      const disc = 1 - pr.bid / mvPrice;
      const m = directModel(x, pr, mvSame.perM2);
      out.direct.push({ ...base, m, mvPrice, disc, discAsk: 1 - x.price / mvPrice, ok: disc >= P.directMinDisc && disc <= 0.5, tooGood: disc > 0.5, mvLevel: mvSame.level, conf: grade(mvSame.n, mvSame.level, x.village), strategy: 'direct', riskAdj: m.adj, mvN: mvSame.n });
    }
  }
  return out;
}
const rankLT = (a) => [...a].sort((x, y) => y.riskAdj - x.riskAdj);
const rankFlip = (a) => a.filter((x) => x.ok).sort((x, y) => y.riskAdj - x.riskAdj);
const rankDirect = (a) => a.filter((x) => x.ok).sort((x, y) => y.riskAdj - x.riskAdj);
// madala usaldusväärsusega (<5 võrdlust) objekte top 3 hulka ei võta, kui leidub paremaid (võrdlusbaas peab olema vähemalt 5)
const confOK = (x) => gradeRank[x.conf] >= 1;

// ===================== MEGA DIIL =====================
const URGENT = /kiire|pakkumised?|pärand|kolin|välismaale|kiirmüük|lepime\s+hinnas|uus\s+hind|hind\s+(alandatud|langes)/i;
function megaDeals(ev) {
  const res = [];
  const fresh = (x) => x.ageDays <= 30; // ainult värsked kuulutused: igapäevane teavitus
  for (const x of ev.lt) if (fresh(x) && x.conf === 'kõrge' && x.riskAdj >= P.megaLT) res.push({ x, strategy: 'Pikaajaline üür', main: `risk. korr. netotootlus ${(x.riskAdj * 100).toFixed(1)}%`, key: x.riskAdj });
  for (const x of ev.st) if (fresh(x) && x.conf === 'kõrge' && x.riskAdj >= P.megaST) res.push({ x, strategy: 'Lühiajaline üür', main: `risk. korr. netotootlus ${(x.riskAdj * 100).toFixed(1)}%`, key: x.riskAdj });
  for (const x of ev.flip) if (fresh(x) && x.ok && confOK(x) && x.m.net >= P.megaFlipProfit && x.m.pct >= P.megaFlipPct) res.push({ x, strategy: 'Flip', main: `puhaskasum ${Math.round(x.m.net).toLocaleString('et-EE')} €`, key: x.m.net / 100000 });
  for (const x of ev.direct) if (fresh(x) && x.ok && x.conf === 'kõrge' && x.disc >= P.megaDirectDisc && URGENT.test(`${x.title} ${x.note}`)) res.push({ x, strategy: 'Otse edasimüük', main: `${(x.disc * 100).toFixed(0)}% alla turuväärtuse, puhaskasum ${Math.round(x.m.net).toLocaleString('et-EE')} €`, key: x.disc });
  return res.sort((a, b) => b.key - a.key);
}

module.exports = { P, BASE, geo, URGENT, stArea, rawSale, rawRent, saleAll, FLAGS, region, extras, loan, ageDays, clean, excluded, saleAll, rentAll, booking, evaluate, megaDeals, rankLT, rankFlip, rankDirect, confOK, prep, ltModel, stModel, flipModel, directModel, saleComps, rentComps, region, loan, fmt: null };

// ===================== CLI =====================
if (require.main === module) {
  const ev = evaluate();
  const mega = megaDeals(ev);
  console.log(`müük (toor) ${rawSale.length}, unikaalne ${saleAll.length}, pärast puhastust ${clean.length}, välja ${excluded.length}; üür ${rentAll.length}; hind <=${P.maxPrice}: LT ${ev.lt.length}, ST ${ev.st.length}, flip ${ev.flip.length} (ok ${rankFlip(ev.flip).length}), edasimüük ${ev.direct.length} (ok ${rankDirect(ev.direct).length}); mega ${mega.length}`);
  const top = (arr, f) => arr.filter(confOK).slice(0, 3).forEach((x, i) => console.log(`  ${i + 1}) ${f(x)} | ${x.address.split(',').slice(0, 3).join(',')} | ${x.ask}€ (pakkumine ${x.bid}) ${x.area}m² | ${x.conf} | ${x.url}`));
  console.log('LT'); top(rankLT(ev.lt), (x) => `netoY ${(x.m.netY * 100).toFixed(1)}% risk ${(x.riskAdj * 100).toFixed(1)}%`);
  console.log('ST'); top(rankLT(ev.st), (x) => `netoY ${(x.m.netY * 100).toFixed(1)}% risk ${(x.riskAdj * 100).toFixed(1)}% ADR ${Math.round(x.m.adr)}`);
  console.log('FLIP'); top(rankFlip(ev.flip), (x) => `neto ${Math.round(x.m.net)}€ ${(x.m.pct * 100).toFixed(0)}% risk ${Math.round(x.adj || x.m.adj)}€`);
  console.log('DIRECT'); top(rankDirect(ev.direct), (x) => `alla turu ${(x.disc * 100).toFixed(0)}% neto ${Math.round(x.m.net)}€`);
  console.log('MEGA:', mega.slice(0, 5).map((m) => `${m.strategy}: ${m.x.address.split(',').slice(0, 2).join(',')} ${m.main}`));
}
