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
| 6. Spielstärke | kein Gewinn bei vier Läufen über 250-fache Skalenspanne: 35,0 % (5000), 41,7 % (800), 46,7 % (20→1000) |

**Das Ergebnis ist negativ.** Das Netz ist nachweislich besser als Zufall —
Faktor 4 auf Top-1, Faktor 2,8 auf Top-10 — und macht die Engine mit
`netMaxBlend=0,30` trotzdem schwächer, am Ende 7 bis 16 Punkte Gebiet hinten.

### Skala: die Spanne ist jetzt gemessen, nicht geerbt

Der Netzbeitrag ist `blendWeight · p · netScoreScale` (`index.html:1687`).
Wie stark er wirkt, hängt an der Entscheidungsspanne von `evaluateMove` — und
die war hier zunächst **falsch angenommen**. Der Kommentar in `index.html:693`
nennt ≈ 15,8 für die Eröffnung und ≈ 160 für das Mittelspiel; daraus wurde eine
Konfundierung abgeleitet („die Skala 5000 ersetzt die Heuristik statt sie zu
mischen") und ein Gegentest mit Skala 800 gefahren. **Beides war falsch
begründet.** Die Phasengrenze liegt bei mc ≈ 15–20 (`ab-harness.js:421`), nicht
bei 150 — die Zuordnung der Spannen zu den Testbrettern stimmte also nicht.

Direkt gemessen (`evaluateMove` über alle legalen Züge der acht Testbretter,
mit dem echten `mc`):

| mc | Spanne (max−median) | Gap (max−2.) | Netzterm bei Skala 5000 | Verhältnis | kalibrierte Skala |
|---|---|---|---|---|---|
| 0 | 45,9 | 0,0 | 101 | 2,2× | 2281 |
| 5 | 45,3 | 0,5 | 126 | 2,8× | 1793 |
| 30 | 148,8 | 0,4 | 103 | 0,7× | 7201 |
| 60 | 235,8 | 8,3 | 196 | 0,8× | 6004 |
| 120 | 158,1 | 0,2 | 172 | 1,1× | 4602 |
| 200 | 158,2 | 0,0 | 888 | 5,6× | 891 |
| 280 | 471,9 | 155,8 | 766 | 1,6× | 3080 |
| 330 | 1206,0 | 424,2 | 463 | 0,4× | 13021 |

Damit fällt die Konfundierungs-These. Bei Skala 5000 liegt der Netzterm
zwischen **0,4× und 5,6×** der Spanne, also kommensurabel — nicht beim 6- bis
56-fachen. Die spannenkalibrierten Werte streuen von 891 bis 13021 mit Median
**3841**; der Default 5000 liegt nahe dieser Mitte. Die Skala 800 war folglich
keine Korrektur, sondern **5× zu klein**: dort sinkt das Verhältnis auf
0,06×–0,35×, das Netz war weitgehend abgeschaltet.

### Drei Läufe, und wie sie nach der Messung zu lesen sind

| Konfiguration | Spiele A:B | Siegrate A | Paar-Bilanz | p | Netz wirksam? |
|---|---|---|---|---|---|
| `netScoreScale` 5000 (2 Läufe) | 42:78 | 35,0 % | 8:26 | 0,003 | ja, kommensurabel |
| `netScoreScale` 800 | 25:35 | 41,7 % | 6:11 | 0,332 | überwiegend nein |

Der 800er-Lauf ist damit **kein** Beleg für Neutralität. Ein Lauf, der gegen
50 % driftet, weil A ≈ B wird, misst nur, dass der Parameter nichts mehr tut.
Der belastbare Befund bleibt der erste: bei kommensurabler Skala verliert das
Netz mit 35 % (p = 0,003). `netMaxBlend` bleibt 0.

### Der eigentliche Fund: die Heuristik ist an der Spitze indifferent

Die Gap-Spalte ist das Interessante. Der Abstand zwischen bestem und
zweitbestem Heuristikzug ist in Eröffnung und Mittelspiel praktisch **null**
(0,0 / 0,5 / 0,4 / 0,2 / 0,0), während die Spanne zum Median bei 45 bis 236
liegt. Die Heuristik hat also eine breite Rangfolge, ist aber an ihrer Spitze
unentschieden.

Folge: der Prior entscheidet die Zugwahl dort bei **jeder** Skala — er muss nur
einen Bruchteil eines Punktes beitragen, um die Reihenfolge der Top-Züge zu
kippen. Deshalb zählte der Harness auch im 800er-Lauf noch 9394 von 19384
Vorwärtsläufen als „mit Wirkung auf die Zugwahl". Ein Netz mit Top-1 1,2 %
entscheidet damit genau dort, wo die Heuristik keine Meinung hat — und was es
dort einbringt, ist fast Zufall.

Die untere Kante ist rechnerisch klar: um nur Gleichstände zu brechen, ohne
echte Heuristikunterschiede zu überschreiben, genügt eine Skala von **≈ 20**
(Gap-Spalte), ab dem Endspiel steigend auf ≈ 1000–4600.

### Die Dosis-Wirkungs-Kurve — damit ist Kalibrierung erschöpft

Genau diese Gap-kalibrierte Stufe wurde gefahren: `netScoreScale=20`,
ab Zug 250 auf 1000. Der Phasenwechsel griff 55-mal, die Stufe war also
wirksam.

| Skala | Spiele A:B | Siegrate A | Paar-Bilanz | p | Gebiet am Ende (A) |
|---|---|---|---|---|---|
| 5000 (2 Läufe) | 42:78 | 35,0 % | 8:26 | 0,003 | −7 bis −16 |
| 800 | 25:35 | 41,7 % | 6:11 | 0,332 | −9,4 |
| 20 → 1000 ab Zug 250 | 28:32 | 46,7 % | 8:10 | 0,815 | −0,7 |

**Die Kurve ist monoton und läuft von unten gegen 50 %.** Je kleiner der
Netzeinfluss, desto näher am Break-even — und der Grenzwert bei Dosis 0 ist
definitionsgemäß 50 %, weil A dann zu B wird.

Das ist der Schluss des Kapitels: **wäre die Skala nur falsch eingestellt,
müsste irgendeine Zwischendosis über 50 % schießen.** Über eine
250-fache Spannweite (20 bis 5000) tut es keine. Das beste Ergebnis ist
dasjenige, bei dem das Netz fast nichts tut. Ein Prior mit nutzbarem Signal
verhält sich nicht so; ein Prior ohne nutzbares Signal genau so — Schaden
proportional zur Dosis, kein Optimum dazwischen.

Kalibrierung ist damit als Erklärung **erschöpft**, nicht offen. Der Engpass
ist die Kopfgüte: Top-1 1,2 % entscheidet dort, wo die Heuristik indifferent
ist (Gap ≈ 0), und bringt dort fast Zufall ein.

**Konsequenz für die 277 Partien.** Sie würden jetzt nur noch klären, ob
Skala 20 bei 46,7 % oder bei 50 % liegt — eine Frage ohne Handlung dahinter,
denn `netMaxBlend` bleibt in beiden Fällen 0. Die Rechenzeit ist besser in
Kopfgüte investiert (andere Architektur) als in die genauere Vermessung einer
Dosis, deren bester Fall „nicht von Ausschalten zu unterscheiden" ist.

**Warum die 277 Partien entfallen — und zwar nicht aus Kostengründen.**
Rein statistisch wären sie nötig: 41,7 % gegen 50 % mit 80 % Power braucht
≈ 277 Partien = 138 Paare ≈ 6,1 h, für 45 % wären es 776 Partien ≈ 17 h.

Entscheidend ist aber, **welche Frage** sie beantworten sollten. Aus
Siegquoten lässt sich die **Kurvenform** rekonstruieren — steigt sie noch,
oder liegt der Peak schon dahinter? Genau dafür wurde bei `mctsValueScale`
über sieben Skalenpunkte gemessen (Plateau 150–250, `ab-harness.js:233`), und
genau dafür braucht man viele Partien, weil Form aus verrauschten Quoten
zusammengesetzt werden muss.

Diese Frage ist hier nicht mehr offen, weil der tragende Befund **keine
Siegquote** ist. Der Gap von 0,0–0,5 kommt aus einer direkten Messung der
`evaluateMove`-Scores an der Entscheidungsgrenze (`spanne_check.js`) — er ist
strukturell, nicht statistisch, und wird durch mehr Partien nicht sicherer.
Dieselbe Art von Beleg wie bei `scoreWeight`, das die Summe der Blend-Gewichte
„unbemerkt von 1 abweichen" ließ (`index.html:3631`): auch das wurde durch
Hinsehen im Code entschieden, nicht durch Partien.

Die Begründung ist damit von „Kurvenform, die mehr Daten braucht" auf
„Mechanismus, der bereits feststeht" gewechselt. Der Lauf entfällt nicht,
weil er sich nicht lohnt, sondern weil seine Frage beantwortet ist. Wer die
Sache weiterbringen will, hebt die Kopfgüte — das ändert den Mechanismus,
nicht nur die Fehlerbalken um ihn herum.

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
Ziele und Gradient funktionieren. Was fehlt, ist **Datenmenge** — nicht
Kapazität (siehe unten, das war hier zunächst falsch benannt).

### Der Engpass ist die Datenmenge, und das ist gemessen

Die Kapazitätsrechnung: `3971→128→361` hat 508 288 + 46 208 + 489 =
**554 985 Parameter**, trainiert wurde auf 56 363 Beispielen. Das sind
**9,8× mehr Parameter als Beispiele** — Kapazität ist im Überschuss, nicht
knapp. Eine frühere Fassung dieser Datei nannte „Kapazität und Datenmenge";
der erste Teil war falsch.

`datenkurve.py` misst die Abhängigkeit direkt. Testsatz sind dieselben 5000
Zeilen wie im Referenzlauf, Hyperparameter identisch (`lr 0.5`, 40 Epochen),
Trainingsdaten aus `train/`-Shards:

| Trainingszeilen | Top-1 | Top-10 | Ø Rang | Trainingsverlust |
|---|---|---|---|---|
| 15 000 | 0,40 % | 3,74 % | 163,7 | 1,85 |
| 30 000 | 0,52 % | 4,00 % | 156,8 | 3,64 |
| 60 000 | 0,68 % | 6,10 % | 137,1 | 3,21 |
| 120 000 | 1,20 % | 8,94 % | 125,7 | 4,10 |

Monoton in allen drei Kennzahlen, **ohne Plateau**. Über 8× Daten verdreifacht
sich Top-1, Top-10 wird 2,4-mal so groß, und der letzte Verdopplungsschritt
bringt den größten Sprung (+0,52 Prozentpunkte gegen +0,16 davor) — die Kurve
sättigt nicht.

Die Verlustspalte ist der zweite, unabhängige Beleg und liest sich zunächst
falsch: der Trainingsverlust **steigt** von 1,85 auf 4,10, während die
Testwerte besser werden. Bei 15 000 Zeilen ist Verlust 1,85 gegen
`ln(361) = 5,89` bereits Memorieren — und die Testleistung liegt mit 0,40 %
knapp über der Zufallserwartung von 0,28 %. Auswendiglernen bei
Zufallsniveau im Test ist der Lehrbuchbefund für ein überparametrisiertes
Netz. Ab 120 000 Zeilen kann es nicht mehr memorieren und lernt Übertragbares.

**Verfügbar sind 8160 `train/`-Shards gegen 20 in `val/`, und sie sind
ungleich groß** — das ist der Grund, warum ein einzelner train-Shard die
Obergrenze von 120 000 Zeilen allein füllte:

| Shard | Zeilen gesamt | davon 19×19 nutzbar |
|---|---|---|
| `val/data0_0` | 21 830 | 15 388 |
| `train/data0_0_0` | 498 535 | 348 571 |

Ein train-Shard trägt also 22,7× so viel wie ein val-Shard. Hochgerechnet auf
8160 Shards (nur Shard 0 gemessen) sind das rund **2,8 Milliarden** nutzbare
Stellungen; die 61 363 Zeilen des Referenzlaufs entsprechen etwa **0,002 %**
davon. `decode.py` hatte die Konstante `TRAIN` von Anfang an definiert,
`bauen()` hat sie nie benutzt.

Die Hochrechnung von einem Shard auf 8160 stützt sich darauf, dass der
**nutzbare Anteil in beiden Klassen fast gleich ist**: 15 388/21 830 = 70,5 %
gegen 348 571/498 535 = 69,9 %. Die 22,7× sind ein reiner Größenunterschied
der Shards, kein Unterschied in der Zusammensetzung — die
Brettgrößenverteilung ist dieselbe. Als Größenordnungsaussage trägt die Zahl
damit; als exakte Bestandsangabe nicht, dafür ist nur ein train-Shard gezählt.

### Was der Bestand an Speicher kostet — und warum daraus Streaming folgt

Der Merkmalsvektor hat 3971 Einträge, im Median **788 Nichtnullen** (632 bis
1155), und nimmt nur **10 verschiedene Werte** an (Vielfache von 1/19). Die
Quantisierung auf uint8 ist damit **verlustfrei**, nicht approximativ:

| Format | B/Zeile | Faktor | 2,8 Mrd Zeilen |
|---|---|---|---|
| dicht `float32` | 15 884 | 1× | **45 TB** |
| sparse `uint16`-Index + `float32` | 4 728 | 3,4× | 13 TB |
| sparse `uint16`-Index + `uint8` | 2 364 | 6,7× | 7 TB |

Daraus folgt die Aufteilung, und sie ist kein Entweder-oder: **Streaming ist
der einzige Weg für den vollen Bestand** — auch sparse bleibt im TB-Bereich,
also weit jenseits jedes RAM. **Sparse ist das Format für den
Arbeitsausschnitt**: bei 6 B je Nichtnull sind 1 Mio Zeilen 4,7 GB und 2 Mio
Zeilen 9,5 GB, 10 Mio wären es nicht mehr.

`train.py` hält heute alles im RAM und ist bei 120 000 Zeilen am Ende — das
sind **0,004 %** des Bestands, rund vier Größenordnungen darunter. Jede
Änderung Richtung Streaming verschiebt diese Wand; ein A/B braucht sie nicht
zur Rechtfertigung, weil sie nur den Durchsatz betrifft und nicht die
Spielweise. Gemessen werden muss erst das Netz, das dabei herauskommt.

Zwei Vorbehalte, vorab notiert:

- Es sind Einzelmessungen der letzten Epoche. Top-1 schwankte im Referenzlauf
  zwischen Epoche 33 und 40 von 0,94 % bis 1,52 %; die einzelnen Punkte tragen
  also ±0,25 Prozentpunkte. Die Monotonie über 8× Spannweite trägt trotzdem.
- Die Absolutwerte sind **nicht** direkt mit dem Referenzlauf vergleichbar.
  Der trainierte auf val-Shards, diese Kurve auf train-Shards, bei identischem
  Testsatz. Dass 60 000 train-Zeilen nur 0,68 % erreichen, wo 56 363
  val-Zeilen 1,2 % ergaben, kann Verteilungsunterschied zwischen den
  Verzeichnissen sein oder Epochenrauschen — ungeklärt.

**Keine Spielstärkemessung.** Die Kurve sind Trainingskennzahlen; ob ein Netz
mit 120 000 Zeilen der Engine hilft, ist nicht gemessen. Nach der
Dosis-Wirkungs-Kurve wäre das erst sinnvoll, wenn Top-1 um Größenordnungen
steigt, nicht um Prozente.

**Die höchste Hebelwirkung liegt damit in der Datenpipeline**, nicht in
Merkmalsform oder Kapazität. Der bindende Engpass ist jetzt Speicher:
3971 float32 je Zeile sind 1,9 GB für 120 000 Zeilen, und `train.py` hält
alles im RAM. Bei 650–1100 Nichtnullen von 3971 wäre eine dünn besetzte
Darstellung rund 4× sparsamer; alternativ Minibatches von Platte streamen.
Beides ist überschaubar, aber ungebaut.

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
