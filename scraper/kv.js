// kv.ee kraapija: korterite müük (deal_type=1) ja üür (deal_type=2)
const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parsePage() {
  // töötab brauseri kontekstis
  const num = (s) => {
    const m = (s || '').replace(/ /g, ' ').replace(/[^\d,.]/g, ' ').trim().split(/\s+/).join('');
    return m ? parseFloat(m.replace(',', '.')) : null;
  };
  return [...document.querySelectorAll('article.object-type-apartment')].map((e) => {
    const priceEl = e.querySelector('.price');
    const priceText = priceEl ? priceEl.childNodes[0]?.textContent || '' : '';
    const excerpts = [...e.querySelectorAll('.object-excerpt')].map((x) => x.innerText.trim());
    const sm = e.querySelector('.price small');
    return {
      id: e.dataset.objectId,
      url: 'https://www.kv.ee' + (e.dataset.objectUrl || ''),
      address: ((e.querySelector('strong') || {}).parentElement || {}).innerText?.replace(/\s+/g, ' ').trim() || '',
      details: excerpts[0] || '',
      title: excerpts[1] || '',
      note: (e.querySelector('.object-important-note') || {}).innerText || '',
      rooms: num((e.querySelector('.rooms') || {}).innerText),
      area: num((e.querySelector('.area') || {}).innerText),
      price: num(priceText),
      eurM2: sm ? num(sm.innerText) : null,
    };
  });
}

async function scrape({ dealType, priceMax, maxPages = 60, delayMs = 1500, log = console.log }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'et-EE', userAgent: UA });
  const page = await ctx.newPage();
  const seen = new Map();
  let failStreak = 0;
  for (let p = 1; p <= maxPages; p++) {
    const base = dealType === 1 ? '/korterid-muuk' : '/korterid-uur';
    const params = [];
    if (priceMax) params.push(`price_max=${priceMax}`);
    if (p > 1) params.push(`start=${(p - 1) * 50}`);
    const url = `https://www.kv.ee${base}${params.length ? '?' + params.join('&') : ''}`;
    let items = [];
    let ok = false;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForSelector('article.object-type-apartment', { timeout: 15000 });
        items = await page.evaluate(parsePage);
        ok = true;
        break;
      } catch (e) {
        if (attempt === 4) log(`  leht ${p}: ${e.message.split('\n')[0]}`);
        await sleep(2000 * attempt);
      }
    }
    const before = seen.size;
    items.forEach((i) => i.id && seen.set(i.id, i));
    log(`kv.ee dealType=${dealType} leht ${p}: ${items.length} kuulutust, uusi ${seen.size - before}`);
    if (!ok) {
      if (++failStreak >= 3) { log('  3 viga järjest, lõpetan'); break; }
      continue; // jäta leht vahele, proovi järgmist
    }
    failStreak = 0;
    if (!items.length || seen.size === before) break; // lõpp või sama leht uuesti
    await sleep(delayMs);
  }
  await browser.close();
  return [...seen.values()];
}

module.exports = { scrape };

if (require.main === module) {
  const [dealType = '1', maxPages = '2', priceMax = ''] = process.argv.slice(2);
  scrape({ dealType: +dealType, maxPages: +maxPages, priceMax: priceMax || undefined }).then((r) => {
    console.log(r.length, 'kuulutust');
    console.log(JSON.stringify(r.slice(0, 3), null, 1));
  });
}
