'use strict';
/* Misst die ECHTE Entscheidungsspanne von evaluateMove pro Stellung und
   stellt sie gegen den Netzterm bw*p*netScoreScale. Ziel: der kalibrierte
   netScoreScale je Zugzahl, gemessen statt aus Kommentarzahlen geerbt. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = '/home/user/Go-';
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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

const boards = JSON.parse(fs.readFileSync(path.join(ROOT, 'distillation/boards.json'), 'utf8'));
const probs  = JSON.parse(fs.readFileSync(path.join(ROOT, 'distillation/js_probs.json'), 'utf8'));
const BW = 0.30;

const med = a => { const b = [...a].sort((x,y)=>x-y); return b[b.length>>1]; };

console.log('mc  legal  Heuristik: max    2.    median   Spanne(max-med)  Gap(max-2.)'
          + '   p_max    kalib.Scale(Spanne)  kalib.Scale(Gap)');
const zeilen = [];
for (let k = 0; k < boards.length; k++) {
  const f = boards[k];
  c.__b = Uint8Array.from(f.board);
  const mc = f.n;
  const legal = vm.runInContext(`getLegalMoves(__b, ${f.color}, _emptyHashes, null)`, c);
  if (!legal.length) { console.log(`${mc}: keine legalen Zuege`); continue; }
  const empty = vm.runInContext('__b.reduce((n,v)=>v===0?n+1:n,0)', c);
  vm.runInContext(`primeAreaCache(__b, ${f.color})`, c);
  c.__legal = legal;
  const sc = vm.runInContext(
    `__legal.map(m => evaluateMove(__b, m.idx, ${f.color}, ${mc}, ${empty}))`, c);
  const srt = [...sc].sort((a,b)=>b-a);
  const mx = srt[0], zw = srt[1] ?? srt[0], md = med(sc);
  const spanne = mx - md, gap = mx - zw;
  const pmax = Math.max(...probs[k]);
  const sSpanne = spanne/(BW*pmax), sGap = gap/(BW*pmax);
  zeilen.push({mc, spanne, gap, pmax, sSpanne, sGap});
  console.log(
    `${String(mc).padStart(3)} ${String(legal.length).padStart(6)}  `
    + `${mx.toFixed(1).padStart(9)} ${zw.toFixed(1).padStart(8)} ${md.toFixed(1).padStart(8)}`
    + `  ${spanne.toFixed(1).padStart(14)} ${gap.toFixed(1).padStart(12)}`
    + `  ${pmax.toFixed(4).padStart(7)} ${sSpanne.toFixed(0).padStart(18)} ${sGap.toFixed(0).padStart(17)}`);
}
console.log();
console.log('Default netScoreScale = 5000. Verhaeltnis Netzterm zur Spanne bei bw=0.30:');
for (const z of zeilen) {
  const term = BW * z.pmax * 5000;
  console.log(`  mc ${String(z.mc).padStart(3)}: Netzterm ${term.toFixed(0).padStart(4)} vs Spanne `
    + `${z.spanne.toFixed(1).padStart(7)}  -> ${(term/z.spanne).toFixed(1)}x`);
}
fs.writeFileSync('/tmp/claude-0/-home-user-Go-/9df21522-9c5d-5eec-991e-eb8d0bef91ce/scratchpad/spanne.json',
  JSON.stringify(zeilen, null, 1));
