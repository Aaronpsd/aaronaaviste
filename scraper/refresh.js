// Värskendab kuulutuste andmed (kv.ee): kogu Eesti müük kuni 150 000 €, kõik üürikuulutused, Harjumaa müük kuni 300 000 €.
// Kasutus: node scraper/refresh.js   (võtab ~40-60 min)
const fs = require('fs');
const path = require('path');
const { scrape } = require('./kv');
const D = path.join(__dirname, '..', 'data');
(async () => {
  fs.mkdirSync(D, { recursive: true });
  const sale = await scrape({ dealType: 1, priceMax: 150000, maxPages: 90 });
  fs.writeFileSync(path.join(D, 'kv_sale.json'), JSON.stringify(sale));
  const rent = await scrape({ dealType: 2, maxPages: 80 });
  fs.writeFileSync(path.join(D, 'kv_rent.json'), JSON.stringify(rent));
  const harju = await scrape({ dealType: 1, county: 1, priceMax: 300000, maxPages: 130 });
  fs.writeFileSync(path.join(D, 'kv_sale_harju.json'), JSON.stringify(harju));
  console.log('valmis: müük', sale.length, 'üür', rent.length, 'Harjumaa', harju.length);
})();
