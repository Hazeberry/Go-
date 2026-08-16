'use strict';
/* Beweist, dass der numpy-Export im Browser-Format nicht nur LAEDT, sondern
   dieselben Priors liefert. Ohne diesen Vergleich koennte eine vertauschte
   Matrixanordnung (W1[j*IN+i] gegen W1[i*HID+j]) unentdeckt durchgehen —
   das Netz wuerde laden und Unsinn rechnen. */
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const g = id => html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`))[1];
const sp = new Map();
sp.set('go_pnet', fs.readFileSync(__dirname + '/gewichte.json', 'utf8').trim());
const c = vm.createContext({console, Date, Math: Object.create(Math), JSON, performance,
  Float32Array, Uint8Array, Int32Array, Uint32Array, btoa, atob,
  localStorage: {getItem: k => sp.get(k) ?? null, setItem: (k,v) => sp.set(k,String(v)), removeItem: k => sp.delete(k)},
  document: {getElementById: () => null}});
c.globalThis = c;
c.Math.random = () => 0.5;
vm.runInContext(g('shared-go-logic') + '\n' + g('worker-ai') + '\n' + g('policy-net'), c);

const faelle = JSON.parse(fs.readFileSync(__dirname + '/boards.json', 'utf8'));
const raus = faelle.map(f => {
  const lm = f.lastMove === null ? null : {x: f.lastMove % 19, y: Math.floor(f.lastMove / 19)};
  const p = c.policyNet.forward(c.policyNet.boardToInput(
    Uint8Array.from(f.board), f.color, lm, f.koPos)).probs;
  return Array.from(p);
});
fs.writeFileSync(__dirname + '/js_probs.json', JSON.stringify(raus));
console.log(`geladen: ${c.policyNet.gamesPlayed} Spiele · ${faelle.length} Faelle gerechnet`);
