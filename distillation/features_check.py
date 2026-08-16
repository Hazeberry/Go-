import json, numpy as np, os
from features import board_to_input, IN
faelle = json.load(open(os.path.join(os.path.dirname(__file__), 'boards.json')))
gesamt = fehler = 0
for f in faelle:
    ref = np.zeros(IN, dtype=np.float32)
    for i, v in f['nonzero']:
        ref[i] = v
    mein = board_to_input(np.array(f['board'], dtype=np.int8), f['color'],
                          f['lastMove'], f['koPos'])
    d = np.nonzero(np.abs(ref - mein) > 1e-6)[0]
    gesamt += 1
    if len(d):
        fehler += 1
        print(f"  n={f['n']:3d}: {len(d)} Abweichungen, erste Indizes {d[:8].tolist()}")
        for i in d[:5]:
            print(f"      Index {i}: JS {ref[i]:.6f}  numpy {mein[i]:.6f}")
    else:
        print(f"  n={f['n']:3d}: identisch ({int(ref.sum()*100)/100} Summe, "
              f"{int((ref!=0).sum())} Nichtnullen)")
print(f"\n{gesamt} Faelle, {fehler} mit Abweichung")
raise SystemExit(1 if fehler else 0)
