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
- **Das Policy-Netz ist experimentell und ungemessen.** Ein kleines Dense-Netz
  (3971→128→361) kann Wurzelzüge mitgewichten, trainiert per REINFORCE im
  Selbstspiel. Bis August 2026 war es im Messrahmen überhaupt nicht vorhanden,
  ein A/B darüber hätte also strukturell 50 % geliefert; das ist jetzt behoben,
  aber noch nicht in Spielstärke umgerechnet. Der Netzbeitrag ist zudem
  phasenunabhängig groß, während die Entscheidungsspanne der Heuristik es nicht
  ist — in der Eröffnung dominiert der Prior, im Mittelspiel verschwindet er.

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

Zwei der Nullergebnisse sind **gehaltvoll, nicht leer**: Bei beiden ist per
Verhaltensmessung belegt, dass der Parameter die Zugwahl ändert — bei
`openContactResponse` steigen die lokalen Antworten von Rang 20 auf 4. Die
Engine spielt also nachweislich anders und gewinnt dadurch nicht.

Die vollständigen Zahlen samt Vorbehalten stehen im Kopfkommentar von
[`ab-harness.js`](ab-harness.js).

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
Harness zählt dafür `PHASENWECHSEL` und `POLICYNET`-Vorwärtsläufe mit.

Abgelehnte Befunde stehen als Kommentar an der jeweiligen Codestelle. Sonst
wird derselbe Versuch in einem Jahr erneut gefahren und die Untersuchungskosten
fallen zweimal an.

## Repository

```
index.html                      Spiel und Engine, eine Datei
ab-harness.js                   Messrahmen; Kopfkommentar = Versuchsprotokoll
.github/workflows/ab-harness.yml  Messläufe in CI, manuell startbar
```

## Lizenz

Siehe [LICENSE](LICENSE).
