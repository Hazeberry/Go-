'use strict';
/* Erzeugt Testbretter mit UNSERER Engine und schreibt zu jedem Brett den
   Vektor, den boardToInput im Browser liefert. features.py muss denselben
   Vektor produzieren — sonst lernt das Netz auf Merkmalen, die es im Spiel
   nie sieht. Ausgabe: boards.json (Bretter + Referenzvektoren duenn besetzt). */
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const g = id => html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`))[1];

const sp = new Map();
const c = vm.createContext({console: {log(){}, warn(){}, error(){}}, Date, Math: Object.create(Math),
  JSON, performance, Float32Array, Uint8Array, Int32Array, Uint32Array, btoa, atob,
  localStorage: {getItem: k => sp.get(k) ?? null, setItem: (k,v) => sp.set(k,String(v)), removeItem: k => sp.delete(k)},
  document: {getElementById: () => null}});
c.globalThis = c;
let s = 777;
c.Math.random = () => { s ^= s<<13; s ^= s>>>17; s ^= s<<5; return (s>>>0)/4294967296; };
vm.runInContext(g('shared-go-logic') + '\n' + g('worker-ai') + '\n' + g('policy-net'), c);

let seed = 5150;
const rnd = () => { seed ^= seed<<13; seed ^= seed>>>17; seed ^= seed<<5; return (seed>>>0)/4294967296; };

const faelle = [];
/* Bandbreite: leeres Brett, fruehe und spaete Stellungen, mit und ohne Ko,
   mit und ohne letzten Zug — die Randfaelle, an denen ein Nachbau bricht. */
for (const [n, mitKo, mitLetzt] of [[0,false,false], [5,false,true], [30,true,true],
     [60,false,true], [120,true,true], [200,false,false], [280,true,true], [330,false,true]]) {
  const b = new Uint8Array(361);
  c.__b = b;
  let col = 1, last = -1;
  for (let k = 0; k < n; k++) {
    const legal = vm.runInContext('getLegalMoves(__b, ' + col + ', _emptyHashes, null)', c);
    if (!legal.length) break;
    const m = legal[Math.floor(rnd()*legal.length)];
    b[m.idx] = col;
    vm.runInContext('removeDeadGroups(__b, ' + (col===1?2:1) + ', ' + m.idx + ')', c);
    last = m.idx; col = col === 1 ? 2 : 1;
  }
  /* Ko-Punkt: irgendein leerer Punkt, nur um den Kanal zu treffen. */
  let ko = null;
  if (mitKo) for (let i = 0; i < 361; i++) if (b[i] === 0) { ko = i; break; }
  const lm = (mitLetzt && last >= 0) ? {x: last % 19, y: Math.floor(last / 19)} : null;
  const vek = c.policyNet.boardToInput(b, col, lm, ko);
  const nz = [];
  for (let i = 0; i < vek.length; i++) if (vek[i] !== 0) nz.push([i, vek[i]]);
  faelle.push({n, board: Array.from(b), color: col,
               lastMove: lm ? (lm.y*19 + lm.x) : null, koPos: ko,
               nonzero: nz});
}
fs.writeFileSync(__dirname + '/boards.json', JSON.stringify(faelle));
console.log(`${faelle.length} Faelle geschrieben, Nichtnullen je Fall: `
  + faelle.map(f => f.nonzero.length).join(', '));
