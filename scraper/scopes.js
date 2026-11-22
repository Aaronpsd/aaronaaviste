// Parimad diilid piirkonna/strateegia lõikes (kasutatakse käsitsi valikuks). node scraper/scopes.js
const T = require('./top3');
const ev = T.evaluate();
const ok = (x) => ['keskmine', 'kõrge'].includes(x.conf) && x.ask >= 15000;
const all = [];
const sc = (x, kind) => (kind === 'lt' || kind === 'st') ? x.riskAdj : (x.m.annualUnlev - x.premium / 100);
for (const k of ['lt', 'st']) ev[k].filter(ok).forEach((x) => all.push({ k, x, score: sc(x, k), main: `netoY ${(x.m.netY * 100).toFixed(1)}% risk ${(x.riskAdj * 100).toFixed(1)}% CoC ${(x.m.coc * 100).toFixed(1)}%` }));
ev.flip.filter((x) => x.ok && ok(x)).forEach((x) => all.push({ k: 'flip', x, score: sc(x, 'flip'), main: `puhaskasum ${Math.round(x.m.net)}€ (${(x.m.pct * 100).toFixed(0)}%) ARV ${Math.round(x.m.arv)}` }));
ev.direct.filter((x) => x.ok && ok(x)).forEach((x) => all.push({ k: 'direct', x, score: sc(x, 'direct'), main: `alla turu ${(x.disc * 100).toFixed(0)}% puhaskasum ${Math.round(x.m.net)}€` }));
const scope = {
  'EESTI ÜÜR (LT+ST)': (a) => a.k === 'lt' || a.k === 'st',
  'EESTI KÕIK': () => true,
  'HARJUMAA (sh Tallinn)': (a) => /Harjumaa/.test(a.x.county || '') || a.x.city === 'Tallinn' || /Harju|Maardu|Saue|Saku|Rae|Viimsi|Keila|Kiili|Paldiski|Loksa|Kehra|Kuusalu|Anija|Raasiku|Jõelähtme/.test(a.x.city),
  'HARJUMAA (ilma Tallinnata)': (a) => a.x.city !== 'Tallinn' && /Harju|Maardu|Saue|Saku|Rae|Viimsi|Keila|Kiili|Paldiski|Loksa|Kehra|Kuusalu|Anija|Raasiku|Jõelähtme|Haiba|Turba|Laagri|Tabasalu|Jüri|Peetri|Lagedi/.test(`${a.x.city} ${a.x.district}`),
  'TALLINN': (a) => a.x.city === 'Tallinn',
};
for (const [name, f] of Object.entries(scope)) {
  console.log('\n=== ' + name);
  all.filter(f).sort((a, b) => b.score - a.score).slice(0, 8).forEach((a, i) => console.log(`${i + 1}) [${a.k}] sk ${(a.score * 100).toFixed(1)} | ${a.main} | ${a.x.ask}€ (bid ${a.x.bid}) ${a.x.area}m² ${a.x.cond} | ${a.x.address.split(',').slice(0, 3).join(',')} | ${a.x.conf} | vanus ${a.x.ageDays}p | ${a.x.url}`));
}
