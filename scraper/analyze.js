// Kraabib kv.ee, hindab üüritootlust ja leiab uued "selgelt head diilid".
// Kasutus: node scraper/analyze.js [--max-pages N]   (N piirab lehti testimiseks)
const fs = require('fs');
const path = require('path');
const { scrape } = require('./kv');

const CFG = {
  priceMax: 80000,
  minArea: 30,
  minGross: 0.09, // "selge diil": brutotootlus
  minDiscount: 0.10, // ... ja hind €/m² vähemalt 10% alla piirkonna mediaani
  watchGross: 0.07,
  netFactor: 0.85, // reserv halduskuludele, tühjalt seismisele
  saleCompCap: 150000, // võrdlusturg: müük kuni selle hinnani
  minComps: 4,
  minPrice: 3000, // alla selle on tavaliselt andmeviga ('hind kokkuleppel')
  minPerM2: 150,
  maxGross: 0.25, // üle selle on peaaegu kindlasti viga või erandlik objekt -> käsitsi kontroll
  stoveRe: /ahi-?k[üu]t|ahjuk[üu]t|ahjuk[üu]te|ahjud?\b|puuk[üu]te|puuk[üu]tte|kaminak[üu]t|puuahi|ahjuga|ahi\b/i,
};

const DATA = path.join(__dirname, '..', 'data');
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const maxPages = +(arg('--max-pages') || 60);

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const bucket = (m2) => (m2 < 35 ? 'S' : m2 < 50 ? 'M' : 'L');

function loc(address) {
  const parts = address.split(',').map((x) => x.trim()).filter(Boolean);
  const county = parts[parts.length - 1] || '';
  const city = parts.length >= 3 ? parts[parts.length - 2] : county;
  return { city, county };
}
const enrich = (l) => ({ ...l, ...loc(l.address) });

function estimate(items, getVal, l, minN) {
  // ahel: linn+suurus -> linn -> maakond
  const tries = [
    [items.filter((x) => x.city === l.city && bucket(x.area) === bucket(l.area)), 'linn+suurus'],
    [items.filter((x) => x.city === l.city), 'linn'],
    [items.filter((x) => x.county === l.county), 'maakond'],
  ];
  for (const [arr, level] of tries) if (arr.length >= minN) return { value: median(arr.map(getVal)), n: arr.length, level };
  return null;
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  const sale = (await scrape({ dealType: 1, priceMax: CFG.saleCompCap, maxPages })).map(enrich).filter((x) => x.price > 0 && x.area > 0);
  const rent = (await scrape({ dealType: 2, maxPages })).map(enrich).filter((x) => x.price > 50 && x.area > 0 && x.price < 5000);
  rent.forEach((x) => (x.perM2 = x.price / x.area));
  sale.forEach((x) => (x.perM2 = x.price / x.area));
  fs.writeFileSync(path.join(DATA, 'kv_sale.json'), JSON.stringify(sale));
  fs.writeFileSync(path.join(DATA, 'kv_rent.json'), JSON.stringify(rent));

  const scored = [];
  for (const l of sale) {
    if (l.price > CFG.priceMax || l.area < CFG.minArea) continue;
    const text = `${l.details} ${l.title} ${l.note}`;
    if (CFG.stoveRe.test(text)) continue;
    if (l.price < CFG.minPrice || l.perM2 < CFG.minPerM2) continue;
    const r = estimate(rent, (x) => x.perM2, l, CFG.minComps);
    const m = estimate(sale, (x) => x.perM2, l, CFG.minComps + 2);
    if (!r) continue;
    const rentEst = r.value * l.area;
    const gross = (rentEst * 12) / l.price;
    const net = gross * CFG.netFactor;
    const discount = m ? 1 - l.perM2 / m.value : null;
    scored.push({
      id: l.id, url: l.url, address: l.address, rooms: l.rooms, area: l.area, price: l.price,
      perM2: Math.round(l.perM2), marketPerM2: m ? Math.round(m.value) : null, marketN: m ? m.n : 0,
      discount: discount === null ? null : +discount.toFixed(3),
      rentEst: Math.round(rentEst), rentN: r.n, rentLevel: r.level, suspicious: gross > CFG.maxGross,
      gross: +gross.toFixed(3), net: +net.toFixed(3), details: l.details,
    });
  }
  scored.sort((a, b) => b.gross - a.gross);
  const strong = scored.filter((x) => x.gross >= CFG.minGross && x.discount !== null && x.discount >= CFG.minDiscount && x.rentLevel !== 'maakond' && !x.suspicious);
  const watch = scored.filter((x) => x.gross >= CFG.watchGross && !strong.includes(x) && !x.suspicious);

  const statePath = path.join(DATA, 'notified.json');
  const notified = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
  const fresh = strong.filter((x) => !notified[x.id]);
  const today = new Date().toISOString().slice(0, 10);
  fresh.forEach((x) => (notified[x.id] = today));
  fs.writeFileSync(statePath, JSON.stringify(notified, null, 1));
  fs.writeFileSync(path.join(DATA, 'report.json'), JSON.stringify({ date: today, counts: { sale: sale.length, rent: rent.length, scored: scored.length, strong: strong.length, watch: watch.length, fresh: fresh.length }, fresh, strong, watch: watch.slice(0, 30) }, null, 1));

  console.log(`müük ${sale.length}, üür ${rent.length}, hinnatud ${scored.length}, selged ${strong.length}, jälgitavad ${watch.length}, UUED ${fresh.length}`);
  fresh.slice(0, 10).forEach((x) => console.log(`${(x.gross * 100).toFixed(1)}% | ${x.price}€ ${x.area}m² | -${(x.discount * 100).toFixed(0)}% | üür~${x.rentEst}€ (n=${x.rentN},${x.rentLevel}) | ${x.address} | ${x.url}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
