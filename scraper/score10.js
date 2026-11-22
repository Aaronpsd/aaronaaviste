// 10/10 hindamissüsteem. Eeldab, et analyze.js --reuse --nation --exclude-county Ida-Virumaa on jooksnud (data/top_Eesti.json).
// Kasutus: node scraper/score10.js [--top 30]
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');
const sale = JSON.parse(fs.readFileSync(path.join(D, 'kv_sale.json'), 'utf8'));
const rent = JSON.parse(fs.readFileSync(path.join(D, 'kv_rent.json'), 'utf8'));
const cand = JSON.parse(fs.readFileSync(path.join(D, 'top_Eesti.json'), 'utf8'));
const topN = +(process.argv[process.argv.indexOf('--top') + 1] || 30);

const W = { yield: 0.25, effort: 0.2, cheap: 0.15, discount: 0.15, demand: 0.15, conf: 0.1 };
const clamp = (v, a = 0, b = 10) => Math.max(a, Math.min(b, v));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const cityOf = (a) => { const p = a.split(',').map((s) => s.trim()); return p.length >= 3 ? p[p.length - 2] : p[p.length - 1]; };

// vaev: seisukord tekstist -> remondihinnang ja skoor
function condition(text) {
  const t = text.toLowerCase();
  if (/vajab\s+(san\.?\s*)?(remon|reno|uuenda)|remonti\s+vajav|täielikku remonti|halvas/.test(t)) return { score: 2, reno: 10000, label: 'vajab remonti' };
  if (/renoveeritud|uus\s+(köök|torustik|remont)|uuendatud|heas\s+(korras|seisukorras)|valmis\s+(kolimiseks|sisse)|kapitaalselt|san\.?\s*remont\s+tehtud|uusehitus|uus\s+(torustik|elektrisüsteem)|\buus\s*,/.test(t)) return { score: 9, reno: 0, label: 'heas korras' };
  if (/keskmises\s+seisukorras|korras/.test(t)) return { score: 6, reno: 4000, label: 'keskmine' };
  return { score: 5, reno: 5000, label: 'seisukord teadmata' };
}

// linna turuaktiivsus (üür-/müügikuulutuste arv)
const stat = {};
for (const x of sale) (stat[x.city] = stat[x.city] || { s: 0, r: 0 }).s++;
for (const x of rent) (stat[x.city] = stat[x.city] || { s: 0, r: 0 }).r++;

const DISTRICT = /kesklinn|linnaosa|ülejõe|^mai$|rannarajoon|annelinn|karlova|supilinn|tammelinn|ropka|variku|veeriku|vaksali|raadi|jaamamõisa|kvissental|kristiine|lasnamäe|mustamäe|nõmme|pirita|haabersti|põhja-tallinn|männimäe|port artur|rääma|pärnamäe|sauga|papsaare|uus-sauga|vana-pärnu|kitseküla|kadriorg|pelgulinn|merivälja|rocca|maardu|asum|elamurajoon/i;
const stem = (x) => x.replace(/\s+(linn|vald|alev|alevik|küla)$/i, '').toLowerCase();
const isVillage = (a) => {
  const p = a.split(',').map((x) => x.trim());
  if (p.length < 4) return false;
  const loc = p[1];
  if (/\blinn$/i.test(loc) || DISTRICT.test(loc)) return false; // linn või linnaosa
  return stem(loc) !== stem(p[p.length - 2]);
};
const maxId = Math.max(...sale.map((x) => +x.id));
const rows = [];
for (const c of cand) {
  const city = cityOf(c.address);
  const pool = rent.filter((r) => r.city === city);
  if (pool.length < 5) continue;
  const near = [...pool].sort((a, b) => Math.abs(a.area - c.area) - Math.abs(b.area - c.area)).slice(0, 5);
  const rentNear = med(near.map((r) => r.price));
  const spread = (Math.max(...near.map((r) => r.price)) - Math.min(...near.map((r) => r.price))) / rentNear;
  const rentEst = Math.min(rentNear, c.rentEst); // konservatiivne: väiksem kahest meetodist
  const cond = condition(c.details);
  const cost = c.price + cond.reno;
  const netY = (rentEst * 12 * 0.85) / cost;
  const grossY = (rentEst * 12) / c.price;
  const st = stat[city] || { s: 1, r: 0 };
  const ratio = st.s / Math.max(st.r, 1);
  const ageDays = Math.round((maxId - +c.id) / 500);
  const sc = {
    yield: clamp(((netY - 0.04) / 0.12) * 10),
    effort: cond.score,
    cheap: clamp(10 * (1 - (cost - 15000) / 65000)),
    discount: clamp((c.discount / 0.5) * 10),
    demand: clamp(0.5 * Math.min(10, st.r / 12) + 0.5 * clamp(10 - 2 * ratio)),
    conf: clamp(0.5 * Math.min(10, c.rentN / 3) + 0.5 * clamp(10 - spread * 10)),
  };
  // karistus: ei luba kõrget skoori, kui võrdlus on liiga õhuke või kuulutus kahtlane
  const flags = [];
  if (/enampakkumi|kohtutäitur/i.test(`${c.title} ${c.details}`)) flags.push('enampakkumine');
  if (c.rentN < 8) flags.push('õhuke üürivõrdlus');
  if (ageDays > 300) flags.push(`üleval ~${Math.round(ageDays / 30)} kuud`);
  if (st.r < 10) flags.push('väike üürituru maht');
  const village = isVillage(c.address);
  if (village) flags.push('küla/ääreala (linna võrdlus ülehindab)');
  if (cond.label === 'seisukord teadmata') flags.push('seisukord teadmata');
  if (village) { sc.conf = Math.min(sc.conf, 3); sc.demand = Math.min(sc.demand, 3); sc.discount = Math.min(sc.discount, 4); }
  if (grossY < 0.07) continue; // sinu miinimum: bruto 7%
  const total = Object.keys(W).reduce((s, k) => s + sc[k] * W[k], 0);
  rows.push({ ...c, city, rentEst: Math.round(rentEst), rentOld: c.rentEst, rentNear: Math.round(rentNear), cond: cond.label, reno: cond.reno, cost, grossY, netY, ratio, rentListings: st.r, saleListings: st.s, ageDays, sc, total, flags });
}
rows.sort((a, b) => b.total - a.total);
fs.writeFileSync(path.join(D, 'score10.json'), JSON.stringify(rows.slice(0, topN), null, 1));
console.log(`hinnatud ${rows.length}, top ${topN}`);
rows.slice(0, topN).forEach((r, i) => console.log(`${String(i + 1).padStart(2)} ${r.total.toFixed(1)} | y${r.sc.yield.toFixed(0)} e${r.sc.effort} c${r.sc.cheap.toFixed(0)} d${r.sc.discount.toFixed(0)} n${r.sc.demand.toFixed(0)} k${r.sc.conf.toFixed(0)} | ${r.price}€ ${r.area}m² üür${r.rentEst} (vana ${r.rentOld}) bruto${(r.grossY * 100).toFixed(1)} neto${(r.netY * 100).toFixed(1)} | ${r.cond} | ${r.address.split(',').slice(0, 3).join(',').slice(0, 42)} | ${r.flags.join(';')}`));
