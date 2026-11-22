// Koostab top-N lõpliku nimekirja (koos üürivõrdlustega) data/top10final.json. Kasutus: node scraper/final10.js [--top 10] [--exclude "Ahaste tee 5,|Sääse 8,"]
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const topN = +arg('--top', 10);
const excl = new RegExp(arg('--exclude', '^$'));
const t = JSON.parse(fs.readFileSync(path.join(D, 'target10.json'), 'utf8'));
const rent = JSON.parse(fs.readFileSync(path.join(D, 'kv_rent.json'), 'utf8'));
const sale = JSON.parse(fs.readFileSync(path.join(D, 'kv_sale.json'), 'utf8'));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const W = { yield: 0.30, cheap: 0.25, discount: 0.17, demand: 0.17, conf: 0.11 };
const clamp = (v, a = 0, b = 10) => Math.max(a, Math.min(b, v));
function score(r, price) {
  const cost = price + r.reno; const netY = (r.rentEst * 12 * 0.85) / cost; const disc = 1 - price / r.area / r.marketPerM2;
  const sc = { ...r.sc, yield: clamp(((netY - 0.04) / 0.12) * 10), cheap: clamp(10 * (1 - (cost - 15000) / 65000)), discount: clamp((disc / 0.5) * 10) };
  if (r.flags.some((x) => x.startsWith('küla'))) sc.discount = Math.min(sc.discount, 4);
  return Object.keys(W).reduce((s, k) => s + sc[k] * W[k], 0);
}
const rows = [...t].sort((a, b) => b.scoreNow - a.scoreNow)
  .filter((x) => !excl.test(x.address))
  .filter((x) => !x.flags.some((f) => f.startsWith('küla'))) // küla/ääreala võrdlus ülehindab
  .slice(0, topN);
const out = rows.map((x, i) => {
  const parts = x.address.split(',').map((s) => s.trim()); const c = parts[parts.length - 2];
  const pool = rent.filter((y) => y.city === c);
  const near = [...pool].sort((a, b) => Math.abs(a.area - x.area) - Math.abs(b.area - x.area)).slice(0, 3);
  const l = sale.find((y) => y.id === x.id);
  return { i: i + 1, ...x, title: l && l.title, note: l && l.note, max70: score(x, Math.round(x.price * 0.3)), max50: score(x, Math.round(x.price * 0.5)),
    rentMin: Math.min(...pool.map((y) => y.price)), rentMax: Math.max(...pool.map((y) => y.price)), rentMed: Math.round(med(pool.map((y) => y.price))), rentCount: pool.length,
    near: near.map((y) => ({ p: y.price, a: y.area, r: y.rooms, addr: y.address.split(',').slice(0, 2).join(','), u: y.url })) };
});
fs.writeFileSync(path.join(D, 'top10final.json'), JSON.stringify(out, null, 1));
out.forEach((o) => console.log(`${o.i} ${o.scoreNow.toFixed(1)} ${o.address.split(',').slice(0, 3).join(',')} | ${o.price}€ ${o.area}m² | üür${o.rentEst} (n${o.rentCount}, ${o.rentMin}-${o.rentMax}, med ${o.rentMed}) | p7 ${o.price7} p8 ${o.price8} p9 ${o.price9} | max@-50% ${o.max50.toFixed(1)} @-70% ${o.max70.toFixed(1)} | ${o.cond} ${o.reno} | age ${o.ageDays}d | ${o.details}`));
