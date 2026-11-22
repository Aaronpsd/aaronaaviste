// Parim pikaajaline üüritootlus (riskivaba järjestus). node scraper/ltbest.js
const T = require('./top3');
const { P } = T;
const e = (v) => Math.round(v).toLocaleString('et-EE') + ' €';
const p = (v) => (v * 100).toFixed(1) + '%';
const rows = [];
for (const x of T.clean) {
  if (x.price > 100000 || x.price < 6000) continue;
  const rc = T.rentComps(x);
  if (!rc || !rc.perM2 || rc.n < 5 || rc.level === 'maakond') continue; // vähemalt 5 kohalikku üürivõrdlust
  if (x.village && rc.level !== 'asum') continue; // küla: ainult kohalikud üürivõrdlused
  const pr = T.prep(x);
  const rent = rc.perM2 * x.area;
  rows.push({ x, pr, rc, rent });
}
function calc(r, price, reno, loanAmt) {
  const x = r.x;
  const pr = { ...r.pr, bid: price };
  const m = T.ltModel(x, pr, r.rent, reno);
  const grossRent = r.rent * 12; // bruto, tühjade kuude ja kuludeta
  const invest = price * (1 + P.buyCosts) + reno;
  const ln = loanAmt ? T.loan(loanAmt / 0.7, P.rate) : null; // loan() eeldab 70% LTV: skaleerime nii, et laen = loanAmt
  let pay = 0, interest = 0;
  if (loanAmt > 0) { const i = P.rate / 12, n = 360; const mm = (loanAmt * i) / (1 - Math.pow(1 + i, -n)); pay = mm * 12; let bal = loanAmt; for (let k = 0; k < 12; k++) { const it = bal * i; interest += it; bal -= mm - it; } }
  const equity = invest - loanAmt;
  return { gross: grossRent / invest, net: m.noi / invest, noi: m.noi, invest, equity, coc: equity > 0 ? (m.noi - pay) / equity : null, withPrincipal: equity > 0 ? (m.noi - interest) / equity : null, pay };
}
const show = (title, arr, f) => { console.log('\n=== ' + title); arr.slice(0, 10).forEach((o, i) => console.log(`${i + 1}) ${f(o)} | ${o.r.x.address.split(',').slice(0, 3).join(',')} | ${o.r.x.area}m² ${o.r.x.cond} | üür ~${Math.round(o.r.rent)}€ (n${o.r.rc.n},${o.r.rc.level}) | ${o.r.x.url}`)); };
// Stsenaarium A: ost <= 12 000 €, remont 5 000 €, omaraha (laenuta)
const A = rows.filter((r) => r.x.price <= 12000).map((r) => ({ r, m: calc(r, r.x.price, 5000, 0) })).sort((a, b) => b.m.net - a.m.net);
show('A: ost <=12 000 € + remont 5 000 € (omaraha)', A, (o) => `ost ${o.r.x.price}€ → investeering ${e(o.m.invest)} | bruto ${p(o.m.gross)} neto ${p(o.m.net)} NOI ${e(o.m.noi)}`);
// Stsenaarium B: ost <= 80 000 € laenuga (100% LTV), remont 20 000 € omaraha
const B = rows.filter((r) => r.x.price <= 80000 && r.x.price >= 40000).map((r) => ({ r, m: calc(r, r.x.price, 20000, Math.min(r.x.price, 80000)) })).sort((a, b) => b.m.net - a.m.net);
show('B: ost 40-80 000 € (100% laen, kuni 80 000 €) + remont 20 000 € omaraha', B, (o) => `ost ${o.r.x.price}€ → investeering ${e(o.m.invest)} | bruto ${p(o.m.gross)} neto ${p(o.m.net)} NOI ${e(o.m.noi)} omakapital ${e(o.m.equity)} CoC ${p(o.m.coc)}`);
// Üldine: ilma remondita (nagu on) ja remondiga vastavalt seisukorrale; järjestus bruto ja neto järgi
const G = rows.map((r) => ({ r, m: calc(r, r.x.price, r.x.cond === 'N' ? 5000 : 0, 0) })).filter((o) => o.r.x.price >= 6000);
show('ÜLDINE parim NETO (kõik hinnaklassid <=100 000 €, remont 5 000 € kui vajab remonti)', [...G].sort((a, b) => b.m.net - a.m.net), (o) => `ost ${o.r.x.price}€ | bruto ${p(o.m.gross)} neto ${p(o.m.net)} NOI ${e(o.m.noi)}`);
show('ÜLDINE parim BRUTO', [...G].sort((a, b) => b.m.gross - a.m.gross), (o) => `ost ${o.r.x.price}€ | bruto ${p(o.m.gross)} neto ${p(o.m.net)} NOI ${e(o.m.noi)}`);
// Parim netoNOI absoluutselt hinnaklassis 40-100 000 €
const C = G.filter((o) => o.r.x.price >= 40000).sort((a, b) => b.m.net - a.m.net);
show('Hinnaklass 40-100 000 €: parim NETO', C, (o) => `ost ${o.r.x.price}€ | bruto ${p(o.m.gross)} neto ${p(o.m.net)} NOI ${e(o.m.noi)}`);
