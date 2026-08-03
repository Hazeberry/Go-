#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   A/B-HARNESS v2 für die Go-KI (Hazeberry/Go-)
   ═══════════════════════════════════════════════════════════════
   Self-Play-Messharness. Die KI-Logik wird zur Laufzeit DIREKT
   aus der index.html extrahiert (<script id="shared-go-logic">
   und "worker-ai") — kein Code-Duplikat, getestet wird exakt der
   Stand, der auf GitHub Pages läuft. Beide Scripte sind DOM-frei.

   Aufruf:
     node ab-harness.js [Optionen]

   Modi:
     Standard:   --games N Partien, A/B wechseln die Farbe ab
     Gepaart:    --paired N Paare — gemeinsame neutrale Eröffnung
                 (--opening Züge, Default-Parameter), dann zwei
                 Partien ab derselben Stellung mit getauschten
                 Farben. Konkordante Paare (Weiß gewinnt beide)
                 zeigen den Farbeffekt, diskordante (Sieger
                 wechselt) den Parametereffekt — bei Bruchteil
                 der Partienzahl.

   Optionen:
     --html <pfad>     index.html (Default: ./index.html)
     --games <n>       Partien im Standard-Modus (Default: 4)
     --paired <n>      Paare im Paar-Modus (0 = aus, Default: 0)
     --opening <n>     Eröffnungszüge je Paar (Default: 20)
     --obudget <ms>    Budget für Eröffnungszüge (Default: 100)
     --budget <ms>     Zeitbudget pro Zug, fest (Default: 250)
     --maxmoves <n>    Zug-Limit pro Partie (Default: 400)
     --komi <f>        Komi für die Wertung (Default: 7.5).
                       Hinweis: Die Engine selbst ist komi-blind —
                       identischer Seed erzeugt identische Züge,
                       --komi ändert NUR die Abrechnung.
     --A k=v,k=v       PARAMS für Konfiguration A (Baseline)
     --B k=v,k=v       PARAMS für Konfiguration B (Kandidat)
     --seed <n>        Zufalls-Seed (reproduzierbar)
     --json <pfad>     Rohdaten als JSON (alle Instrumente unten)
     --help            Diese Hilfe

   INSTRUMENTIERUNG (pro Partie, im JSON und als Aggregate):
     areaM150/M200/M250/areaEnde  Gebietsstand OHNE Komi (Benson-tote
                                  entfernt, dann Area), aus Schwarz-
                                  und Weiß-Sicht — lokalisiert, wann
                                  Punkte verloren gehen.
     komi0Sieger                  Gewinner bei Komi 0. Da die Engine
                                  komi-blind spielt, ist das der
                                  exakte Komi-0-Kontrolltest.
     passErste/passGesamt/passBenson  erster Pass-Zug, Passzahl,
                                  Benson-Pässe ("todgeboren"), je Farbe.
     aufgabeFarbe/grund           Aufgaben je Farbe + Grund (Q-Serie
                                  oder strukturell "todgeboren").
     q50/q75 je Farbe             Q bei 50 %/75 % der eigenen Züge —
                                  die Kennzahl, die den Einbruch
                                  lokalisiert (Fund v1: Schwarz
                                  bricht bei ~60–70 % weg).

   Beispiele:
     node ab-harness.js --games 20 --budget 250 --seed 2026 \
       --A rolloutSample=32,mctsRolloutDepth=24 \
       --B rolloutSample=16,mctsRolloutDepth=12 --json lauf.json
     node ab-harness.js --paired 12 --budget 250 --seed 77 \
       --A rolloutSample=32,mctsRolloutDepth=24 \
       --B rolloutSample=16,mctsRolloutDepth=12 --json paare.json

   FAIRNESS-REGELN: identisches festes Budget beider Seiten
   (adaptiveBudgetEnabled = 0), PARAMS_DEFAULT als Basis, nur
   explizite Schlüssel weichen ab, Farbwechsel / Farbtausch.

   ── v2.1: Modul-Zustand pro Farbe ──────────────────────────────
   Die Engine hält Zustand zwischen den Zügen in Modul-Variablen:
   _mctsSavedRoot (Tree-Reuse), _hopelessStreak und _allDeadStreak
   (Aufgabe). Im Browser lebt der Worker nur für EINE Farbe. Hier
   ziehen beide Farben im selben Scope — vorher überschrieb jede
   Farbe den Zustand der anderen:
     · Tree-Reuse: _mctsSavedRoot.aiColor stimmte nie mit der
       ziehenden Farbe überein → _tryReuseSubtree wurde in 30
       Zügen 0-mal aufgerufen, das Feature war im Harness tot.
     · Aufgabe: jeder Gegnerzug mit gutem Q setzte die Serie der
       anderen Farbe auf 0. Die Serie braucht 5 EIGENE Züge in
       Folge — sie konnte also praktisch nie volllaufen (Beleg:
       Kimis Paarlauf 0 Aufgaben, nach dem Fix 18 in 40 Partien).
   playGame führt den Zustand jetzt pro Farbe und spielt ihn vor
   jedem Zug ein. Beide Seiten verhalten sich wie im echten Spiel.

   ── Offener Befund: Tree-Reuse trifft trotzdem nie ─────────────
   Nach dem Fix wird _tryReuseSubtree aufgerufen (58× in 60 Zügen),
   findet aber KEINEN Treffer. Die Mechanik ist in Ordnung — die
   Brettdifferenz ist exakt 1 Feld —, der Gegnerzug liegt nur nie
   unter den 8 vorhergesagten Kindern. Ursache: innere MCTS-Knoten
   werden mit quickEval expandiert, die Wurzel mit dem vollen
   evaluateMove. quickEval kennt weder Ecken noch Sternpunkte, also
   sind seine Top-8 in der Eröffnung Rauschen (beobachtet: Gegner
   spielt D16/D4/Q4, Kinder liegen verstreut im Zentrum). Das
   betrifft nicht nur den Reuse, sondern den gesamten Baum
   unterhalb der Wurzel — vermutlich der Grund, warum mehr
   Simulationen bisher kaum Spielstärke bringen.

   ── Messstand (84 Partien über drei Läufe) ─────────────────────
   rolloutSample 16 / mctsRolloutDepth 12 gegen 32/24: 60 % für den
   Kandidaten, p = 0.10 — nicht signifikant, und der Vorsprung
   schrumpft mit jedem saubereren Lauf (70 % → 58 % → 55 %). Trotz
   2.8× mehr Simulationen kein belegbarer Gewinn; Standardwerte
   bleiben. Farbeffekt über die sauberen Läufe: Schwarz 38 : 46
   Weiß, p = 0.45 — die 17:3-Weiß-Dominanz aus dem allerersten Lauf
   war der 32-Bit-Epochen-Überlauf, nicht die Engine.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');

/* ── CLI ─────────────────────────────────────────────────────── */
function parseArgs(argv) {
  const a = {
    html: './index.html', games: 4, paired: 0, opening: 20, obudget: 100,
    budget: 250, maxMoves: 400, komi: 7.5, A: {}, B: {}, seed: null, json: null
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
      case '--paired': a.paired = parseInt(v, 10); i++; break;
      case '--opening': a.opening = parseInt(v, 10); i++; break;
      case '--obudget': a.obudget = parseInt(v, 10); i++; break;
      case '--budget': a.budget = parseInt(v, 10); i++; break;
      case '--maxmoves': a.maxMoves = parseInt(v, 10); i++; break;
      case '--komi': a.komi = parseFloat(v); i++; break;
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

/* ── Seedbarer Zufall (mulberry32) ───────────────────────────── */
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

/* ── Driver: läuft im selben eval-Scope wie die KI ───────────── */
const driver = `
;(function abMain(AB) {
  /* Einen Stein anwenden (Legalität hat getAIMove geprüft). Pflegt
     Gefangene, Ko-Punkt und Superko-Historie wie placeStone(). */
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

  /* Abrechnung: Benson-tote Steine entfernen (beweisbar, keine
     Heuristik), dann Area: Steine + einseitig berührte Regionen.
     Seki/Dame zählt nicht. komi als Parameter — die Engine ist
     komi-blind, also ist komi=0 der exakte Kontrolltest. */
  function finalScore(board, capsIn, komi) {
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
    return { b: area[1], w: area[2] + komi, caps };
  }

  const SIMS_RE = /MCTS (\\d+)(?: ⚠)? Sims · \\d+% [A-T]\\d+ · Q (-?[\\d.]+)/;
  const SNAP = [150, 200, 250];
  const qAt = (arr, f) => arr.length
    ? arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] : null;

  function playGame(cfgBlack, cfgWhite, startState) {
    const board = startState ? cloneBoard(startState.board) : createBoard();
    const caps = startState ? {1: startState.caps[1], 2: startState.caps[2]} : {1: 0, 2: 0};
    const hist = startState ? new Set(startState.hist) : new Set([computeZobrist(board)]);
    const ko = {point: startState ? startState.ko : null};
    let mc = startState ? startState.mc : 0;
    let passes = 0, resignedBy = null, resignInfo = null, anomalies = 0;
    /* FIX: Modul-Zustand PRO FARBE führen. _mctsSavedRoot, _hopelessStreak
       und _allDeadStreak sind Modul-Variablen der Engine. Im Browser lebt
       der Worker nur für EINE Farbe; hier ziehen beide Farben im selben
       Scope, dadurch überschrieb jede Farbe den Zustand der anderen:
         · _mctsSavedRoot: aiColor stimmte nie → Tree-Reuse griff NIE
           (gemessen: 0 Treffer in 24 Zügen)
         · _hopelessStreak/_allDeadStreak: jeder Gegnerzug mit gutem Q
           setzte die Aufgabe-Serie der anderen Farbe auf 0 → Aufgabe
           konnte praktisch nicht regulär auslösen
       Jetzt: vor jedem Zug den Zustand der ziehenden Farbe einspielen,
       danach zurückschreiben — beide Farben verhalten sich wie im Spiel. */
    const modState = {1: {root: null, hope: 0, dead: 0},
                      2: {root: null, hope: 0, dead: 0}};
    const st = {
      1: {moves: 0, sims: 0, timeMs: 0, q: []},
      2: {moves: 0, sims: 0, timeMs: 0, q: []}
    };
    const passSt = {
      1: {first: null, total: 0, benson: 0},
      2: {first: null, total: 0, benson: 0}
    };
    const area = {};

    while (mc < AB.maxMoves && passes < 2 && !resignedBy) {
      const color = (mc % 2 === 0) ? 1 : 2;
      const cfg = color === 1 ? cfgBlack : cfgWhite;
      Object.assign(PARAMS, PARAMS_DEFAULT,
        {aiTimeBudget: AB.budget, adaptiveBudgetEnabled: 0}, cfg);

      const ms = modState[color];
      _mctsSavedRoot = ms.root; _hopelessStreak = ms.hope; _allDeadStreak = ms.dead;

      const t0 = Date.now();
      const res = getAIMove(board, color, Array.from(hist), {...caps},
                            mc, 'hard', 1, ko.point, null);
      const dt = Date.now() - t0;

      ms.root = _mctsSavedRoot; ms.hope = _hopelessStreak; ms.dead = _allDeadStreak;
      const s = st[color]; s.moves++; s.timeMs += dt;

      if (res.info) {
        const m = SIMS_RE.exec(res.info);
        if (m) { s.sims += +m[1]; s.q.push(+m[2]); }
      }

      if (res.type === 'resign') { resignedBy = color; resignInfo = res.info || null; break; }
      if (res.type === 'pass') {
        passes++; ko.point = null;
        const p = passSt[color];
        p.total++; if (p.first === null) p.first = mc;
        if (res.info && res.info.indexOf('todgeboren') >= 0) p.benson++;
        mc++;
      } else {
        const i = idx(res.x, res.y);
        if (res.x === undefined || board[i] !== 0) {
          anomalies++; passes++; ko.point = null; mc++; continue;
        }
        applyMove(board, color, res.x, res.y, ko, hist, caps);
        passes = 0; mc++;
      }
      if (SNAP.indexOf(mc) >= 0 && !area['M' + mc]) {
        const f = finalScore(board, caps, 0);
        area['M' + mc] = {b: f.b, w: f.w};
      }
    }

    const score  = finalScore(board, caps, AB.komi);
    const score0 = finalScore(board, caps, 0);
    let winner, winner0;
    if (resignedBy) { winner = resignedBy === 1 ? 2 : 1; winner0 = winner; }
    else {
      winner  = score.b  > score.w  ? 1 : 2;
      winner0 = score0.b > score0.w ? 1 : 2;
    }
    return {winner, winner0, resignedBy, resignInfo, moves: mc,
            score, score0, st, anomalies, passSt, area,
            q50: {1: qAt(st[1].q, .5), 2: qAt(st[2].q, .5)},
            q75: {1: qAt(st[1].q, .75), 2: qAt(st[2].q, .75)}};
  }

  /* Neutrale Eröffnung für gepaarte Partien: Default-Parameter,
     kleines Budget — beide Paar-Partien starten exakt hier. */
  function makeOpening(plies) {
    const board = createBoard();
    const caps = {1: 0, 2: 0};
    const hist = new Set([computeZobrist(board)]);
    const ko = {point: null};
    let mc = 0, passes = 0;
    while (mc < plies && passes < 2) {
      const color = (mc % 2 === 0) ? 1 : 2;
      Object.assign(PARAMS, PARAMS_DEFAULT,
        {aiTimeBudget: AB.openingBudget, adaptiveBudgetEnabled: 0});
      const res = getAIMove(board, color, Array.from(hist), {...caps},
                            mc, 'hard', 1, ko.point, null);
      if (res.type !== 'stone') { passes++; ko.point = null; mc++; continue; }
      const i = idx(res.x, res.y);
      if (board[i] !== 0) { passes++; ko.point = null; mc++; continue; }
      applyMove(board, color, res.x, res.y, ko, hist, caps);
      passes = 0; mc++;
    }
    return {board, caps, hist: Array.from(hist), ko: ko.point, mc};
  }

  const label = (name, cfg) => {
    const keys = Object.keys(cfg);
    return name + ' (' + (keys.length
      ? keys.map(k => k + '=' + cfg[k]).join(', ')
      : 'Standard-Parameter') + ')';
  };
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const fmt = (v, d) => v === null || v === undefined ? '—' : (+v).toFixed(d === undefined ? 1 : d);

  console.log('═══ A/B-Harness v2 ═══');
  console.log('A: ' + label('Baseline', AB.A));
  console.log('B: ' + label('Kandidat', AB.B));
  console.log('Budget: ' + AB.budget + ' ms/Zug (fest) · Komi ' + AB.komi
    + ' · max ' + AB.maxMoves + ' Züge'
    + (AB.seed !== null ? ' · Seed ' + AB.seed : ''));
  console.log('');

  /* Ein Spiel in die Buchhaltung übernehmen.
     aColor = Farbe, die Konfig A in dieser Partie spielt (1=S, 2=W). */
  function bookGame(agg, r, aColor) {
    const bColor = aColor === 1 ? 2 : 1;
    const aWon = r.winner === aColor;
    const aWon0 = r.winner0 === aColor;
    (aWon ? agg.A : agg.B).wins++;
    (aWon0 ? agg.A : agg.B).wins0++;
    if (r.resignedBy) {
      (aWon ? agg.A : agg.B).resignWins++;
      const structural = r.resignInfo && r.resignInfo.indexOf('todgeboren') >= 0;
      agg.resigns[r.resignedBy][structural ? 'struktur' : 'q']++;
    }
    agg.farbSiege[r.winner]++;
    for (const col of [1, 2]) {
      const p = r.passSt[col];
      if (p.first !== null) agg.passFirst[col].push(p.first);
      agg.passTotal[col] += p.total;
      agg.passBenson[col] += p.benson;
      const q50 = r.q50[col], q75 = r.q75[col];
      if (q50 !== null) agg.q50[col].push(q50);
      if (q75 !== null) agg.q75[col].push(q75);
    }
    for (const k of Object.keys(r.area))
      agg.area[k].push(r.area[k].b - r.area[k].w);   /* Differenz aus Schwarz-Sicht */
    const diffEnd = r.score0.b - r.score0.w;
    agg.area.end.push(diffEnd);
    for (const [key, col] of [['A', aColor], ['B', bColor]]) {
      const s = r.st[col];
      agg[key].moves += s.moves; agg[key].sims += s.sims; agg[key].timeMs += s.timeMs;
    }
    agg.anomalies += r.anomalies;
    return {aWon, aWon0};
  }

  function newAgg() {
    return {
      A: {wins: 0, wins0: 0, moves: 0, sims: 0, timeMs: 0, resignWins: 0},
      B: {wins: 0, wins0: 0, moves: 0, sims: 0, timeMs: 0, resignWins: 0},
      farbSiege: {1: 0, 2: 0},
      resigns: {1: {q: 0, struktur: 0}, 2: {q: 0, struktur: 0}},
      passFirst: {1: [], 2: []}, passTotal: {1: 0, 2: 0}, passBenson: {1: 0, 2: 0},
      q50: {1: [], 2: []}, q75: {1: [], 2: []},
      area: {M150: [], M200: [], M250: [], end: []},
      anomalies: 0
    };
  }

  function printAgg(agg, nGames) {
    const line = '─'.repeat(72);
    console.log('\\n' + line);
    console.log('SIEGRATE (Komi ' + AB.komi + ')   A ' + agg.A.wins + ' : ' + agg.B.wins + ' B'
      + '    Komi-0-Wertung: A ' + agg.A.wins0 + ' : ' + agg.B.wins0 + ' B');
    console.log('FARBE   Schwarz ' + agg.farbSiege[1] + ' : ' + agg.farbSiege[2] + ' Weiß'
      + '    Aufgaben S/W: Q ' + agg.resigns[1].q + '/' + agg.resigns[2].q
      + ' · strukturell ' + agg.resigns[1].struktur + '/' + agg.resigns[2].struktur);
    for (const key of ['A', 'B']) {
      const a = agg[key];
      console.log(key + ': Ø ' + (a.moves ? Math.round(a.sims / a.moves) : 0) + ' Sims/Zug · Ø '
        + (a.moves ? Math.round(a.timeMs / a.moves) : 0) + ' ms/Zug'
        + (a.resignWins ? ' · ' + a.resignWins + ' Aufgabe-Siege' : ''));
    }
    console.log('GEBIET ohne Komi (B−W, Punkte):  Zug 150 ' + fmt(mean(agg.area.M150))
      + ' · 200 ' + fmt(mean(agg.area.M200)) + ' · 250 ' + fmt(mean(agg.area.M250))
      + ' · Ende ' + fmt(mean(agg.area.end)));
    console.log('Q 50%/75%:  Schwarz ' + fmt(mean(agg.q50[1]), 2) + ' / ' + fmt(mean(agg.q75[1]), 2)
      + '   Weiß ' + fmt(mean(agg.q50[2]), 2) + ' / ' + fmt(mean(agg.q75[2]), 2));
    console.log('PASS: erster Ø Zug S ' + fmt(mean(agg.passFirst[1]), 0) + ' / W ' + fmt(mean(agg.passFirst[2]), 0)
      + ' · gesamt S ' + agg.passTotal[1] + ' / W ' + agg.passTotal[2]
      + ' · Benson S ' + agg.passBenson[1] + ' / W ' + agg.passBenson[2]);
    if (agg.anomalies)
      console.log('⚠ ' + agg.anomalies + ' illegale KI-Züge abgefangen (als Pass gewertet) — bitte melden!');
    console.log(line);
  }

  const raw = {partien: [], paare: []};

  if (AB.paired > 0) {
    /* ═══ Paar-Modus ═══ */
    console.log('Modus: ' + AB.paired + ' Paare · Eröffnung ' + AB.opening
      + ' Züge (' + AB.openingBudget + ' ms/Zug, neutrale Defaults)\\n');
    const agg = newAgg();
    let konKordantS = 0, konKordantW = 0, diskordantA = 0, diskordantB = 0;
    for (let p = 0; p < AB.paired; p++) {
      const opening = makeOpening(AB.opening);
      const start = {board: opening.board, caps: opening.caps,
                     hist: opening.hist, ko: opening.ko, mc: opening.mc};
      const aBlackFirst = p % 2 === 0;
      const t0 = Date.now();
      const g1 = playGame(aBlackFirst ? AB.A : AB.B, aBlackFirst ? AB.B : AB.A, start);
      const g2 = playGame(aBlackFirst ? AB.B : AB.A, aBlackFirst ? AB.A : AB.B, start);
      const mins = (Date.now() - t0) / 60000;
      const aCol1 = aBlackFirst ? 1 : 2;
      const w1 = bookGame(agg, g1, aCol1);
      const w2 = bookGame(agg, g2, aCol1 === 1 ? 2 : 1);
      const aWins = (w1.aWon ? 1 : 0) + (w2.aWon ? 1 : 0);
      let typ;
      if (aWins === 2) { typ = 'A:A'; diskordantA++; }
      else if (aWins === 0) { typ = 'B:B'; diskordantB++; }
      else if (g1.winner === g2.winner) {
        typ = g1.winner === 1 ? 'S-Sweep' : 'W-Sweep';
        if (g1.winner === 1) konKordantS++; else konKordantW++;
      } else typ = 'geteilt (je Farbe 1)';
      raw.paare.push({paar: p + 1, typ,
        g1: {sieger: g1.winner === 1 ? 'S' : 'W', zuege: g1.moves,
             stand: g1.score.b + ' : ' + g1.score.w.toFixed(1)},
        g2: {sieger: g2.winner === 1 ? 'S' : 'W', zuege: g2.moves,
             stand: g2.score.b + ' : ' + g2.score.w.toFixed(1)}});
      console.log('Paar ' + (p + 1) + '/' + AB.paired + ': ' + typ
        + '  (g1 ' + raw.paare[p].g1.sieger + ' ' + raw.paare[p].g1.stand
        + ' · g2 ' + raw.paare[p].g2.sieger + ' ' + raw.paare[p].g2.stand
        + ') · ' + mins.toFixed(1) + ' min');
    }
    console.log('\\nPAAR-BILANZ: A gewinnt beide ' + diskordantA
      + ' · B gewinnt beide ' + diskordantB
      + ' · Schwarz-Sweep ' + konKordantS + ' · Weiß-Sweep ' + konKordantW
      + '   → diskordante Paare tragen den Parametereffekt, Sweeps den Farbeffekt');
    printAgg(agg, AB.paired * 2);
  } else {
    /* ═══ Standard-Modus ═══ */
    console.log('Modus: ' + AB.games + ' Partien (Farbwechsel)\\n');
    const agg = newAgg();
    for (let g = 0; g < AB.games; g++) {
      const aIsBlack = g % 2 === 0;
      const t0 = Date.now();
      const r = playGame(aIsBlack ? AB.A : AB.B, aIsBlack ? AB.B : AB.A, null);
      const mins = (Date.now() - t0) / 60000;
      const aColor = aIsBlack ? 1 : 2;
      const w = bookGame(agg, r, aColor);
      raw.partien.push({
        partie: g + 1, aIst: aColor === 1 ? 'Schwarz' : 'Weiß',
        sieger: w.aWon ? 'A' : 'B', siegerKomi0: w.aWon0 ? 'A' : 'B',
        siegerFarbe: r.winner === 1 ? 'S' : 'W',
        aufgabe: r.resignedBy ? (r.resignedBy === 1 ? 'S' : 'W') : null,
        aufgabeGrund: r.resignInfo,
        zuege: r.moves, stand: 'B ' + r.score.b + ' : W ' + r.score.w.toFixed(1),
        standKomi0: 'B ' + r.score0.b + ' : W ' + r.score0.w.toFixed(1),
        gebietOhneKomi: r.area,
        pass: {S: r.passSt[1], W: r.passSt[2]},
        q50: {S: r.q50[1], W: r.q50[2]}, q75: {S: r.q75[1], W: r.q75[2]},
        simsA: r.st[aColor].moves ? Math.round(r.st[aColor].sims / r.st[aColor].moves) : 0,
        simsB: r.st[aColor === 1 ? 2 : 1].moves
          ? Math.round(r.st[aColor === 1 ? 2 : 1].sims / r.st[aColor === 1 ? 2 : 1].moves) : 0
      });
      console.log('Partie ' + (g + 1) + '/' + AB.games + ': A=' + (aIsBlack ? 'Schwarz' : 'Weiß')
        + ' → ' + (w.aWon ? 'A' : 'B') + ' (' + (r.winner === 1 ? 'S' : 'W') + ')'
        + (r.resignedBy ? ' Aufgabe' : ' ' + r.score.b + ' : ' + r.score.w.toFixed(1))
        + ' · ' + r.moves + ' Züge · ' + mins.toFixed(1) + ' min');
    }
    printAgg(agg, AB.games);
    if (AB.games < 20)
      console.log('Hinweis: ' + AB.games + ' Partien sind Rauschen — belastbar ab ≥ 20–30.');
  }

  if (AB.json) {
    raw.konfig = {A: AB.A, B: AB.B, budgetMs: AB.budget, komi: AB.komi,
                  seed: AB.seed, modus: AB.paired > 0 ? 'paired' : 'standard'};
    require('fs').writeFileSync(AB.json, JSON.stringify(raw, null, 1));
    console.log('Rohdaten → ' + AB.json);
  }
})
`;

/* ── Alles in einem Scope ausführen ──────────────────────────── */
const AB_CONFIG = {
  A: args.A, B: args.B,
  games: args.games, paired: args.paired, opening: args.opening,
  openingBudget: args.obudget, budget: args.budget, maxMoves: args.maxMoves,
  komi: args.komi, seed: args.seed, json: args.json
};

const t0 = Date.now();
/* eslint-disable-next-line no-eval */
eval(sharedGoLogic + '\n' + workerAi + '\n' + driver + '\n(' + JSON.stringify(AB_CONFIG) + ');');
console.log(`\nGesamtlaufzeit: ${((Date.now() - t0) / 60000).toFixed(1)} min`);
