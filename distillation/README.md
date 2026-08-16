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
python3 train.py daten.npz gewichte.json --epochen 8
                                      # 4. Trainieren, Export im Browser-Format
node export_check.js && python3 export_check.py
                                      # 5. Rechnet JS dieselben Priors?
node ../ab-harness.js --paired 30 --net gewichte.json \
     --A netMaxBlend=0.30 --B netMaxBlend=0
                                      # 6. Bringt es Spielstärke?
```

Schritt 6 ist der einzige, der über Einbauen entscheidet. Alles davor stellt
nur sicher, dass ein Nullergebnis dort auch wirklich etwas bedeutet.

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
