# Go — 19×19 im Browser, mit messbarer KI

Ein vollständiges Go-Spiel in einer einzigen HTML-Datei. Keine Abhängigkeiten,
kein Build, kein Server: `index.html` im Browser öffnen und spielen. Die KI
läuft als Monte-Carlo-Baumsuche in einem Web Worker.

Der zweite Teil des Projekts ist ein Messrahmen. Jede Aussage über die
Spielstärke in diesem README stammt aus gepaarten Selbstspiel-Läufen mit
Signifikanztest, nicht aus dem Eindruck beim Spielen.

## Spielen

`index.html` öffnen — lokal per Doppelklick oder über GitHub Pages. Es gibt
nichts zu installieren.

- 19×19, Komi 7.5, Superko-Regel
- Drei Schwierigkeitsgrade: Leicht, Mittel, Schwer
- Wertung wahlweise **Area** (chinesisch) oder **Territory** (japanisch)
- SGF-Export, Zug-Log, Bug-Report-Export als JSON
- Parameter-Dashboard: alle KI-Parameter live verstellbar, speicherbar im
  `localStorage`

## Stand: was funktioniert, was offen ist

**Funktioniert und ist gemessen:**

- MCTS mit PUCT, RAVE/AMAF und Baum-Wiederverwendung
- Bensons Algorithmus für bedingungslos lebende Gruppen — bewiesen, nicht
  geschätzt, und damit die einzige Schicht, die nicht heuristisch ist
- Aufgabe bei aussichtsloser Stellung, sowohl über Q als auch strukturell
  („alle legalen Züge wären todgeboren")
- Worker-Fallback-Kette `data:` → `blob:` → Hauptthread, damit die KI auch
  unter `file://` läuft, wo der Origin `null` ist

**Bekannte Grenzen, gemessen statt vermutet:**

- **Der Suchmechanismus ist nur teilweise verstanden.** `mctsValueScale` ist
  belegt der wichtigste Parameter, *warum* er wirkt, ist offen (siehe unten).
- **Die Phasengrenze liegt nicht dort, wo der Parameter sagt.** `openingMoves`
  steht auf 20, aber der Eröffnungs-Experte regiert effektiv nur etwa 15 Züge:
  Der Blend mittelt Rohwerte, und `evalMidgame` hat die rund zehnfach größere
  Entscheidungsspanne. Am nominellen 50/50-Punkt trägt es bereits 81 % der
  Varianz. Ob das schädlich ist, ist offen — ein Normierungsversuch hat nicht
  geholfen.
- **Lange Partien.** Ohne Aufgabelogik laufen Selbstspiel-Partien regelmäßig
  auf 400+ Züge, der erste Pass fällt im Mittel um Zug 390.
- **Die Zeitsteuerung ist Wall-Clock.** Auf langsamer Hardware sinkt die Zahl
  der Simulationen pro Zug und damit die Spielstärke. Ein fester Seed macht
  Läufe deshalb **nicht** reproduzierbar.
- **Das Policy-Netz lernt, aber zu wenig, um zu helfen.** Ein kleines
  Dense-Netz (3971→128→361) kann Wurzelzüge mitgewichten. Bis August 2026 war
  es doppelt tot: im Messrahmen gar nicht vorhanden, und im Spiel in einem
  geschlossenen Kreis gefangen, der `gamesPlayed` nie über 0 kommen ließ — es
  hat also nie gelernt, bei niemandem. Beides ist behoben. Danach gemessen:
  Distillation auf den Suchzug verbessert den mittleren Rang repliziert über
  vier Initialisierungen (111,7 → 90,3 bei Zufallserwartung 101,3), aber die
  Trefferquote im Kopf der Verteilung bleibt auf Zufallsniveau — der Suchzug
  landet nie auf Rang 1. Für PUCT zählt nur der Kopf. `netMaxBlend` steht
  deshalb auf 0: das Netz lernt mit, steuert aber nicht.

  Der Nachfolgeversuch, überwacht aus KataGo-Partien zu lernen
  ([`distillation/`](distillation/)), hebt den Kopf erstmals **über**
  Zufallsniveau — Top-1 1,2 %, Top-10 7,8 % gegen 0,28 % / 2,77 % bei Zufall —
  und gewinnt trotzdem in keinem A/B: 35,0 % über 120 gepaarte Partien bei
  `netScoreScale` 5000 (p = 0,003). Diese Skala ist **gemessen** kommensurabel
  — der Netzterm liegt bei 0,4× bis 5,6× der Entscheidungsspanne von
  `evaluateMove`, die spannenkalibrierten Werte streuen um Median 3841. Ein
  Gegentest mit 800 kam auf 41,7 %, schaltete das Netz dabei aber weitgehend ab
  (0,06×–0,35×) und belegt daher keine Neutralität. `netMaxBlend` bleibt 0.

  Kalibrierung ist als Erklärung **erschöpft**. Über eine 250-fache
  Skalenspanne ergibt sich eine monotone Dosis-Wirkungs-Kurve, die von unten
  gegen 50 % läuft: 35,0 % (Skala 5000), 41,7 % (800), 46,7 % (20, ab Zug 250
  auf 1000). Wäre die Skala nur falsch eingestellt, müsste eine Zwischendosis
  über 50 % schießen — keine tut es, und das beste Ergebnis ist dasjenige, bei
  dem das Netz fast nichts tut. Der Engpass ist die Kopfgüte: der Abstand
  zwischen bestem und zweitbestem Heuristikzug ist in Eröffnung und Mittelspiel
  praktisch null (Gap 0,0–0,5 bei einer Spanne von 45–236), dort entscheidet
  der Prior bei jeder Skala — und ein Netz mit Top-1 1,2 % bringt dort fast
  Zufall ein.

  Und die Kopfgüte hängt an der **Datenmenge**, nicht an Kapazität oder
  Merkmalsform: 554 985 Parameter auf 56 363 Beispiele waren 9,8×
  überparametrisiert. Eine Datenmengen-Kurve bei identischem Testsatz steigt
  monoton und ohne Plateau — Top-1 0,37 % → 0,99 % und Top-10 3,77 % → 8,24 %
  (Mittel über die letzten zehn Epochen, Endpunkte rund 4 SD getrennt)
  über 15 k bis 120 k Zeilen, wobei der Trainingsverlust dabei von 2,43 auf
  4,21 *steigt*: das Netz verlässt den Memorierbereich. Benutzt wurden bisher
  vier `val/`-Shards mit zusammen 61 363 Zeilen; verfügbar sind **8160
  `train/`-Shards**, und die sind 22,7× größer (348 571 nutzbare Zeilen gegen
  15 388) — hochgerechnet von einem gemessenen train-Shard rund 2,8 Milliarden
  Stellungen, von denen der Referenzlauf **0,002 %** gesehen hat. Die höchste
  Hebelwirkung liegt damit in der Datenpipeline, und dort im **Durchsatz**,
  nicht in der Verfügbarkeit: dicht gespeichert wären das 45 TB, sparse noch
  7–13 TB. Streaming ist der einzige Weg für den vollen Bestand, sparse das
  RAM-Format für den Arbeitsausschnitt. Ob all das der Spielstärke hilft, ist
  **nicht** gemessen.

## Architektur

Eine Datei, drei Skriptblöcke — bewusst so, damit die Engine ohne Build-Schritt
im Browser *und* im Messrahmen identisch läuft:

| Block | Inhalt |
|---|---|
| `<script id="shared-go-logic">` | Regeln, Zobrist-Hashing, Freiheiten, Benson — DOM-frei |
| `<script id="worker-ai">` | MCTS, Bewertungsfunktionen, Rollouts — DOM-frei |
| `<script id="policy-net">` | Policy-Netz: Features, Forward, REINFORCE-Training |
| Haupt-Skript | UI, Rendering, Worker-Verwaltung, Dashboard |

Alle drei ID-Blöcke werden vom Messrahmen zur Laufzeit aus der `index.html`
extrahiert. Es gibt also **kein Code-Duplikat**: Gemessen wird exakt der Stand,
der auch im Browser läuft. Die ersten beiden Blöcke sind DOM-frei; `policy-net`
fasst `localStorage` und `document.getElementById` an und bekommt beide vom
Messrahmen als Schale gestellt, statt im Code zu verzweigen.

### Bewertung

Ein Mixture-of-Experts über die Partiephasen — `evalOpening`, `evalMidgame`,
`evalEndgame`, `evalTsumego`, `evalNakade` — mit weichem Übergang zwischen den
Phasen. Darüber liegt Benson als beweisbare Schicht: Was als bedingungslos
lebend erkannt ist, wird nicht mehr heuristisch bewertet.

## Messen

`ab-harness.js` spielt gepaarte Selbstspiel-Partien und vergleicht zwei
Parametersätze.

```bash
node ab-harness.js --paired 30 --seed 2026 --budget 250 \
  --A mctsValueScale=200 --B mctsValueScale=350 --json lauf.json
```

**Gepaart** heißt: Beide Partien eines Paares starten aus derselben neutralen
Eröffnung, danach werden die Farben getauscht. Paare, in denen der Sieger
wechselt, tragen den Parametereffekt; Paare, in denen dieselbe Farbe zweimal
gewinnt, den Farbeffekt. Das trennt beides bei einem Bruchteil der Partienzahl.

Phasenabhängige Parameter für Mechanismus-Tests:

```bash
--B mctsValueScale=200,mctsValueScale@200=1000   # ab Zug 200 umschalten
```

In CI läuft derselbe Harness über
[`.github/workflows/ab-harness.yml`](.github/workflows/ab-harness.yml),
manuell startbar mit Feldern für Partienzahl, Seed, Paarmodus und beide
Parametersätze. Jeder Lauf archiviert Rohdaten, Log **und Hardware-Kontext** —
Letzteres, weil GitHubs Runner unterschiedlich schnell sind und die
Simulationszahl pro Zug direkt an der Rechenleistung hängt.

## Belegte Ergebnisse

| Befund | Messung | Konsequenz |
|---|---|---|
| `mctsValueScale` 200 statt 350 | 65:35 über 100 gepaarte Partien, p = 0,0035 | **eingebaut** (≈ +108 Elo) |
| Kurve 100/150/200/250/300/500/1000 | Plateau bei 150–250, Abfall zu beiden Seiten | Mitte des Plateaus gewählt, nicht der Höchstwert |
| `resignQ` 0,95 gegen 0,997 | 29:31 über 60 Partien, p = 0,90 | 0,95 bleibt — rechtzeitiges Aufgeben kostet nichts |
| Phasentausch früh/spät | +12,5 gegen +5,0 Prozentpunkte, Differenz 3 Partien | **nicht entschieden** — Mechanismus offen |
| `openContactResponse` (neuer Term in `evalOpening`) | 48,8 % über 80 Partien, p = 0,91 | verworfen — Default 0 |
| `phaseNormalize` (Experten vor dem Blend normieren) | 42,5 % über 80 Partien, p = 0,22 | verworfen — Default 0 |
| `rolloutSample`, `evaluateMove`-Expansion, FPU-Vorzeichen | 60 %, 61 %, ±0,005 ΔQ | abgelehnt bzw. ohne Stärkeeffekt eingebaut |
| Policy-Netz, Rang des Suchzugs | 4 von 4 Initialisierungen besser (111,7 → 90,3), Top-10 aber auf Zufallsniveau | `netMaxBlend` bleibt 0 — kein A/B, es gibt nichts zu blenden |
| KataGo-Distillation, `netMaxBlend` 0,30 gegen 0 | vier Läufe über 250-fache Skalenspanne, monoton von unten gegen 50 %: 35,0 % (5000, p = 0,003), 41,7 % (800), 46,7 % (20→1000, p = 0,82) | verworfen — `netMaxBlend` bleibt 0. Keine Dosis über 50 %, also **kein** Kalibrierungsproblem; Engpass ist die Kopfgüte |
| Entscheidungsspanne von `evaluateMove`, gemessen | Spanne zum Median 45–1206, Gap zum Zweitbesten aber 0,0–0,5 in Eröffnung und Mittelspiel | Jeder Prior kippt dort die Zugwahl, unabhängig von `netScoreScale` — Kalibrierung allein kann das nicht steuern |

Zwei der Nullergebnisse sind **gehaltvoll, nicht leer**: Bei beiden ist per
Verhaltensmessung belegt, dass der Parameter die Zugwahl ändert — bei
`openContactResponse` steigen die lokalen Antworten von Rang 20 auf 4. Die
Engine spielt also nachweislich anders und gewinnt dadurch nicht.

Die vollständigen Zahlen samt Vorbehalten stehen im Kopfkommentar von
[`ab-harness.js`](ab-harness.js).

### Gemessen heißt nicht wirksam: gespeicherte Parameter überschreiben jeden Default

Ein exportierter Spielstand vom 18.08.2026 (Zug 204, Stufe „hard") zeigt die
Grenze dieser ganzen Messreihe. Die Partie lief mit:

| Parameter | Default im Repo | im Spiel | Messlage |
|---|---|---|---|
| `mctsValueScale` | 200 | **350** | 200 schlägt 350 mit 65:35, p = 0,0035 (≈ +108 Elo) |
| `netMaxBlend` | 0,00 | **0,3** | 0,3 verliert mit 35 % über 120 Partien, p = 0,003 |
| `resignQ` | 0,95 | **0,9** | — |

Beide belegten Verschlechterungen waren gleichzeitig aktiv. Die KI spielte
also gegen zwei selbst gemessene Handicaps, und keine Analyse ihres
Zugverhaltens ist ohne diesen Hinweis interpretierbar.

**Der Mechanismus ist strukturell, kein Bedienfehler.** `dashSave` legt mit
`JSON.stringify(PARAMS)` den **vollständigen** Parametersatz unter
`localStorage['go_params']` ab (`index.html:3669`), und beim Start übernimmt
`dashLoadSaved` **jeden** Schlüssel daraus, der in `PARAMS_DEFAULT` vorkommt
und eine endliche Zahl ist (`index.html:3689`). Der Speichern-Knopf ist dabei
völlig legitim bedient — die Semantik dahinter ist das Problem: gespeichert
wird nicht „was ich geändert habe", sondern „der gesamte Stand von damals".
Wer einmal
gespeichert hat, friert alle Defaults ein — jede spätere Messung erreicht
diesen Browser nie, ohne Versionsstempel und ohne sichtbare Warnung.

Naheliegende Abhilfe, ungetestet: nur Abweichungen sichern
(`PARAMS[k] !== PARAMS_DEFAULT[k]`), dann wandern neue Defaults automatisch
mit und bewusste Abweichungen bleiben trotzdem erhalten. Bis dahin gilt:
`dashReset` (`index.html:3697`) löscht den Speicher und stellt die gemessenen
Werte wieder her.

**Fürs Auswerten von Spielständen:** `reproduktion.board` ist die Stellung
**vor** dem letzten KI-Zug — es ist die Eingabe, mit der die KI gerechnet hat
(`mc`, `lastMove` und `aiColor` passen dazu). `meta.zug` und die ASCII-Anzeige
`brett` zeigen dagegen die Stellung danach. Beide sind korrekt, aber sie
liegen einen Zug auseinander.

## Methodik

Drei Regeln, die aus Fehlern in diesem Projekt entstanden sind und im
Harness-Kopf ausführlicher stehen:

**Der Rauschboden ist gemessen, nicht geschätzt.** Zwei *identische*
Konfigurationen kamen über 20 Partien auf 7:13. Alles zwischen 30 % und 70 % ist
bei dieser Partienzahl mit reinem Zufall vereinbar — zwei früher vielversprechende
Kandidaten (60 % und 61 %) lagen darunter und wurden zu Recht verworfen.

**Erstlauf ist Hypothese, nicht Beleg.** Ein Bestätigungslauf mit frischem Seed
und einer *vor* dem Lauf festgelegten Schwelle entscheidet. Der Höchstwert einer
verrauschten Serie ist systematisch überschätzt, deshalb wurde beim
Skalen-Plateau die Mitte gewählt und nicht der Spitzenwert.

**Ein Nullergebnis zählt nur mit Wirksamkeitsnachweis.** Beim `resignQ`-Test
wurde mitgezählt, dass die Schwelle unterschiedlich oft feuerte (26 gegen 18
Aufgaben). Ohne diese Zahl wäre „der Parameter tat nichts" nicht von
„rechtzeitiges Aufgeben kostet nichts" zu unterscheiden gewesen.

**Erstläufe mit zwei Seeds parallel, nicht als ein längerer Lauf.** Beim
`phaseNormalize`-Test lieferte der erste Seed 32,5 % bei p = 0,039 — ein
„signifikantes" Ergebnis, das der zweite Seed mit 52,5 % nicht trug. Bei zwei
Tests rutscht rund jeder zehnte zufällig unter 0,05. Zwei parallele Läufe
kosten dieselbe Wanduhrzeit wie einer und nehmen die Replikation vorweg,
statt sie nachzuschieben.

**Werkzeugfehler sehen aus wie Nullergebnisse.** Der Harness übergab
`getAIMove` jahrelang `lastMove = null`, während das Spiel den echten Wert
übergibt. Der davon abhängige Lokalitätsterm konnte im Harness also gar nicht
feuern — ein A/B darüber hätte strukturell 50 % geliefert. Dasselbe beim
Policy-Netz: die Klasse stand im Haupt-Skript, `globalThis.policyNet` war im
Harness `undefined`, der Blend-Zweig damit tot. Und selbst nach der Extraktion
blieb ein zweites stilles Tor — `blendWeight` liefert unter zwei gespielten
Partien 0. Vor der Deutung eines Nullergebnisses gehört deshalb der Nachweis,
dass der Parameter im Messaufbau überhaupt erreichbar *und* wirksam war; der
Harness zählt dafür `PHASENWECHSEL` mit, und für das Netz **zwei** Zahlen —
Vorwärtsläufe und davon solche mit Wirkung auf die Zugwahl. Ein Zähler
genügte nicht: seit Beobachten und Steuern getrennt sind, läuft das Netz bei
jedem Zug, ohne deshalb etwas zu bewirken.

Abgelehnte Befunde stehen als Kommentar an der jeweiligen Codestelle. Sonst
wird derselbe Versuch in einem Jahr erneut gefahren und die Untersuchungskosten
fallen zweimal an.

## Repository

```
index.html                      Spiel und Engine, eine Datei
ab-harness.js                   Messrahmen; Kopfkommentar = Versuchsprotokoll
distillation/                   Überwachtes Training fürs Policy-Netz
.github/workflows/ab-harness.yml  Messläufe in CI, manuell startbar
```

[`distillation/`](distillation/) enthält die Kette, um dem Policy-Netz starke
Züge beizubringen, statt es aus Selbstspiel lernen zu lassen — samt der
Prüfungen, die sicherstellen, dass ein Nullergebnis am Ende auch wirklich
eines ist.

## Lizenz

Siehe [LICENSE](LICENSE).
