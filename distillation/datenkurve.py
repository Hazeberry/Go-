"""Datenmengen-Kurve: haengt die Kopfguete an der Datenmenge oder an der Form?

    python3 datenkurve.py            # braucht daten_kurve.npz

Aufbau von daten_kurve.npz: die ERSTEN 5000 Zeilen sind der Testsatz und
stammen aus dem val-Build (daten.npz), damit der Vergleich mit dem
Referenzlauf denselben Testsatz benutzt. Alles danach ist Trainingsmaterial
aus train/-Shards:

    import decode, numpy as np
    alt = np.load('daten.npz')
    decode.bauen([decode.TRAIN % i for i in range(12)],
                 ziel='daten_train.npz', max_zeilen=120000)
    neu = np.load('daten_train.npz')
    np.savez_compressed('daten_kurve.npz',
        X=np.concatenate([alt['X'][:5000], neu['X']]),
        Y=np.concatenate([alt['Y'][:5000], neu['Y']]))

Trainiert wird auf geschachtelten Teilmengen mit identischen
Hyperparametern. Steigt Top-1 mit der Datenmenge, ist Datenmangel belegt;
bleibt sie flach, liegt es an der Merkmalsform. Gemessen: monoton steigend
ohne Plateau, siehe README.
"""
import sys, numpy as np
sys.path.insert(0, '/home/user/Go-/distillation')
from train import init, schritt, guete

d = np.load('/home/user/Go-/distillation/daten_kurve.npz')
X, Y = d['X'], d['Y'].astype(np.int64)
Xv, Yv = X[:5000], Y[:5000]          # identisch zum Referenzlauf
Xt, Yt = X[5000:], Y[5000:]
print(f'Testsatz 5000 Zeilen (identisch zum 1,2-%-Referenzlauf), Pool {len(Yt)} Trainingszeilen')
print(f'Zufallserwartung: Top-1 {1/361:.4f}  Top-10 {10/361:.4f}\n')
print(f'{"Trainingszeilen":>15} {"Top-1":>8} {"Top-10":>8} {"Ø Rang":>8} {"Verlust":>9}')
for n in (15000, 30000, 60000, 120000):
    rng = np.random.default_rng(20260816)
    p = init(rng)
    Xs, Ys = Xt[:n], Yt[:n]
    for e in range(40):
        o = rng.permutation(n)
        v = 0.0; k = 0
        for a in range(0, n, 256):
            j = o[a:a+256]
            if len(j) < 2: continue
            v += schritt(p, Xs[j], Ys[j], 0.5); k += 1
    t1, t10, r = guete(p, Xv, Yv)
    print(f'{n:>15,} {t1:>8.4f} {t10:>8.4f} {r:>8.1f} {v/k:>9.4f}')
