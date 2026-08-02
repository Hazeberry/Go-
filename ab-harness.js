#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   A/B-HARNESS für die Go-KI (Hazeberry/Go-)
   ═══════════════════════════════════════════════════════════════
   Spielt Engine-gegen-Engine mit zwei PARAMS-Konfigurationen und
   misst: Siegrate, Zugzahl, Simulationsrate, Q-Verlauf, Tempo.

   Die KI-Logik wird zur Laufzeit DIREKT aus der index.html
   extrahiert (<script id="shared-go-logic"> und "worker-ai") —
   keine Code-Duplikation, der Harness testet immer exakt den
   Stand, der auch auf GitHub Pages läuft. shared-go-logic und
   worker-ai sind DOM-frei, deshalb läuft alles unter Node.

   Aufruf:
     node ab-harness.js [Optionen]

   Optionen:
     --html <pfad>     index.html (Default: ./index.html)
     --games <n>       Anzahl Partien (Default: 4). A und B
                       wechseln die Farbe ab — Gerade wählen!
     --budget <ms>     Zeitbudget pro Zug, fest (adaptiv aus).
                       Default: 250. Klein = schnelle Experimente.
     --maxmoves <n>    Zug-Limit pro Partie (Default: 400)
     --A k=v,k=v       PARAMS für Konfiguration A (Baseline)
     --B k=v,k=v       PARAMS für Konfiguration B (Kandidat)
     --seed <n>        Zufalls-Seed für reproduzierbare Läufe
     --json <pfad>     Rohdaten (inkl. aller Q-Serien) als JSON
     --help            Diese Hilfe

   Beispiel — der Hebel aus der Analyse:
     node ab-harness.js --games 8 --budget 250 \
       --A rolloutSample=32,mctsRolloutDepth=24 \
       --B rolloutSample=16,mctsRolloutDepth=12

   FAIRNESS-REGELN (hart verdrahtet):
   - Beide Seiten bekommen dasselbe Zeitbudget pro Zug.
   - adaptiveBudgetEnabled wird auf 0 gesetzt, damit das Budget
     wirklich identisch bleibt (Feedback-Schleife würde sonst
     unterschiedlich verlängern).
   - Alle übrigen PARAMS stehen auf PARAMS_DEFAULT; nur die
     explizit übergebenen Schlüssel weichen ab.
   - Farbenwechsel je Partie kompensiert den Schwarz-Vorteil.

   ENDPUNKTE EINER PARTIE:
   - Aufgabe (resign) → Gegner gewinnt.
   - 2× Passen oder Zug-Limit → Benson entfernt beweisbar tote
     Steine, dann Area-Scoring (Steine + einseitige Regionen),
     Komi 7,5 für Weiß. Seki/Dame zählt für niemanden.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');

/* ── CLI ─────────────────────────────────────────────────────── */
function parseArgs(argv) {
  const a = {
    html: './index.html', games: 4, budget: 250, maxMoves: 400,
    A: {}, B: {}, seed: null, json: null
  };
  const kv = s => {
    const o = {};
    for (const part of s.split(',')) {
      const [k, v] = part.split('=').map(t => t.trim());
      if (!k) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) { console.error(`Ungültiger Wert: ${part}`); process.exit(2); }
      o[k] = n;
    }
    return o;
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    switch (k) {
      case '--html': a.html = v; i++; break;
      case '--games': a.games = parseInt(v, 10); i++; break;
      case '--budget': a.budget = parseInt(v, 10); i++; break;
      case '--maxmoves': a.maxMoves = parseInt(v, 10); i++; break;
      case '--A': a.A = kv(v); i++; break;
      case '--B': a.B = kv(v); i++; break;
      case '--seed': a.seed = parseInt(v, 10); i++; break;
      case '--json': a.json = v; i++; break;
      case '--help': console.log(fs.readFileSync(__filename, 'utf8')
        .split('*/')[0].replace(/^\/\*+[^\n]*\n/, '')); process.exit(0);
      default: console.error(`Unbekannte Option: ${k} (--help)`); process.exit(2);
    }
  }
  return a;
}

const args = parseArgs(process.argv);

/* ── Seedbarer Zufall (mulberry32) für reproduzierbare Läufe ── */
if (args.seed !== null) {
  let s = args.seed >>> 0;
  Math.random = function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── KI-Scripts aus der index.html extrahieren ───────────────── */
function extractScript(html, id) {
  const re = new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`);
  const m = re.exec(html);
  if (!m) { console.error(`<script id="${id}"> nicht gefunden in ${args.html}`); process.exit(1); }
  return m[1];
}

const html = fs.readFileSync(args.html, 'utf8');
const sharedGoLogic = extractScript(html, 'shared-go-logic');
const workerAi = extractScript(html, 'worker-ai');

/* ── Driver: läuft im selben eval-Scope wie die KI ─────────────
   Dadurch sieht er SIZE, PARAMS, getAIMove, floodFill, Benson
   usw. direkt — kein Export-Eingriff in die Originaldatei nötig. */
const driver = `
;(function abMain(AB) {
  const KOMI = 7.5;

  /* Einen Stein anwenden (Legalität hat getAIMove schon geprüft).
     Pflegt Gefangene, Ko-Punkt und Superko-Historie exakt wie
     placeStone() im Spiel. */
  function applyMove(board, color, x, y, ko, hist, caps) {
    const i = idx(x, y);
    const opp = color === 1 ? 2 : 1;
    board[i] = color;
    const cap = removeDeadGroups(board, opp, i);
    caps[color] += cap;
    if (cap === 1) {
      const ff = floodFill(board, i);
      ko.point = (ff.group.length === 1 && ff.liberties.length === 1) ? ff.liberties[0] : null;
    } else ko.point = null;
    hist.add(computeZobrist(board));
    return cap;
  }

  /* Endabrechnung: Benson-tote Steine entfernen (beweisbar, keine
     Heuristik), dann Area: Steine + einseitig berührte Regionen.
     Regionen mit Kontakt zu beiden Farben (Seki/Dame) zählen nicht. */
  function finalScore(board, capsIn) {
    const b = cloneBoard(board);
    const caps = {1: capsIn[1], 2: capsIn[2]};
    const epoch = bensonClassify(b);
    const done = new Uint8Array(BOARD_SIZE);
    for (let i = 0; i < BOARD_SIZE; i++) {
      const c = b[i];
      if (!c || done[i]) continue;
      const ff = floodFill(b, i);
      for (const g of ff.group) done[g] = 1;
      if (_bnDead[i] === epoch)
        for (const g of ff.group) { b[g] = 0; caps[c === 1 ? 2 : 1]++; }
    }
    const area = {1: 0, 2: 0};
    const vis = new Uint8Array(BOARD_SIZE);
    for (let i = 0; i < BOARD_SIZE; i++) if (b[i]) area[b[i]]++;
    for (let i = 0; i < BOARD_SIZE; i++) {
      if (b[i] || vis[i]) continue;
      const q = [i]; vis[i] = 1;
      let head = 0, size = 0, touch = 0;
      while (head < q.length) {
        const cur = q[head++]; size++;
        for (const n of NEIGHBORS[cur]) {
          const c = b[n];
          if (c === 0) { if (!vis[n]) { vis[n] = 1; q.push(n); } }
          else touch |= c;
        }
      }
      if (touch === 1) area[1] += size;
      else if (touch === 2) area[2] += size;
    }
    return { b: area[1], w: area[2] + KOMI, caps };
  }

  const SIMS_RE = /MCTS (\\d+)(?: ⚠)? Sims · \\d+% [A-T]\\d+ · Q (-?[\\d.]+)/;

  function playGame(cfgBlack, cfgWhite) {
    const board = createBoard();
    const caps = {1: 0, 2: 0};
    const hist = new Set([computeZobrist(board)]);
    const ko = {point: null};
    let passes = 0, mc = 0, resignedBy = null, anomalies = 0;
    const st = {
      1: {moves: 0, sims: 0, timeMs: 0, q: []},
      2: {moves: 0, sims: 0, timeMs: 0, q: []}
    };

    while (mc < AB.maxMoves && passes < 2 && !resignedBy) {
      const color = (mc % 2 === 0) ? 1 : 2;
      const cfg = color === 1 ? cfgBlack : cfgWhite;
      /* Fairness: Defaults + festes Budget + nur die Config-Abweichung */
      Object.assign(PARAMS, PARAMS_DEFAULT,
        {aiTimeBudget: AB.budget, adaptiveBudgetEnabled: 0}, cfg);

      const t0 = Date.now();
      const res = getAIMove(board, color, Array.from(hist), {...caps},
                            mc, 'hard', 1, ko.point, null);
      const dt = Date.now() - t0;
      const s = st[color]; s.moves++; s.timeMs += dt;

      if (res.info) {
        const m = SIMS_RE.exec(res.info);
        if (m) { s.sims += +m[1]; s.q.push(+m[2]); }
      }

      if (res.type === 'resign') { resignedBy = color; break; }
      if (res.type === 'pass') { passes++; ko.point = null; mc++; continue; }
      /* Stein: gegen das echte Brett verifizieren (Notwehr) */
      const i = idx(res.x, res.y);
      if (res.x === undefined || board[i] !== 0) {
        anomalies++;
        passes++; ko.point = null; mc++; continue;
      }
      applyMove(board, color, res.x, res.y, ko, hist, caps);
      passes = 0;
      mc++;
    }

    const score = finalScore(board, caps);
    let winner;
    if (resignedBy) winner = resignedBy === 1 ? 2 : 1;
    else winner = score.b > score.w ? 1 : 2;
    return {winner, resignedBy, moves: mc, score, st, anomalies};
  }

  /* Q-Verlauf in Spiel-Dritteln (früh/Mitte/spät), jeweils Mittelwert */
  function qPhases(qArr) {
    if (!qArr.length) return [null, null, null];
    const third = Math.max(1, Math.floor(qArr.length / 3));
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    return [mean(qArr.slice(0, third)),
            mean(qArr.slice(third, 2 * third)),
            mean(qArr.slice(2 * third))];
  }

  const label = (name, cfg) => {
    const keys = Object.keys(cfg);
    return name + ' (' + (keys.length
      ? keys.map(k => k + '=' + cfg[k]).join(', ')
      : 'Standard-Parameter') + ')';
  };

  console.log('═══ A/B-Harness ═══');
  console.log('A: ' + label('Baseline', AB.A));
  console.log('B: ' + label('Kandidat', AB.B));
  console.log('Partien: ' + AB.games + ' · Budget: ' + AB.budget + ' ms/Zug (fest) · max ' + AB.maxMoves + ' Züge'
    + (AB.seed !== null ? ' · Seed ' + AB.seed : ''));
  console.log('');

  const agg = {
    A: {wins: 0, asColor: {1: 0, 2: 0}, moves: 0, sims: 0, timeMs: 0, q: [], resignWins: 0},
    B: {wins: 0, asColor: {1: 0, 2: 0}, moves: 0, sims: 0, timeMs: 0, q: [], resignWins: 0}
  };
  const rawGames = [];
  let totalAnomalies = 0;

  for (let g = 0; g < AB.games; g++) {
    const aIsBlack = g % 2 === 0;
    const cfgBlack = aIsBlack ? AB.A : AB.B;
    const cfgWhite = aIsBlack ? AB.B : AB.A;
    const t0 = Date.now();
    const r = playGame(cfgBlack, cfgWhite);
    const mins = ((Date.now() - t0) / 60000);
    totalAnomalies += r.anomalies;

    const aColor = aIsBlack ? 1 : 2, bColor = aIsBlack ? 2 : 1;
    const aWon = r.winner === aColor;
    (aWon ? agg.A : agg.B).wins++;
    if (r.resignedBy) (aWon ? agg.A : agg.B).resignWins++;
    agg.A.asColor[aColor]++; agg.B.asColor[bColor]++;
    for (const [key, col] of [['A', aColor], ['B', bColor]]) {
      const s = r.st[col];
      agg[key].moves += s.moves; agg[key].sims += s.sims;
      agg[key].timeMs += s.timeMs; agg[key].q.push(...s.q);
    }
    rawGames.push({
      partie: g + 1, aIst: aColor === 1 ? 'Schwarz' : 'Weiß',
      sieger: aWon ? 'A' : 'B', aufgabe: !!r.resignedBy,
      zuege: r.moves, stand: 'B ' + r.score.b + ' : W ' + r.score.w.toFixed(1),
      simsA: r.st[aColor].moves ? Math.round(r.st[aColor].sims / r.st[aColor].moves) : 0,
      simsB: r.st[bColor].moves ? Math.round(r.st[bColor].sims / r.st[bColor].moves) : 0,
      qA: r.st[aColor].q, qB: r.st[bColor].q
    });
    console.log('Partie ' + (g + 1) + '/' + AB.games + ': A=' + (aIsBlack ? 'Schwarz' : 'Weiß')
      + ' → Sieger ' + (aWon ? 'A' : 'B')
      + (r.resignedBy ? ' (Aufgabe)' : ' (' + r.score.b + ' : ' + r.score.w.toFixed(1) + ')')
      + ' · ' + r.moves + ' Züge · ' + mins.toFixed(1) + ' min');
  }

  const line = '─'.repeat(64);
  console.log('\\n' + line);
  const pct = n => (AB.games ? Math.round(n / AB.games * 100) : 0);
  console.log('SIEGRATE        A ' + agg.A.wins + ':' + agg.B.wins + ' B   ('
    + pct(agg.A.wins) + ' % : ' + pct(agg.B.wins) + ' %)'
    + (agg.A.resignWins + agg.B.resignWins
      ? '   davon per Aufgabe: A ' + agg.A.resignWins + ', B ' + agg.B.resignWins : ''));
  for (const key of ['A', 'B']) {
    const a = agg[key];
    const simsZug = a.moves ? Math.round(a.sims / a.moves) : 0;
    const msZug = a.moves ? Math.round(a.timeMs / a.moves) : 0;
    const qp = qPhases(a.q).map(v => v === null ? '  —  ' : v.toFixed(2));
    console.log(key + ': Ø ' + simsZug + ' Sims/Zug · Ø ' + msZug + ' ms/Zug'
      + ' · Q-Verlauf früh/Mitte/spät: ' + qp.join(' / '));
  }
  if (totalAnomalies)
    console.log('⚠ ' + totalAnomalies + ' illegale KI-Züge abgefangen (als Pass gewertet) — bitte melden!');
  console.log(line);
  if (AB.games < 20)
    console.log('Hinweis: ' + AB.games + ' Partien sind Rauschen, keine Aussage. '
      + 'Für belastbare Werte ≥ 20–30 Partien (Budget gern klein, z. B. 100–250 ms).');

  if (AB.json) {
    const out = {
      konfig: {A: AB.A, B: AB.B, budgetMs: AB.budget, seed: AB.seed, maxMoves: AB.maxMoves},
      siege: {A: agg.A.wins, B: agg.B.wins},
      partien: rawGames
    };
    require('fs').writeFileSync(AB.json, JSON.stringify(out, null, 1));
    console.log('Rohdaten → ' + AB.json);
  }
})
`;

/* ── Alles in einem Scope ausführen ──────────────────────────── */
const AB_CONFIG = {
  A: args.A, B: args.B,
  games: args.games, budget: args.budget,
  maxMoves: args.maxMoves, seed: args.seed, json: args.json
};

const t0 = Date.now();
/* eslint-disable-next-line no-eval */
eval(sharedGoLogic + '\n' + workerAi + '\n' + driver + '\n(' + JSON.stringify(AB_CONFIG) + ');');
console.log(`\nGesamtlaufzeit: ${((Date.now() - t0) / 60000).toFixed(1)} min`);
