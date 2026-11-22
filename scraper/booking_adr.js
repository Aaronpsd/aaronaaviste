// Töötleb Booking.com otsingutulemused (booking_all2.json) piirkonna ja hooaja öö-hinna mediaaniteks -> data/booking_adr.json
// Kasutus: node scraper/booking_adr.js <sisendfail.json>
const fs = require('fs');
const path = require('path');
const input = process.argv[2];
const d = JSON.parse(fs.readFileSync(input, 'utf8'));
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const rows = d.map((x) => {
  const m = /€\s*([\d,]+)/.exec(x.pr);
  const bed = /(\d)\s*bedroom/.exec(x.unit);
  return { area: x.area, season: x.season, name: x.name, adr: m ? +m[1].replace(',', '') : null, bed: bed ? +bed[1] : /Studio/i.test(x.unit) ? 0 : null, entire: /Entire apartment/.test(x.unit) };
}).filter((x) => x.adr && x.adr >= 25 && x.adr <= 220 && x.entire && (x.bed === 0 || x.bed === 1));
const out = {};
for (const a of new Set(rows.map((x) => x.area))) {
  out[a] = { n: new Set(rows.filter((x) => x.area === a).map((x) => x.name)).size };
  for (const s of ['talv', 'kevad', 'suvi']) {
    const uniq = new Map();
    rows.filter((x) => x.area === a && x.season === s).forEach((x) => uniq.set(x.name, x.adr));
    out[a][s] = med([...uniq.values()]);
  }
  out[a].collected = new Date().toISOString().slice(0, 10);
}
// puuduvad hooajad täida olemasolevatest (keskmine)
for (const a of Object.keys(out)) {
  const vals = ['talv', 'kevad', 'suvi'].map((s) => out[a][s]).filter(Boolean);
  if (!vals.length) { delete out[a]; continue; }
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  for (const s of ['talv', 'kevad', 'suvi']) if (!out[a][s]) out[a][s] = Math.round(avg);
}
fs.writeFileSync(path.join(__dirname, '..', 'data', 'booking_adr.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
