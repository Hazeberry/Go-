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
| 6. Spielstärke | kein Gewinn in drei Läufen: 30,0 %, 40,0 % (Skala 5000) und 41,7 % (Skala 800) |

**Das Ergebnis ist negativ.** Das Netz ist nachweislich besser als Zufall —
Faktor 4 auf Top-1, Faktor 2,8 auf Top-10 — und macht die Engine mit
`netMaxBlend=0,30` trotzdem schwächer, am Ende 7 bis 16 Punkte Gebiet hinten.

**Der Lauf ist aber konfundiert, und zwar so stark, dass er die Frage nach der
Netzgüte nicht beantwortet.** Der Netzbeitrag ist `blendWeight · p ·
netScoreScale` (`index.html:1687`), `netScoreScale` stand auf dem Default 5000.
Die exportierten Priors dieses Netzes sind selbstsicher — `p_max` bis 0,59 —
und ergeben damit Beiträge von 100 bis 888 Punkten, gegen eine
Entscheidungsspanne von `evaluateMove` von ≈ 15,8 in der Eröffnung und ≈ 160
im Mittelspiel:

| Fall | `p_max` | Beitrag bei bw 0,30 | Verhältnis zur Mittelspielspanne |
|---|---|---|---|
| 0 | 0,067 | 101 | 0,6× |
| 3 | 0,131 | 196 | 1,2× |
| 5 | 0,592 | 888 | 5,5× |

Bei 0,30 wurde die Heuristik also nicht zu 30 % beigemischt, sondern ihre
Rangfolge **ersetzt**. Gemessen wurde damit „Zugordnung des Netzes statt der
Heuristik", nicht „Netz als Prior mit 30 % Gewicht". Dass das verliert, ist
plausibel und belegt — es belegt aber **nicht**, dass die Kopfgüte der Grund
ist.

Der Kommentar in `index.html:691` sah dieses Problem für *flache, ungelernte*
Priors voraus (1,4e-3 … 5,2e-3). Für ein gelerntes Netz kippt es ins
Gegenteil: je sicherer der Prior, desto vollständiger die Übersteuerung. Ein
fairer Test braucht ein `netScoreScale`, das den Netzterm spannengleich macht.
Pro Testbrett mit der phasenrichtigen Spanne gerechnet ergibt das 402 bis
1727, Median 775 — der Bereich ist eng, weil Netzsicherheit (`p_max` 0,07 →
0,59) und Heuristikspanne (15,8 → 160) beide mit dem Partieverlauf wachsen und
sich weitgehend aufheben. Gewählt: 800, Mitte statt Extrem.

### Der kalibrierte Lauf — und warum er die Frage nicht schließt

| Konfiguration | Spiele A:B | Siegrate A | Paar-Bilanz | p | im 95-%-Band? |
|---|---|---|---|---|---|
| `netScoreScale` 5000 (2 Läufe) | 42:78 | 35,0 % | 8:26 | 0,003 | **nein**, darunter |
| `netScoreScale` 800 | 25:35 | 41,7 % | 6:11 | 0,332 | ja (37,3–62,7 %) |

Die Kalibrierung nimmt dem Befund die Signifikanz, aber sie dreht ihn nicht:
41,7 % ist kein Gewinn. Und der Unterschied zwischen beiden Konfigurationen
ist **+6,7 Prozentpunkte bei p = 0,39** — selbst nicht signifikant. Es ist
also *nicht* belegt, dass die Skala die Ursache war; belegt ist nur, dass der
spannengleiche Lauf nicht mehr messbar schlechter als 50 % ist.

Damit stehen beide Hypothesen weiter: „Netz zu schwach" und „Skala war schuld"
sind bei n=60 nicht zu trennen. Was über alle drei Läufe hinweg gilt: 30,0 %,
40,0 %, 41,7 % — **kein Lauf zeigt einen Gewinn**, in keiner Konfiguration.
`netMaxBlend` bleibt 0, und zwar aus Mangel an Beleg für einen Gewinn, nicht
mehr aus belegtem Schaden.

**Was ein Abschluss kosten würde.** Um 41,7 % gegen 50 % mit 80 % Power zu
belegen, braucht es ≈ 277 Partien = 138 Paare ≈ 6,1 h Rechenzeit; für 45 %
wären es 776 Partien ≈ 17 h. Der Effekt, wenn es einen gibt, liegt unter dem
Rauschboden dieser Laufgröße. Wer die Frage schließen will, muss diese
Partienzahl einplanen — oder die Kopfgüte so weit heben, dass der Effekt
größer wird als das Rauschen.

Nach der Hausregel „Erstlauf ist Hypothese" stehen zwei unabhängige Läufe
dahinter, und sie sind **nicht gleich stark**:

| Lauf | Spiele A:B | Siegrate A | Paar-Bilanz | p | Sims/Zug |
|---|---|---|---|---|---|
| 1 (`Math.random`) | 18:42 | 30,0 % | 3:15 | 0,008 | 337 |
| 2 (Seed 4711) | 24:36 | 40,0 % | 5:11 | 0,21 | 430 |
| gepoolt | 42:78 | 35,0 % | 8:26 | 0,003 | — |

Lauf 2 allein trägt nichts (p = 0,21). Getragen wird der Befund davon, dass
beide Läufe auf **derselben** Seite von 50 % liegen und 35,0 % gepoolt unter
der Untergrenze des 95-%-Zufallsbands liegt (41,1 % bei n=120). Das ist der
Gegenfall zu `phaseNormalize` im Harness-Kopf, wo der zweite Seed auf 52,5 %
kippte und das Poolen das Ergebnis auflöste.

Nicht belegte, aber passende Lesart: Lauf 2 hatte 430 statt 337 Sims/Zug, und
der Schaden war dort geringer (40 % gegen 30 %). Mehr Suche würde einen
schlechten Prior überstimmen. Zwei Läufe belegen diesen Zusammenhang nicht.

**`--seed` macht diese Läufe nicht reproduzierbar.** Zwei Läufe mit Seed 4711
ergaben verschiedene Partien — der Seed fixiert die Eröffnungen, aber bei
festem Zeitbudget (250 ms/Zug) hängt die Simulationszahl an der Maschinenlast
und damit der Suchverlauf. Läufe mit gleichem Seed sind deshalb **keine**
unabhängigen Stichproben (gleiche Eröffnungen) und dürfen nicht gepoolt
werden; die beiden Läufe oben sind es, weil Lauf 1 ohne `--seed` auf
`Math.random` läuft.

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
