'use strict';
/* Testdaten fuer die Pipeline: Selbstspiel mit unserer Engine, gespeichert
   wird nur (Brett, Farbe, letzter Zug, Ko, Suchzug). Die Merkmale baut
   features.py daraus — dieselbe Datei, die spaeter die KataGo-Stellungen
   verarbeitet. So ist alles hinter decode.py geprueft, bevor die Shards da
   sind. Aufruf: node collect.js <partien> <budget> <ausgabe.json> */
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const g = id => html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`))[1];

const sp = new Map();
const c = vm.createContext({console: {log(){}, warn(){}, error(){}}, Date, Math: Object.create(Math),
  JSON, performance, Float32Array, Uint8Array, Int32Array, Uint32Array, btoa, atob,
  localStorage: {getItem: k => sp.get(k) ?? null, setItem: (k,v) => sp.set(k,String(v)), removeItem: k => sp.delete(k)},
  document: {getElementById: () => null}});
c.globalThis = c;
let s = 8675309;
c.Math.random = () => { s ^= s<<13; s ^= s>>>17; s ^= s<<5; return (s>>>0)/4294967296; };
vm.runInContext(g('shared-go-logic') + '\n' + g('worker-ai') + '\n' + g('policy-net'), c);

const PARTIEN = +(process.argv[2] || 12);
const BUDGET  = +(process.argv[3] || 60);
const ZIEL    = process.argv[4] || (__dirname + '/lokal.json');

vm.runInContext(`
  globalThis.__sammeln = function (partien, budget, maxZuege) {
    const raus = [];
    for (let p = 0; p < partien; p++) {
      const board = createBoard();
      const caps = {1:0, 2:0}, hist = new Set([computeZobrist(board)]);
      let ko = null, mc = 0, passes = 0, last = null;
      while (mc < maxZuege && passes < 2) {
        const color = (mc % 2 === 0) ? 1 : 2;
        Object.assign(PARAMS, PARAMS_DEFAULT, {aiTimeBudget: budget, adaptiveBudgetEnabled: 0});
        const r = getAIMove(board, color, Array.from(hist), {...caps}, mc, 'hard', 1, ko, last);
        if (r.type !== 'stone') { passes++; ko = null; mc++; continue; }
        const i = r.y*19 + r.x;
        if (board[i] !== 0) { passes++; ko = null; mc++; continue; }
        raus.push({b: Array.from(board), c: color, l: last, k: ko, z: i});
        board[i] = color;
        const cap = removeDeadGroups(board, color === 1 ? 2 : 1, i);
        caps[color] += cap;
        if (cap === 1) {
          const ff = floodFill(board, i);
          ko = (ff.group.length === 1 && ff.liberties.length === 1) ? ff.liberties[0] : null;
        } else ko = null;
        hist.add(computeZobrist(board));
        last = i; passes = 0; mc++;
      }
    }
    return raus;
  };
`, c);

const t0 = Date.now();
const daten = c.__sammeln(PARTIEN, BUDGET, 140);
fs.writeFileSync(ZIEL, JSON.stringify(daten));
console.log(`${daten.length} Stellungen aus ${PARTIEN} Partien · `
  + `${((Date.now()-t0)/60000).toFixed(1)} min → ${ZIEL}`);
