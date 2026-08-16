import json, os, numpy as np
from features import board_to_input
from train import vorwaerts
import base64
d = os.path.dirname(os.path.abspath(__file__))
w = json.load(open(os.path.join(d, 'gewichte.json')))
dec = lambda s, shape: np.frombuffer(base64.b64decode(s), dtype=np.float32).reshape(shape)
p = {"W1": dec(w["W1"], (128, 3971)), "b1": dec(w["b1"], (128,)),
     "W2": dec(w["W2"], (361, 128)), "b2": dec(w["b2"], (361,))}
faelle = json.load(open(os.path.join(d, 'boards.json')))
js = json.load(open(os.path.join(d, 'js_probs.json')))
maxd = 0.0
for f, jp in zip(faelle, js):
    X = board_to_input(np.array(f['board'], dtype=np.int8), f['color'], f['lastMove'], f['koPos'])[None, :]
    _, probs = vorwaerts(p, X)
    d0 = float(np.abs(probs[0] - np.array(jp, dtype=np.float32)).max())
    maxd = max(maxd, d0)
    print(f"  n={f['n']:3d}  groesste Abweichung {d0:.3e}  "
          f"argmax numpy {int(probs[0].argmax())} / JS {int(np.argmax(jp))}")
print(f"\nmaximale Abweichung ueber alle Faelle: {maxd:.3e}")
raise SystemExit(0 if maxd < 1e-6 else 1)
