// Täisraport ja mega diili e-kiri.
// Kasutus: node scraper/report.js --report | --daily | --mark-sent
const fs = require('fs');
const path = require('path');
const T = require('./top3');
const { P, BASE } = T;
const D = path.join(__dirname, '..', 'data');
const SENT = path.join(D, 'saadetud_diilid.csv');

const eur = (v) => Math.round(v).toLocaleString('et-EE') + ' €';
const pct = (v, d = 1) => (v * 100).toFixed(d).replace('.', ',') + '%';
const short = (a) => a.split(',').slice(0, 3).join(',').trim();
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const gradeRank = { madal: 0, keskmine: 1, kõrge: 2 };
const confOK = (x) => gradeRank[x.conf] >= 1;

// ---------- tööriistad ----------
function withP(mods, fn) {
  const saved = {};
  for (const k of Object.keys(mods)) saved[k] = typeof P[k] === 'object' ? { ...P[k] } : P[k];
  Object.assign(P, mods);
  try { return fn(); } finally { Object.assign(P, saved); }
}
const evalAll = () => T.evaluate();
const top3Of = (ev) => ({
  lt: T.rankLT(ev.lt).filter(confOK).slice(0, 3),
  st: T.rankLT(ev.st).filter(confOK).slice(0, 3),
  flip: T.rankFlip(ev.flip).filter(confOK).slice(0, 3),
  direct: T.rankDirect(ev.direct).filter(confOK).slice(0, 3),
});
const ids = (a) => a.map((x) => x.id).join(',');

// max pakkumine
function binSearch(lo, hi, okFn) { // suurim hind vahemikus, mille juures okFn on tõene (hinna kasvades muutub ok vääraks)
  if (!okFn(lo)) return null;
  if (okFn(hi)) return hi;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (okFn(m)) lo = m; else hi = m; }
  return Math.round(lo / 100) * 100;
}
const raw = (x) => ({ ...T.saleAll.find((y) => y.id === x.id) });
const prAt = (x, bid) => { const l = raw(x); const p = T.prep(l); return { ...p, bid }; };

function maxBidLT(x, req = 0.06) {
  const l = raw(x);
  return binSearch(Math.round(x.ask * 0.4), x.ask, (b) => { const pr = prAt(x, b); const m = ltAt(l, pr, x.rent, x.reno); return m.netY - pr.premium / 100 >= req; });
}
function ltAt(l, pr, rent, reno) { return T.ltModel(l, pr, rent, reno); }
function maxBidST(x, req = 0.08) {
  const l = raw(x);
  return binSearch(Math.round(x.ask * 0.4), x.ask, (b) => { const pr = prAt(x, b); const m = T.stModel(l, pr, x.reno); return m && m.netY - pr.premium / 100 >= req; });
}
function maxBidFlip(x) {
  const l = raw(x);
  return binSearch(Math.round(x.ask * 0.4), x.ask, (b) => { const pr = prAt(x, b); const m = T.flipModel(l, pr, x.arvPerM2); return m.net >= P.flipMinProfit && m.pct >= P.flipMinPct; });
}
function maxBidDirect(x) {
  const mvPrice = x.mvPrice;
  return Math.round((mvPrice * (1 - P.directMinDisc)) / 100) * 100;
}

// ---------- tekstiplokid ----------
function neg(x) { return `${pct(x.neg.lo, 0)}–${pct(x.neg.hi, 0)} alla küsitud (arvutuses ${pct(x.neg.neg, 0)}${x.neg.why.length ? '; põhjus: ' + x.neg.why.join(', ') : ''})`; }
function rangeStr(x) { return `${eur(x.ask * (1 - x.neg.hi))}–${eur(x.ask * (1 - x.neg.lo))}`; }
function rowOf(rank, x, main, extra) {
  return `${rank} | ${short(x.address)} | ${eur(x.ask)} | ${rangeStr(x)} | ${x.area} m² | ${eur(x.perM2)}/m² vs ${x.mvPerM2 ? Math.round(x.mvPerM2) + ' €/m² mediaan (' + (x.mvN || 0) + ' võrd.)' : 'võrdlusi pole'} | ${main} | ${pct(x.riskAdj !== undefined && x.strategy !== 'flip' && x.strategy !== 'direct' ? x.riskAdj : 0)} | ${extra} | ${x.conf} | ${x.url}`;
}
function flagsOf(x) {
  const f = [];
  if (x.extras.length) f.push(`riskilisad: ${x.extras.join(', ')}`);
  f.push(`piirkond: ${x.reg} (riskipreemia ${x.premium.toFixed(1)} pp)`);
  if (x.cond === 'N') f.push('kuulutuse järgi vajab remonti');
  if (x.ageDays > 180) f.push(`üleval ~${x.ageDays} päeva`);
  return f;
}
const percentileText = (rank, n) => `kandidaatide hulgas ${rank}. kohal ${n}-st (top ${((rank / n) * 100).toFixed(1).replace('.', ',')}%)`;

function ltBlock(x, i, list) {
  const m = x.m, n = list.length;
  const fourth = list[3];
  const med4 = med(list.map((y) => y.riskAdj));
  const lines = [];
  lines.push(`${i}. ${short(x.address)} (${x.url})`);
  lines.push(`   Miks: turuüür ${eur(x.rent)}/kuus (${x.rentN} võrdlust, ${x.rentLevel}-tasand, ${x.rentPerM2 ? x.rentPerM2.toFixed(1).replace('.', ',') : '?'} €/m²); ostuhind ${eur(x.bid)} (küsitud ${eur(x.ask)}), netotootlus ${pct(m.netY)}, riskiga korrigeeritud ${pct(x.riskAdj)}.`);
  lines.push(`   Võrdlus: ${percentileText(i, n)}; ${fourth ? `${((x.riskAdj - fourth.riskAdj) * 100).toFixed(1).replace('.', ',')} pp parem 4. kohast` : ''}; strateegia kandidaatide mediaan ${pct(med4)}.`);
  lines.push(`   Arvutus: brutoüür ${eur(m.gross)} (${12 - T.region({ city: x.city, county: x.reg === 'Ida-Virumaa' ? 'Ida-Virumaa' : '', district: x.district }).vac} kuud) − KÜ ${eur(m.ku)} (hinnang ${P.kuPerM2} €/m²/kuus) − remondireserv ${eur(m.reserve)} − kindlustus ${eur(P.insurance)} − tulumaks 22% ${eur(m.tax)} = NOI ${eur(m.noi)}; investeering ${eur(m.invest)} (ost + 1,5% ostukulud${x.reno ? ' + kerge remont ' + eur(x.reno) : ''}).`);
  lines.push(`   Omakapital ${eur(m.equity)}; laenumaksed ${eur(m.debt)}/a; rahavoog ${eur(m.noi - m.debt)}/a; omakapitali tootlus (cash-on-cash) ${pct(m.coc)}; koos põhiosa tagasimaksega ${pct(m.withPrincipal)}.`);
  lines.push(`   Läbirääkimine: ${neg(x)}. Pakkumisvahemik ${rangeStr(x)}.`);
  lines.push(`   Riskid/kontroll: ${flagsOf(x).join('; ')}. Küsi KÜ majandusaasta aruanne, remondifondi seis, võlad/laenud, üürilepingud, kütteviis.`);
  const mb = maxBidLT(x); lines.push(`   Maksimaalne hind (riskiga korrigeeritud netotootlus ≥ 6% — minu lävend): ${mb ? eur(mb) : 'ükskõik, tootlus on kõrgem isegi küsitud hinnaga'}.`);
  return lines.join('\n');
}
function stBlock(x, i, list, ltMap) {
  const m = x.m, n = list.length, fourth = list[3];
  const lt = ltMap.get(x.id);
  const lines = [];
  lines.push(`${i}. ${short(x.address)} (${x.url})`);
  lines.push(`   Miks: ${m.area} ööhind ~${eur(m.adr)} (Booking.com valim, ${m.n} kuulutust; suuruse korrektsioon ja ×0,9 realiseerimine), täituvus ${pct(m.occ, 0)} (hinnang${x.m.area === 'Pärnu' ? '; Pärnu 45% hooajalisuse tõttu' : ''}) → käive ${eur(m.rev)}; netotulu ${eur(m.noi)}; netotootlus ${pct(m.netY)}, riskiga korrigeeritud ${pct(x.riskAdj)}.`);
  lines.push(`   Võrdlus: ${percentileText(i, n)}; ${fourth ? `${((x.riskAdj - fourth.riskAdj) * 100).toFixed(1).replace('.', ',')} pp parem 4. kohast` : ''}; kandidaatide mediaan ${pct(med(list.map((y) => y.riskAdj)))}.`);
  lines.push(`   Arvutus: käive ${eur(m.rev)} − platvorm 15% ${eur(m.rev * P.platform)} − haldus 22% ${eur(m.rev * P.mgmt)} − kommunaalid ${eur((x.area < 30 ? 120 : x.area <= 45 ? 150 : 180) * 12)} − KÜ ${eur(T.stModel ? x.area * P.kuPerM2 * 12 : 0)} − remondireserv ${eur(P.reserve * x.bid)} − kindlustus ${eur(P.insurance)} = ${eur(m.noi)}. Investeering ${eur(m.invest)} (ost ${eur(x.bid)} + ostukulud + sisustus ${eur(P.furnish)}${x.reno ? ' + remont ' + eur(x.reno) : ''}).`);
  lines.push(`   OÜ-s kasum ${eur(m.noi)} (jaotamata kasumilt maksu pole); väljamakse järel (22/78) jääb ${eur(m.afterPayout)}. Omakapitali tootlus ${pct(m.coc)}.`);
  if (lt) lines.push(`   Võrreldes pikaajalise üüriga (sama objekt): pikaajaline NOI ${eur(lt.m.noi)} (isiku maksu järel) vs lühiajaline ${eur(m.afterPayout)} (väljamakse järel): lisatulu ${eur(m.afterPayout - lt.m.noi)}/a (${(m.afterPayout - lt.m.noi) > 0 ? 'kaalub üles' : 'ei kaalu üles'} lisatöö ja riski; KÜ põhikiri võib lühiajalist üüri keelata).`);
  lines.push(`   Läbirääkimine: ${neg(x)}. Pakkumisvahemik ${rangeStr(x)}.`);
  lines.push(`   Riskid/kontroll: ${flagsOf(x).join('; ')}. Ööhind ja täituvus on hinnang; kontrolli KÜ põhikirja ja üldkoosoleku otsuseid lühiajalise üüri kohta, majutuse registreerimist ja makse.`);
  const mb = maxBidST(x); lines.push(`   Maksimaalne hind (riskiga korrigeeritud netotootlus ≥ 8% — minu lävend): ${mb ? eur(mb) : 'ükskõik'}.`);
  return lines.join('\n');
}
function flipBlock(x, i, list) {
  const m = x.m, n = list.length, fourth = list[3];
  const lines = [];
  lines.push(`${i}. ${short(x.address)} (${x.url})`);
  lines.push(`   Miks: ARV ${eur(m.arv)} (renoveeritud/heas korras mediaan ${Math.round(x.arvPerM2)} €/m², ${x.arvN} võrdlust, ${x.arvLevel}-tasand, −4% tehinguhinna allahindlus); ostuhind ${eur(x.bid)}; remont ${eur(m.reno)} (${m.renoCls}, ${x.area} m²); puhaskasum ${eur(m.net)} (${pct(m.pct, 0)} kogukuludest); riskiga korrigeeritud ${eur(m.adj)}.`);
  lines.push(`   Võrdlus: ${percentileText(i, n)}; ${fourth ? `${eur(m.adj - (fourth.m.adj))} rohkem kui 4. koht; ` : ''}kandidaatide (kõik tingimused täitvad) mediaan ${eur(med(list.map((y) => y.m.adj)))}.`);
  lines.push(`   Arvutus: ARV ${eur(m.arv)} − müügikulud 3,5% ${eur(m.sellC)} − ost ${eur(x.bid)} − ostukulud ${eur(m.buy)} − remont ${eur(m.reno)} − reserv 12% ${eur(m.reserve)} − hoidmine 6 kuud ${eur(m.hold)} = ${eur(m.profit)}; maks 22% ${eur(m.tax)}; puhaskasum ${eur(m.net)}.`);
  lines.push(`   Omakapital ${eur(m.equity)}; tootlus omakapitalile ${pct(m.roe)} (6 kuuga), aastane ${pct(m.annual)}.${x.bid + m.reno > P.flipCostWarn ? ' MÄRGE: ost + remont ületab 140 000 €.' : ''}`);
  lines.push(`   Läbirääkimine: ${neg(x)}. Pakkumisvahemik ${rangeStr(x)}.`);
  lines.push(`   Riskid/kontroll: ${flagsOf(x).join('; ')}. Remondi aste on määratud kuulutuse seisukorra välja ja kirjelduse järgi (pilte ei analüüsinud): kontrolli kohapeal ja küsi 2-3 remondipakkumist; ARV põhineb küsitud hindadel.`);
  const mb = maxBidFlip(x); lines.push(`   Maksimaalne hind (puhaskasum ≥ 12 000 € ja ≥ 15% kogukuludest): ${mb ? eur(mb) : 'tingimus ei täitu'}.`);
  return lines.join('\n');
}
function directBlock(x, i, list) {
  const m = x.m, n = list.length, fourth = list[3];
  const lines = [];
  lines.push(`${i}. ${short(x.address)} (${x.url})`);
  lines.push(`   Miks: turuväärtus ${eur(x.mvPrice)} (${Math.round(x.mvPerM2)} €/m² mediaan, ${x.mvN} võrdlust, ${x.mvLevel}-tasand, sama seisukord); ostuhind ${eur(x.bid)} = ${pct(x.disc, 0)} alla turuväärtuse (küsitud hinnaga ${pct(x.discAsk, 0)}); puhaskasum ${eur(m.net)}; riskiga korrigeeritud ${eur(m.adj)}.`);
  lines.push(`   Võrdlus: ${percentileText(i, n)}; ${fourth ? `${eur(m.adj - fourth.m.adj)} rohkem kui 4. koht; ` : ''}kandidaatide mediaan ${eur(med(list.map((y) => y.m.adj)))}.`);
  lines.push(`   Arvutus: müük ${eur(m.sell)} (turuväärtus −4%) − müügikulud 3,5% ${eur(m.sellC)} − ost ${eur(x.bid)} − ostukulud ${eur(m.buy)} − hoidmine ${P.directMonths} kuud ${eur(m.hold)} = ${eur(m.sell - m.sellC - x.bid - m.buy - m.hold)}; maks 22%; puhaskasum ${eur(m.net)}. Omakapital ${eur(m.equity)}, aastane tootlus ${pct(m.annual, 0)}.`);
  lines.push(`   Miks hind on madal? Kuulutuses ei ole selget põhjust. Võimalikud: ${x.ageDays > 120 ? 'pikalt müügil (' + x.ageDays + ' päeva) — ostjad ei nõustu hinnaga; ' : ''}${/kiire|pärand|kolin|pakkumised/i.test(`${x.title} ${x.note}`) ? 'müüja viited kiirele müügile; ' : ''}seisukord (${x.cond === 'N' ? 'vajab remonti' : x.cond === 'M' ? 'teadmata/keskmine' : 'heas korras'}), asukoht/korrus/lift, KÜ probleemid, kuulutuse viga. Küsi müüjalt otse.`);
  lines.push(`   Riskid/kontroll: ${flagsOf(x).join('; ')}. Turuväärtus põhineb küsitud hindadel; kontrolli Maa-ameti tehinguandmetega.`);
  lines.push(`   Maksimaalne hind (≥ 20% alla turuväärtuse): ${eur(maxBidDirect(x))}.`);
  return lines.join('\n');
}

// ---------- raport ----------
function buildReport() {
  const ev = evalAll();
  const top = top3Of(ev);
  const ltMap = new Map(ev.lt.map((x) => [x.id, x]));
  const mega = T.megaDeals(ev);
  const out = [];
  const H = (t) => out.push('\n' + t + '\n' + '='.repeat(Math.min(t.length, 70)));
  const rawCount = T.rawSale.length;
  const unique = T.saleAll.length;
  const underCap = T.clean.filter((x) => x.price <= P.maxPrice).length;
  const missingYear = T.clean.filter((x) => !x.year).length;
  out.push('KINNISVARA INVESTEERIMISANALÜÜS: TOP 3 STRATEEGIA KOHTA (' + new Date().toISOString().slice(0, 10) + ')');
  H('1. ANDMED JA EELDUSED');
  out.push(`Allikas: kv.ee (kraapimine ${new Date().toISOString().slice(0, 10)}). Müügikuulutusi toorelt ${rawCount} (kogu Eesti kuni 150 000 € + Harjumaa kuni 300 000 €), unikaalseid ${unique}, pärast puhastust ${T.clean.length}, välja jäetud ${T.excluded.length} (tavapärane korteriomand puudub: kaasomand, üürnikuga, enampakkumine, sokkel, uusarendus, ostjapoolsed kuulutused, vigased andmed jm). Hinnafiltriga ≤ ${eur(P.maxPrice)} jäi ${underCap} objekti. Üürikuulutusi ${T.rawRent.length}.`);
  out.push(`Strateegiate kandidaadid (≤ 100 000 €): pikaajaline üür ${ev.lt.length}, lühiajaline üür ${ev.st.length} (ainult Tallinn, Tartu ja Pärnu keskus, kus on Booking.com võrdlused), flip ${ev.flip.length} (neist tingimused täidavad ${T.rankFlip(ev.flip).length}), otse edasimüük ${ev.direct.length} (neist ≥ 20% alla turu ${T.rankDirect(ev.direct).length}).`);
  out.push('Andmete kvaliteet ja muudatused parameetrites (oluline):');
  out.push(`- Failis EI OLE lühiajalise üüri andmeid; võtsin öö-hinnad Booking.com avalikest otsingutulemustest (22.11.2026, 10 piirkonda, ~3-27 kuulutust piirkonnas, valim on Bookingu populaarsuse järgi). Täituvuse mõõdetud andmeid ei ole: kasutasin 55% (Tallinna kesklinn, Tartu), 45% (Pärnu, tugev hooajalisus) ja 50% (muud Tallinna linnaosad) hinnangut. Tulemused lühiajalise üüri kohta on seetõttu väga hinnangulised.`);
  out.push(`- Kuulutustes EI OLE KÜ haldustasu ega energiaklassi: KÜ kulu arvestan hinnanguga ${P.kuPerM2} €/m²/kuus; energiaklassi lisa (+0,5 pp) ma ei saanud rakendada.`);
  out.push(`- Hinnalangetuste ajalugu ei ole: päevad turul hindan kuulutuse ID järgi (~500 uut ID-d päevas; ligikaudne), hinnalangetusi tuvastan ainult teksti järgi ("uus hind").`);
  out.push(`- Seisukorra klassi määran kuulutuse seisukorra välja ja kirjelduse järgi; pilte ei analüüsinud. Ehitusaasta puudub ${missingYear} kuulutusel (${(missingYear / T.clean.length * 100).toFixed(0)}%).`);
  out.push(`- Võrdlusbaas koosneb küsitud hindadest ja küsitud üüridest, mitte tehinguhindadest. Maakonnatasandi ja küla võrdlusi märgin usaldusväärsuseks "madal"; madala usaldusväärsusega objekte top 3 hulka ei võta.`);
  out.push(`- Täiendav filter (minu lisa, mitte prompti parameeter): alla 15 000 € objekte (nt 6 000 € Kohtla-Järve korterid, mille aastane NOI on alla 1 000 €) edetabelisse ei võta: need on ebalikviidsed ja tehingukulud/riskid söövad tulu.`);
  out.push(`- Otse edasimüügi puhul loen objekti kahtlaseks (ja jätan välja), kui allahindlus turuväärtusest on üle 50%: see on peaaegu alati võrdlusbaasi viga või objekti probleem.`);
  out.push(`- Ida-Virumaa ja väikelinnade odavkorterid (6-15 000 €) annavad paberil kõrge tootluse, aga likviidsus ja üürnike maksekäitumine on kehvad; riskipreemia 3 pp ei pruugi seda täielikult katta.`);

  H('2. STRATEEGIAD');
  const head = '# | Objekt | Küsitud hind | Pakkumisvahemik | m² | €/m² vs piirkonna mediaan | Netotootlus | Riskiga korrigeeritud | Omakapitali tootlus | Usaldusväärsus | Link';
  // LT
  out.push('\n2.1 PIKAAJALINE ÜÜR');
  out.push(head);
  top.lt.forEach((x, i) => out.push(`${i + 1} | ${short(x.address)} | ${eur(x.ask)} | ${rangeStr(x)} | ${x.area} | ${eur(x.perM2)}/m² vs ${x.mvPerM2 ? Math.round(x.mvPerM2) + ' (' + x.mvN + ' võrd.)' : '—'} | ${pct(x.m.netY)} | ${pct(x.riskAdj)} | ${pct(x.m.coc)} | ${x.conf} | ${x.url}`));
  const ltList = T.rankLT(ev.lt).filter(confOK);
  out.push('');
  top.lt.forEach((x, i) => out.push(ltBlock(x, i + 1, ltList) + '\n'));
  // ST
  out.push('\n2.2 LÜHIAJALINE ÜÜR (Airbnb/Booking)');
  out.push(head);
  top.st.forEach((x, i) => out.push(`${i + 1} | ${short(x.address)} | ${eur(x.ask)} | ${rangeStr(x)} | ${x.area} | ${eur(x.perM2)}/m² vs ${x.mvPerM2 ? Math.round(x.mvPerM2) + ' (' + x.mvN + ' võrd.)' : '—'} | ${pct(x.m.netY)} | ${pct(x.riskAdj)} | ${pct(x.m.coc)} | ${x.conf} | ${x.url}`));
  const stList = T.rankLT(ev.st).filter(confOK);
  out.push('');
  top.st.forEach((x, i) => out.push(stBlock(x, i + 1, stList, ltMap) + '\n'));
  // FLIP
  out.push('\n2.3 FLIP');
  const flipList = T.rankFlip(ev.flip).filter(confOK);
  out.push(`Tingimused (puhaskasum ≥ 12 000 € ja ≥ 15% kogukuludest) täitvaid objekte: ${T.rankFlip(ev.flip).length}${flipList.length < 3 ? ` (neist usaldusväärsusega vähemalt "keskmine": ${flipList.length}). Kohti ei täida ma nõrkade objektidega.` : '.'}`);
  out.push(head);
  top.flip.forEach((x, i) => out.push(`${i + 1} | ${short(x.address)} | ${eur(x.ask)} | ${rangeStr(x)} | ${x.area} | ${eur(x.perM2)}/m² vs ${Math.round(x.arvPerM2)} ARV | puhaskasum ${eur(x.m.net)} (${pct(x.m.pct, 0)}) | risk. korr. ${eur(x.m.adj)} | ROE aastas ${pct(x.m.annual, 0)} | ${x.conf} | ${x.url}`));
  out.push('');
  top.flip.forEach((x, i) => out.push(flipBlock(x, i + 1, flipList) + '\n'));
  // DIRECT
  out.push('\n2.4 OTSE EDASIMÜÜK');
  const dirList = T.rankDirect(ev.direct).filter(confOK);
  out.push(`Tingimuse (ostuhind ≥ 20% alla turuväärtuse, mitte üle 50%) täitvaid objekte: ${T.rankDirect(ev.direct).length}, neist usaldusväärsusega vähemalt "keskmine": ${dirList.length}.`);
  out.push(head);
  top.direct.forEach((x, i) => out.push(`${i + 1} | ${short(x.address)} | ${eur(x.ask)} | ${rangeStr(x)} | ${x.area} | ${eur(x.perM2)}/m² vs ${Math.round(x.mvPerM2)} (${x.mvN} võrd.) | puhaskasum ${eur(x.m.net)} (${pct(x.disc, 0)} alla turu) | risk. korr. ${eur(x.m.adj)} | ROE aastas ${pct(x.m.annual, 0)} | ${x.conf} | ${x.url}`));
  out.push('');
  top.direct.forEach((x, i) => out.push(directBlock(x, i + 1, dirList) + '\n'));

  // 3. PARIM TEHING
  H('3. PARIM TEHING ÜLDSE');
  const cands = [];
  top.lt.forEach((x) => cands.push({ x, s: 'Pikaajaline üür', score: x.riskAdj, txt: `risk. korr. netotootlus ${pct(x.riskAdj)} aastas` }));
  top.st.forEach((x) => cands.push({ x, s: 'Lühiajaline üür', score: x.riskAdj, txt: `risk. korr. netotootlus ${pct(x.riskAdj)} aastas` }));
  top.flip.forEach((x) => cands.push({ x, s: 'Flip', score: (x.m.annualUnlev) - x.premium / 100, txt: `puhaskasum ${eur(x.m.net)}, aastane tootlus kogukuludelt ${pct(x.m.annualUnlev, 0)}` }));
  top.direct.forEach((x) => cands.push({ x, s: 'Otse edasimüük', score: (x.m.annualUnlev) - x.premium / 100, txt: `puhaskasum ${eur(x.m.net)}, aastane tootlus ${pct(x.m.annualUnlev, 0)}` }));
  cands.sort((a, b) => b.score - a.score);
  // eelistame objekte, kus absoluutne kasum/tulu on tähenduslik: liiga väikese kogusummaga objektid (<15 000 €) saavad märke
  const best = cands.find((c) => c.x.ask >= 15000) || cands[0];
  if (best) {
    const x = best.x;
    out.push(`Parim: ${short(x.address)} — ${best.s} (${x.url}). Põhinäitaja: ${best.txt}. Küsitud ${eur(x.ask)}, pakkumisvahemik ${rangeStr(x)}, arvutustes ${eur(x.bid)}.`);
    out.push('Miks see võidab iga teise strateegia parima kandidaadi (võrdlus riskiga korrigeeritud aastase tootluse alusel):');
    cands.slice(0, 6).forEach((c) => out.push(`   - ${c.s}: ${short(c.x.address)} — ${c.txt}; risk. korr. aastane võrdlusnäitaja ${pct(c.score, 1)}`));
    out.push('Pakkumise ja finantseerimise plaan:');
    const ln = T.loan(x.bid, P.rate);
    out.push(`   - Pakkumine: alusta ${eur(x.ask * (1 - x.neg.hi))}, sihtlepe ~${eur(x.bid)}, ülempiir ${eur(x.ask * (1 - x.neg.lo))}.`);
    out.push(`   - Finantseerimine: pangalaen 70% = ${eur(ln.L)}, intress 4,5%, 30 a annuiteet → ${eur(ln.pay / 12)}/kuus; omaosalus 30% ${eur(0.3 * x.bid)} + ostukulud 1,5% ${eur(0.015 * x.bid)}.`);
    if (x.m && x.m.reno !== undefined && x.strategy === 'flip') out.push(`   - Remondi ulatus: ${x.m.renoCls} (${eur(x.m.reno)} + 12% reserv), eesmärk müük 6 kuuga hinnaga ~${eur(x.m.arv)}.`);
    else if (x.reno) out.push(`   - Remont: kerge, ${eur(x.reno)}.`);
    out.push(`   - Väljumine: ${best.s === 'Flip' ? 'müük pärast remonti (6 kuud)' : best.s === 'Otse edasimüük' ? 'edasimüük 2-3 kuuga hinnaga ~' + eur(x.m.sell) : 'hoia ja üüri; müük hiljem turuhinnaga, või refinantseeri'}.`);
    // kombineeritud
    if (best.s === 'Flip' || best.s === 'Otse edasimüük') {
      const l = raw(x); const pr = prAt(x, x.bid);
      const rc = T.rentComps(l);
      if (rc && rc.perM2) {
        const renoCost = (x.m.reno || 0) * (1 + (best.s === 'Flip' ? P.renoReserve : 0));
        const m = T.ltModel(l, pr, rc.perM2 * l.area, renoCost);
        out.push(`   - Kombineeritud strateegia (osta${x.m.reno ? ', renoveeri' : ''} ja anna pikaajaliselt üürile): turuüür ${eur(rc.perM2 * l.area)}/kuus, NOI ${eur(m.noi)}, netotootlus ${pct(m.netY)}, riskiga korrigeeritud ${pct(m.netY - x.premium / 100)} — ${m.netY - x.premium / 100 > (best.score) ? 'parem' : 'nõrgem'} kui puhas ${best.s.toLowerCase()} (${pct(best.score)} aastas).`);
      }
    } else if (x.cond === 'N' || x.cond === 'M') {
      out.push('   - Kombineeritud: osta, renoveeri ja anna pikaajaliselt üürile: ülaltoodud arvutus sisaldab kerget remonti; täisremondi korral ARV suureneb, aga üür ei muutu proportsionaalselt, seega ei tasu.');
    }
  }

  // 4. LÕKSUD
  H('4. LÕKSUD (paberil head, välja jäetud)');
  const trapEv = T.evaluate(T.excluded.filter((x) => x.price <= P.maxPrice && x.area >= 15));
  const traps = [];
  for (const x of T.rankLT(trapEv.lt).filter(confOK).slice(0, 40)) traps.push({ x, why: T.excluded.find((y) => y.id === x.id).excl, m: `netotootlus ${pct(x.m.netY)} / risk. korr. ${pct(x.riskAdj)} (pikaajaline üür)` });
  for (const x of trapEv.direct.filter((y) => y.disc >= 0.3).sort((a, b) => b.disc - a.disc).slice(0, 20)) traps.push({ x, why: T.excluded.find((y) => y.id === x.id).excl, m: `${pct(x.disc, 0)} alla turu (edasimüük)` });
  const seen = new Set();
  let c = 0;
  for (const t of traps.sort((a, b) => (b.x.riskAdj || 0) - (a.x.riskAdj || 0))) {
    if (seen.has(t.x.id) || c >= 5) continue; seen.add(t.x.id); c++;
    out.push(`- ${short(t.x.address)} (${eur(t.x.ask)}; ${t.m}) — välja jäetud, sest: ${t.why}. ${t.x.url}`);
  }
  // väga kõrge tootlusega, aga kahtlased: edasimüük >50% alla turu
  const tooGood = ev.direct.filter((x) => x.tooGood).length;
  out.push(`- Lisaks ${tooGood} objekti, mis näivad olevat > 50% alla turu: loen need võrdlusbaasi vigadeks või objekti probleemiks (nt maakülade odavkorterid võrreldud linna hindadega) ega kvalifitseeri.`);

  // 5. TUNDLIKKUS
  H('5. TUNDLIKKUS');
  const baseTop = top;
  const scen = [
    ['intress +1 pp (5,5%)', { rate: P.rate + 0.01 }],
    ['turuüür / ööhind / müügihind −10%', { rentMult: 0.9, saleMult: 0.9, adrRealized: P.adrRealized * 0.9 }],
    ['flipi remont +20%, hoidmine +3 kuud', { renoMult: 1.2, flipMonths: P.flipMonths + 3 }],
  ];
  for (const [name, mods] of scen) {
    out.push(`\n${name}:`);
    const res = withP(mods, () => { const e = evalAll(); return { t: top3Of(e), e }; });
    const cmp = (key, label, f) => {
      const b = baseTop[key][0], r = res.t[key][0];
      if (!b) { out.push(`   ${label}: sobivaid objekte pole`); return; }
      const rr = res.e[key].find((y) => y.id === b.id);
      const stillOk = rr && (key === 'lt' || key === 'st' || rr.ok);
      const top1Same = r && r.id === b.id;
      const same = ids(baseTop[key]) === ids(res.t[key]);
      out.push(`   ${label}: nr 1 ${short(b.address)} → ${stillOk ? f(rr) : 'ei täida enam tingimusi'} (enne ${f(b)}); ${same ? 'järjestus ei muutu' : top1Same ? 'nr 1 jääb samaks, kohad 2–3 muutuvad' : 'järjestus MUUTUB: uus nr 1 ' + (r ? short(r.address) : '—')}.`);
    };
    cmp('lt', 'Pikaajaline', (y) => `netotootlus ${pct(y.m.netY)}, cash-on-cash ${pct(y.m.coc)}`);
    cmp('st', 'Lühiajaline', (y) => `netotootlus ${pct(y.m.netY)}, cash-on-cash ${pct(y.m.coc)}`);
    cmp('flip', 'Flip', (y) => `puhaskasum ${eur(y.m.net)}`);
    cmp('direct', 'Otse edasimüük', (y) => `puhaskasum ${eur(y.m.net)}`);
    if (best) {
      const bx = best.x; const rr = res.e[bx.strategy].find((y) => y.id === bx.id);
      const okNow = rr && (bx.strategy === 'lt' || bx.strategy === 'st' || rr.ok);
      out.push(`   Parim tehing (${short(bx.address)}): ${okNow ? (bx.strategy === 'lt' || bx.strategy === 'st' ? `netotootlus ${pct(rr.m.netY)} (enne ${pct(bx.m.netY)})` : `puhaskasum ${eur(rr.m.net)} (enne ${eur(bx.m.net)})`) : 'enam ei täida strateegia tingimusi'}.`);
    }
  }

  H('MEGA DIILID PRAEGU (värsked ≤ 30 päeva, usaldusväärsus ≥ keskmine)');
  if (!mega.length) out.push('Praegu mega diile ei ole.');
  mega.slice(0, 10).forEach((m) => out.push(`- ${m.strategy}: ${short(m.x.address)} — ${m.main}\n  LINK: ${m.x.url}`));
  return { text: out.join('\n'), ev, top, mega };
}

// ---------- igapäevane ----------
function readSent() {
  if (!fs.existsSync(SENT)) return new Map();
  const m = new Map();
  fs.readFileSync(SENT, 'utf8').split('\n').slice(1).forEach((l) => { const c = l.split(','); if (c[0]) m.set(c[0], +c[2]); });
  return m;
}
function daily() {
  const ev = evalAll();
  const mega = T.megaDeals(ev);
  const sent = readSent();
  const fresh = mega.filter((m) => !sent.has(m.x.id) || m.x.ask < sent.get(m.x.id));
  const top = top3Of(ev);
  const summary = { date: new Date().toISOString().slice(0, 10), analysed: T.clean.length, newInDay: T.clean.filter((x) => T.ageDays(x) <= 1).length, mega: mega.length, newMega: fresh.length };
  const best = {
    lt: top.lt[0], st: top.st[0], flip: top.flip[0], direct: top.direct[0],
  };
  const line = (k, label) => best[k] ? `${label}: ${short(best[k].address)} (${best[k].url}) — ${k === 'lt' || k === 'st' ? 'risk. korr. netotootlus ' + pct(best[k].riskAdj) : k === 'flip' ? 'puhaskasum ' + eur(best[k].m.net) : 'puhaskasum ' + eur(best[k].m.net) + ', ' + pct(best[k].disc, 0) + ' alla turu'}` : `${label}: sobivaid objekte pole`;
  fs.writeFileSync(path.join(D, 'daily_result.json'), JSON.stringify({ summary, fresh: fresh.slice(0, 5).map((m) => ({ id: m.x.id, strategy: m.strategy, ask: m.x.ask })) }, null, 1));
  if (!fresh.length) {
    if (fs.existsSync(path.join(D, 'mega_email.txt'))) fs.unlinkSync(path.join(D, 'mega_email.txt'));
    const best1 = mega[0];
    console.log(`Mega diile ei ole (uusi). Analüüsitud ${summary.analysed} objekti (kuulutusi ≤ 1 päev: ${summary.newInDay}). Lähim: ${best1 ? short(best1.x.address) + ' (' + best1.main + ')' : 'puudub'}.`);
    return;
  }
  const subject = fresh.length === 1 ? `🔥 Mega diil: ${short(fresh[0].x.address)} – ${fresh[0].strategy}, ${fresh[0].main}` : `🔥 ${fresh.length} mega diili täna – parim: ${short(fresh[0].x.address)}`;
  const body = [];
  for (const m of fresh.slice(0, 5)) {
    const x = m.x;
    body.push(`${short(x.address)}\nLINK: ${x.url}\nKüsitud ${eur(x.ask)}, pakkumisvahemik ${rangeStr(x)} (arvutuses ${eur(x.bid)})\nStrateegia: ${m.strategy}. ${m.main}.${x.m && x.m.netY !== undefined ? ' Netotootlus ' + pct(x.m.netY) + ', riskiga korrigeeritud ' + pct(x.riskAdj) + '.' : ''}${x.m && x.m.net !== undefined ? ' Puhaskasum ' + eur(x.m.net) + ', riskiga korrigeeritud ' + eur(x.m.adj) + '.' : ''}`);
    if (x.strategy === 'direct') body.push(`Miks mega diil: ostuhind ${pct(x.disc, 0)} alla turuväärtuse (${Math.round(x.mvPerM2)} €/m² mediaan, ${x.mvN} võrdlust; objekt ${eur(x.perM2)}/m²); müüja viited kiirele müügile/hinnalangetusele.`);
    else if (x.strategy === 'flip') body.push(`Miks mega diil: ARV ${eur(x.m.arv)} (${Math.round(x.arvPerM2)} €/m², ${x.arvN} võrdlust) vs ostuhind ${eur(x.bid)} + remont ${eur(x.m.reno)}; puhaskasum ${pct(x.m.pct, 0)} kogukuludest.`);
    else if (x.strategy === 'st') body.push(`Miks mega diil: ööhind ~${eur(x.m.adr)} × 365 × ${pct(x.m.occ, 0)} täituvus = ${eur(x.m.rev)} käivet; netotulu ${eur(x.m.noi)} investeeringult ${eur(x.m.invest)}. Piirkonna ööhind põhineb Booking.com valimil, täituvus on hinnang.`);
    else body.push(`Miks mega diil: turuüür ${eur(x.rent)}/kuus (${x.rentN} võrdlust) vs hind ${eur(x.bid)}; NOI ${eur(x.m.noi)}; pakkumise hind ${eur(x.perM2)}/m² vs piirkonna ${x.mvPerM2 ? Math.round(x.mvPerM2) + ' €/m²' : '—'}.`);
    body.push(`Suurim risk / kontrolli enne helistamist: ${flagsOf(x).join('; ')}. KÜ põhikiri, majandusaasta aruanne, remondifondi seis, laenud, üürilepingud, kütteviis.`);
    const mb = x.strategy === 'lt' ? maxBidLT(x, P.megaLT) : x.strategy === 'st' ? maxBidST(x, P.megaST) : x.strategy === 'flip' ? maxBidFlip(x) : maxBidDirect(x);
    body.push(`Maksimaalne pakkumise hind: ${mb ? eur(mb) : eur(x.ask)}.\n`);
  }
  body.push(`Täna analüüsiti ${summary.analysed} objekti (uusi kuulutusi viimase päeva jooksul: ${summary.newInDay}).`);
  body.push('Hetke nr 1 igas strateegias:');
  body.push('- ' + line('lt', 'Pikaajaline üür')); body.push('- ' + line('st', 'Lühiajaline üür')); body.push('- ' + line('flip', 'Flip')); body.push('- ' + line('direct', 'Otse edasimüük'));
  fs.writeFileSync(path.join(D, 'mega_email.txt'), `${subject}\n\n${body.join('\n')}`);
  fs.writeFileSync(path.join(D, 'mega_ids.json'), JSON.stringify(fresh.slice(0, 5).map((m) => ({ id: m.x.id, ask: m.x.ask, strategy: m.strategy }))));
  console.log(`MEGA: ${fresh.length} uut mega diili. E-kiri valmis: data/mega_email.txt. ${subject}`);
}
function markSent() {
  const f = path.join(D, 'mega_ids.json');
  if (!fs.existsSync(f)) { console.log('pole mida märkida'); return; }
  const items = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!fs.existsSync(SENT)) fs.writeFileSync(SENT, 'id,kuupäev,hind,strateegia\n');
  const today = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(SENT, items.map((i) => `${i.id},${today},${i.ask},${i.strategy}`).join('\n') + '\n');
  console.log('lisatud saadetud_diilid.csv:', items.length);
}

function seed() { // märgib kõik praegused mega diilid teavitatuks (nt esmakordsel käivitusel)
  const ev = evalAll(); const mega = T.megaDeals(ev);
  if (!fs.existsSync(SENT)) fs.writeFileSync(SENT, 'id,kuupäev,hind,strateegia\n');
  const sent = readSent(); const today = new Date().toISOString().slice(0, 10);
  const add = mega.filter((m) => !sent.has(m.x.id));
  fs.appendFileSync(SENT, add.map((m) => `${m.x.id},${today},${m.x.ask},${m.strategy}`).join('\n') + (add.length ? '\n' : ''));
  console.log('seeded:', add.length);
}
if (require.main === module) {
  if (process.argv.includes('--seed')) seed();
  else if (process.argv.includes('--mark-sent')) markSent();
  else if (process.argv.includes('--daily')) daily();
  else { const r = buildReport(); fs.writeFileSync(path.join(D, 'raport.txt'), r.text); console.log('raport:', r.text.length, 'tähemärki → data/raport.txt'); }
}
module.exports = { buildReport, daily, markSent };
