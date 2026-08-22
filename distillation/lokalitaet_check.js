'use strict';
/* Gate-Sweep fuer localityBonus: ab welcher Dosis aendert sich die Rangfolge?
 *
 *     node distillation/lokalitaet_check.js      (braucht boards.json)
 *
 * ZWECK. localityBonus steht auf 0 mit dem Vermerk "bis der A/B-Harness eine
 * Aussage erlaubt". Bevor man 120 Minuten Partien dafuer ausgibt, sollte die
 * Dosis feststehen — dieser Sweep liefert sie, in Sekunden statt Stunden.
 *
 * MESSUNG (acht Testbretter, Faelle ohne letzten Zug entfallen — der Term
 * braucht _lastMoveIdx). Zahl = wie viele der Top-20 gegenueber Dosis 0
 * ausgetauscht sind, * = bester Zug geaendert:
 *
 *   mc      1    2    5   10   20   50   80  200  400   Kipppunkt
 *    5      1    2    4    6    7   13   15  16*  16      200
 *   30      0    1    2    2    2    3    3  10*  16      400
 *   60      0    1    1    1    1    1    1   4*  16      200
 *  120     10   11   11   11   11   11  15*  16*  19      200
 *  280      1    1    1    1    1    3    3    4    4       —
 *  330      3    4    4    4    4    4    4    6    6       —
 *
 * BEFUND. Der beste Zug kippt erst bei 200-400 — der alte Vermerk in PARAMS
 * ("bis 200 bewegt der Bonus die Rangfolge nicht, ab 400 dominiert er") trifft
 * zu. Bei 400 tauschen 16-19 von 20 aus, das ist Uebersteuerung; 200 ist die
 * Kante und damit der Wert, den ein A/B testen sollte.
 *
 * WAS HIER NICHT TRUG. Aus dem gemessenen Abstand zwischen bestem und
 * zweitbestem evaluateMove-Score (0,0-0,5, siehe spanne_check.js) wurde
 * zunaechst geschlossen, schon Einzelwerte bis wenige Dutzend muessten die
 * Spitze kippen. Das ist falsch: bester und zweitbester Zug liegen oft
 * NEBENEINANDER, bekommen also fast denselben Lokalitaetszuschlag, und die
 * Reihenfolge bleibt. Um die Spitze zu kippen, muss der Term einen ENTFERNTEN
 * Kandidaten hochziehen — dafuer zaehlt die volle Score-Spanne, nicht der Gap.
 * Die Gap-Kalibrierung gilt fuer Terme, die je Zug unabhaengig wirken (wie
 * netScoreScale), nicht fuer raeumlich korrelierte. Sichtbar an der
 * Top-20-Spalte: das Mittelfeld sortiert sich lange vor der Spitze um.
 *
 * FALLE. evaluateMove ist ohne Vorkehrung nicht zwischen zwei Aufrufen
 * reproduzierbar — der Zufallsstrom laeuft weiter. Ohne den Reset in
 * bewerte() zeigte schon die Dosis-0-Spalte Aenderungen gegen sich selbst,
 * und jeder Dosisvergleich waere ein Vergleich zweier Zufallsziehungen
 * gewesen. Die Dosis-0-Spalte ist deshalb als Sanity-Check stehengeblieben:
 * steht dort nicht ueberall 0, ist der Lauf ungueltig.
 */
/* Gate-Sweep fuer localityBonus: ab welcher Dosis aendert sich die Rangfolge?
   Bezugsgroesse ist NICHT die Score-Groesse (Hunderte), sondern der Abstand
   zwischen den Top-Kandidaten — der liegt in Eroeffnung und Mittelspiel bei
   0,0-0,5 (siehe spanne_check.js). Die alte Messung im PARAMS-Kommentar
   verglich gegen die Score-Groesse und schloss daraus "bis 200 bewegt der
   Bonus die Rangfolge nicht". Das wird hier geprueft. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = '/home/user/Go-';
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const g = id => html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`))[1];
const sp = new Map();
const c = vm.createContext({console: {log(){}, warn(){}, error(){}}, Date, Math: Object.create(Math),
  JSON, performance, Float32Array, Uint8Array, Int32Array, Uint32Array, btoa, atob,
  localStorage: {getItem: k => sp.get(k) ?? null, setItem: (k,v)=>sp.set(k,String(v)), removeItem: k=>sp.delete(k)},
  document: {getElementById: () => null}});
c.globalThis = c;
let s = 777;
c.Math.random = () => { s ^= s<<13; s ^= s>>>17; s ^= s<<5; return (s>>>0)/4294967296; };
vm.runInContext(g('shared-go-logic') + '\n' + g('worker-ai') + '\n' + g('policy-net'), c);

const faelle = JSON.parse(fs.readFileSync(path.join(ROOT, 'distillation/boards.json'), 'utf8'));
const DOSEN = [0, 1, 2, 5, 10, 20, 50, 80, 200, 400];

const bewerte = (f, bonus) => {
  s = 777;   // Zufallsstrom zuruecksetzen
  c.__b = Uint8Array.from(f.board);
  vm.runInContext(`PARAMS.localityBonus = ${bonus};`
    + `_lastMoveIdx = ${f.lastMove === null ? -1 : f.lastMove};`, c);
  const legal = vm.runInContext(`getLegalMoves(__b, ${f.color}, _emptyHashes, null)`, c);
  const empty = vm.runInContext('__b.reduce((n,v)=>v===0?n+1:n,0)', c);
  vm.runInContext(`primeAreaCache(__b, ${f.color})`, c);
  c.__legal = legal;
  const sc = vm.runInContext(
    `__legal.map(m => evaluateMove(__b, m.idx, ${f.color}, ${f.n}, ${empty}))`, c);
  const ord = sc.map((v,i)=>[v,legal[i].idx]).sort((a,b)=>b[0]-a[0]);
  return {top: ord[0][1], top20: ord.slice(0,20).map(x=>x[1])};
};

console.log('Ab welcher Dosis kippt der beste Zug? (Faelle ohne letzten Zug entfallen)');
console.log('mc    ' + DOSEN.map(d=>String(d).padStart(5)).join(''));
const kipp = [];
for (const f of faelle) {
  if (f.lastMove === null) { console.log(`${String(f.n).padStart(3)}   (kein letzter Zug — Term inaktiv)`); continue; }
  const basis = bewerte(f, 0);
  let zeile = '', erst = null;
  for (const d of DOSEN) {
    const r = bewerte(f, d);
    const anders = r.top !== basis.top;
    if (anders && erst === null && d > 0) erst = d;
    // Wieviel der Top-20 hat sich ausgetauscht?
    const gleich = r.top20.filter(x => basis.top20.includes(x)).length;
    zeile += (anders ? '*' : ' ') + String(20 - gleich).padStart(4);
  }
  if (erst !== null) kipp.push(erst);
  console.log(`${String(f.n).padStart(3)}  ${zeile}   erster Kipppunkt: ${erst ?? '—'}`);
}
console.log('\nLegende: Zahl = wie viele der Top-20 ausgetauscht sind, * = bester Zug geaendert');
if (kipp.length) {
  kipp.sort((a,b)=>a-b);
  console.log(`Kipppunkte: ${kipp.join(', ')}  Median ${kipp[kipp.length>>1]}`);
}
