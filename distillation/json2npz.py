"""(Brett, Farbe, letzter Zug, Ko, Zug) → Merkmalsmatrix. Nutzt features.py,
denselben Baustein wie der KataGo-Pfad — die Kette hinter decode.py ist damit
identisch, egal woher die Stellungen kommen."""
import sys, json, numpy as np
from features import board_to_input, IN
quelle, ziel = sys.argv[1], sys.argv[2]
roh = json.load(open(quelle))
X = np.empty((len(roh), IN), dtype=np.float32)
Y = np.empty(len(roh), dtype=np.int32)
for i, r in enumerate(roh):
    X[i] = board_to_input(np.array(r["b"], dtype=np.int8), r["c"], r["l"], r["k"])
    Y[i] = r["z"]
np.savez_compressed(ziel, X=X, Y=Y)
print(f"{ziel}: X {X.shape}, Y {Y.shape}, Zielzuege eindeutig {len(set(Y.tolist()))}")
