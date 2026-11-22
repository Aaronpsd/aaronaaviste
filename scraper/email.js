// Koostab e-kirja teksti data/report.json põhjal. Prindib stdout'i; tühi väljund = pole mida saata.
const fs = require('fs');
const path = require('path');
const r = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'report.json'), 'utf8'));
if (!r.fresh.length) process.exit(0);
const pct = (x) => (x * 100).toFixed(1) + '%';
const lines = [`Teema: ${r.fresh.length} uus üürikorter hea hinnaga (${r.date})`, ''];
const sections = [['Muu Eesti', r.fresh.filter((x) => x.region !== 'Ida-Virumaa')], ['Ida-Virumaa (kõrgem tootlus, kõrgem risk: likviidsus, üürnike usaldusväärsus)', r.fresh.filter((x) => x.region === 'Ida-Virumaa')]];
for (const [title, arr] of sections) {
  if (!arr.length) continue;
  lines.push(`== ${title} ==`, '');
  for (const x of arr) {
  lines.push(
    `${x.address}`,
    `  Hind ${x.price.toLocaleString('et-EE')} € · ${x.area} m² · ${x.rooms ?? '?'} tuba · ${x.perM2} €/m² (turg ${x.marketPerM2 ?? '?'} €/m², ${x.discount !== null ? '-' + Math.round(x.discount * 100) + '%' : '?'})`,
    `  Hinnanguline üür ~${x.rentEst} €/kuus (${x.rentN} võrdlust, ${x.rentLevel}) · brutotootlus ${pct(x.gross)} · neto ~${pct(x.net)}`,
    `  ${x.details}`,
    `  ${x.url}`,
    '',
  );
  }
}
lines.push('Märkus: üür on hinnang samas piirkonnas ja suurusklassis olevate üürikuulutuste mediaanist. Kontrolli seisukorda, remonti ja korteriühistu andmeid enne otsust.');
console.log(lines.join('\n'));
