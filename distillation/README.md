# Distillation — dem Policy-Netz starke Züge beibringen

Das Policy-Netz in `index.html` lernt aus Selbstspiel nachweislich nichts
Brauchbares: gemessen verbessert sich der mittlere Rang des Suchzugs zwar,
aber die Trefferquote im Kopf der Verteilung bleibt auf Zufallsniveau, und
für PUCT zählt nur der Kopf (Zahlen im Kopfkommentar von `../ab-harness.js`).

Der Ausweg ist überwachtes Lernen aus starkem Spiel. Dieses Verzeichnis
enthält die Kette dafür — jedes Glied einzeln geprüft, nicht nur „läuft
durch".

## Reihenfolge

```bash
sh netzcheck.sh                       # 0. Ist der Datenhost erreichbar?
node dump_boards.js && python3 features_check.py
                                      # 1. numpy-Merkmale == JS-boardToInput?
python3 decode.py pruefen             # 2. Stimmt KataGos Kanalbelegung?
python3 decode.py bauen               # 3. Shards -> daten.npz
python3 train.py daten.npz gewichte.json --epochen 40 --lr 0.5
                                      # 4. Trainieren, Export im Browser-Format
node export_check.js && python3 export_check.py
                                      # 5. Rechnet JS dieselben Priors?
node ../ab-harness.js --paired 30 --net gewichte.json \
     --A netMaxBlend=0.30 --B netMaxBlend=0
                                      # 6. Bringt es Spielstärke?
```

Schritt 6 ist der einzige, der über Einbauen entscheidet. Alles davor stellt
nur sicher, dass ein Nullergebnis dort auch wirklich etwas bedeutet.

## Was die Kette gemessen hat

Ein vollständiger Durchlauf, jeder Schritt einzeln geprüft:

| Schritt | Ergebnis |
|---|---|
| 0. Netz | Daten liegen auf `us.aws.cdn.hf.co`, nicht auf `huggingface.co` |
| 1. Merkmale | 8 Bretter, **0 Abweichungen** numpy gegen JS |
| 2. Kanäle | 400 Stellungen Freiheiten nachgerechnet, **0 Abweichungen**; Kanal 9 zu 100 % gegnerisch |
| 3. Daten | 61 363 Zeilen aus vier val-Shards, 3 wegen besetztem Ziel verworfen |
| 4. Training | Verlust 5,88 → 4,08; Top-1 1,2 %, Top-10 7,8 % (Zufall 0,28 % / 2,77 %) |
| 5. Export | max. Abweichung 2,4e-07, argmax 8/8 gleich |
| 6. Spielstärke | **18:42** über 60 gepaarte Partien, Paar-Bilanz 3:15, p = 0,008 |

**Das Ergebnis ist negativ, und zwar deutlich.** Das Netz ist nachweislich
besser als Zufall — Faktor 4 auf Top-1, Faktor 2,8 auf Top-10 — und macht die
Engine mit `netMaxBlend=0,30` trotzdem schwächer, am Ende im Schnitt 15,5
Punkte Gebiet hinten. Ein Prior, der in 98,8 % der Fälle nicht den Suchzug
oben hat, zieht PUCT von der Suche weg, statt sie zu führen. Für einen
Gewinn müsste die Kopfgüte um Größenordnungen steigen, nicht um Prozente.

Die Kette selbst ist damit **nicht** widerlegt: Schritte 1, 2 und 5 schließen
Merkmals-, Kanal- und Exportfehler aus, und ein Auswendiglern-Test (2000
Zeilen, `lr 0.5`) treibt den Verlust auf 0,10 und Top-1 auf 0,9935 — Modell,
Ziele und Gradient funktionieren. Was fehlt, ist Kapazität und Datenmenge:
3971→128→361 auf 56 k Beispielen generalisiert kaum.

### Zwei Fallen, die dabei aufgefallen sind

**Die Lernrate war zu niedrig, und das sah aus wie Lernen.** Mit dem früher
hier dokumentierten `--epochen 8` (lr 0,05) endete der Verlust bei 5,685 —
`ln(361) = 5,889`, das Netz war praktisch noch gleichverteilt, Top-1 mit
0,0024 sogar unter Zufall. Die Kurve fiel monoton und wirkte gesund. Erst der
Auswendiglern-Test trennte „zu langsam" von „kaputt". `lr 2.0` ist die andere
Kante: die ReLUs sterben, der Rang friert bei 134 ein.

**Ein Zug auf einen besetzten Punkt.** `pruefen` meldete „auf besetztem Punkt
0,0005" — ein Mittelwert, der wie Rundung aussah und eine echte Zeile war:
genau 1 von 15 261 in `val/data0_0`, ein gegnerischer Stein in Atari, nicht
der letzte Zug. Ein Shard-Artefakt, kein Mapping-Fehler. `bauen` filtert diese
Zeilen jetzt und zählt sie; `pruefen` meldet absolute Zahlen, weil ein Anteil
verschweigt, ob eine Zeile oder tausende betroffen sind.

## Die Dateien

| Datei | Aufgabe |
|---|---|
| `netzcheck.sh` | Sagt, **welcher** Host in der Allowlist fehlt. Die Shards liegen auf einem CDN, nicht auf `huggingface.co` — wer nur den Metadaten-Host freigibt, scheitert erst beim Download. |
| `features.py` | `boardToInput` in numpy. Die riskanteste Stelle der Kette. |
| `dump_boards.js` + `features_check.py` | Vergleicht `features.py` elementweise mit der JS-Fassung. Zuletzt: 8 Bretter vom leeren Brett bis Zug 330, mit und ohne Ko, **0 Abweichungen**. |
| `decode.py` | KataGo-Shards lesen. `pruefen` verifiziert die Kanalbelegung, `bauen` schreibt `daten.npz`. |
| `train.py` | Kreuzentropie auf den gespielten Zug, Export als `go_pnet`-JSON. |
| `export_check.js` + `export_check.py` | Vergleicht die Priors aus numpy und JS nach dem Export. Zuletzt: max. **1.9e-9**, argmax 8/8 gleich. |
| `collect.js` + `json2npz.py` | Ersatzdaten aus unserem eigenen Selbstspiel — um die Kette ohne KataGo zu testen. |

## Warum jedes Glied einzeln geprüft wird

Zwei Fehlerarten wären sonst unsichtbar geblieben, und beide hätten wie ein
sauberes Nullergebnis ausgesehen:

**Falsche Merkmale.** Wenn `features.py` und `boardToInput` auseinanderlaufen,
lernt das Netz auf Merkmalen, die es im Spiel nie sieht. Es trainiert
fehlerfrei, misst gut, und ist im Browser wertlos.

**Falsch abgelegte Gewichte.** Eine vertauschte Matrixanordnung
(`W1[j*IN+i]` gegen `W1[i*HID+j]`) lädt ohne Fehlermeldung und rechnet
Unsinn. Deshalb wird nach dem Export verglichen, nicht nur geladen.

Für KataGos Kanalbelegung gilt dasselbe: `decode.py pruefen` rechnet die
Freiheiten aus den rekonstruierten Steinen **selbst** nach und hält sie gegen
die Kanäle 3/4/5, statt den Kommentaren im Quelltext zu glauben. Dazu:
kein Punkt gleichzeitig eigen und gegnerisch, Kanal 9 (jüngster Zug) muss
auf einem gegnerischen Stein liegen, das Policy-Ziel auf einem leeren Punkt.

## Herkunft der Formatangaben

Aus KataGos eigenem Quelltext, nicht aus zweiter Hand:

- npz-Schlüssel `binaryInputNCHWPacked`, `globalInputNC`,
  `policyTargetsNCMove` — `cpp/dataio/trainingwrite.h`
- 22 räumliche Kanäle (`NUM_FEATURES_SPATIAL_V7`) und ihre Belegung —
  `cpp/neuralnet/nninputs.cpp`, `fillRowV7`
- `pos = y * nnXLen + x` (`NNPos::xyToPos`) — identisch zu unserem
  `idx(x, y)`, ein Transponierfehler ist damit ausgeschlossen

## Erzeugte Dateien

`daten.npz`, `gewichte.json`, `boards.json`, `js_probs.json`, `lokal.json`
entstehen beim Lauf und stehen in `.gitignore`. Gewichte gehören nicht ins
Repo — sie sind reproduzierbar und mehrere Megabyte groß.
