// Kraabib Harjumaa (sh Tallinn) kõik müügikorterid kuni 300 000 € flipi ARV-võrdluseks -> data/kv_sale_harju.json
const fs = require('fs');
const path = require('path');
const { scrape } = require('./kv');
const cityOf = (a) => { const p = a.split(',').map((s) => s.trim()).filter(Boolean); return p.length >= 3 ? p[p.length - 2] : p[p.length - 1]; };
(async () => {
  const items = await scrape({ dealType: 1, county: 1, priceMax: 300000, maxPages: 130 });
  const out = items.map((x) => ({ ...x, county: (x.address.split(',').pop() || '').trim(), city: cityOf(x.address) })).filter((x) => x.price > 0 && x.area > 0);
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'kv_sale_harju.json'), JSON.stringify(out));
  console.log('valmis', out.length);
})();
