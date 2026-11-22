// Iga korteri jaoks: hind, mille juures hindepunktid tootlus/odavus/allahindlus = 10, ja realistlik kaubeldav hind.
// Eeldab data/score10.json (node scraper/score10.js --top N).
const fs = require('fs');
const path = require('path');
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'score10.json'), 'utf8'));
const W = { yield: 0.25, effort: 0.2, cheap: 0.15, discount: 0.15, demand: 0.15, conf: 0.1 };
const clamp = (v, a = 0, b = 10) => Math.max(a, Math.min(b, v));
const MARKET = (r) => r.marketPerM2 * r.area; // turu mediaan selle suuruse kohta

function score(r, price) {
  const cost = price + r.reno;
  const netY = (r.rentEst * 12 * 0.85) / cost;
  const disc = 1 - price / r.area / r.marketPerM2;
  const sc = { ...r.sc, yield: clamp(((netY - 0.04) / 0.12) * 10), cheap: clamp(10 * (1 - (cost - 15000) / 65000)), discount: clamp((disc / 0.5) * 10) };
  if (r.flags.some((f) => f.startsWith('küla'))) sc.discount = Math.min(sc.discount, 4);
  return Object.keys(W).reduce((s, k) => s + sc[k] * W[k], 0);
}

// hind, mille juures kolm hinnast sõltuvat osa on 10 (või ei saa enam paremaks)
function targetPrice(r) {
  const byYield = (r.rentEst * 12 * 0.85) / 0.16 - r.reno; // neto 16%
  const byCheap = 15000 - r.reno; // kogusumma 15 000 €
  const byDisc = 0.5 * r.marketPerM2 * r.area; // 50% alla turu
  // 10/10 hind = karmim kolmest, aga mitte alla 35% praegusest hinnast (nii madalat hinda ei aktsepteeri keegi)
  const raw = Math.min(byYield, byCheap, byDisc);
  return { raw, byYield, byCheap, byDisc };
}

function haggleRoom(r) {
  let room = 0.06; // tavaline kaubeldav varu
  if (r.ageDays > 180) room += 0.04;
  if (r.ageDays > 360) room += 0.04;
  if (r.flags.includes('seisukord teadmata') || r.cond === 'vajab remonti') room += 0.03;
  if (r.rentListings < 20) room += 0.02; // õhuke turg: müüjal vähe valikut
  return Math.min(room, 0.18);
}

// madalaim kaubeldav hind, mille juures koondskoor jõuab sihini (nt 7,0); null = hinnaga ei saavutatav
function priceFor(r, goal) {
  const lo = Math.round(r.price * 0.3);
  if (score(r, lo) < goal) return null;
  let a = lo, b = r.price;
  if (score(r, b) >= goal) return b;
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (score(r, m) >= goal) a = m; else b = m; }
  return Math.round(a / 100) * 100;
}

const out = rows.map((r) => {
  const t = targetPrice(r);
  const price10 = Math.max(Math.round(t.raw / 500) * 500, Math.round(r.price * 0.35 / 500) * 500);
  const needDisc = 1 - price10 / r.price;
  const room = haggleRoom(r);
  const realistic = Math.round((r.price * (1 - room)) / 100) * 100;
  return {
    ...r, t, price10, needDisc, room, realistic,
    scoreNow: r.total, scoreAtReal: score(r, realistic), scoreAt10: score(r, price10),
    price7: priceFor(r, 7.0),
    price65: priceFor(r, 6.5),
  };
});
// järjestus: parim skoor realistliku hinna juures
out.sort((a, b) => b.scoreAtReal - a.scoreAtReal);
fs.writeFileSync(path.join(__dirname, '..', 'data', 'target10.json'), JSON.stringify(out, null, 1));
out.forEach((r, i) => console.log(`${String(i + 1).padStart(2)} praegu ${r.scoreNow.toFixed(1)} → realistlik ${r.scoreAtReal.toFixed(1)} (${r.realistic}€, -${Math.round(r.room * 100)}%) | 10/10-hind ${r.price10}€ (-${Math.round(r.needDisc * 100)}%) skoor ${r.scoreAt10.toFixed(1)} | ask ${r.price}€ | ${r.address.split(',').slice(0, 2).join(',').slice(0, 36)} | vaev ${r.sc.effort} nõud ${r.sc.demand.toFixed(0)} usald ${r.sc.conf.toFixed(0)}`));
