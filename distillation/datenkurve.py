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
# Pro Epoche messen, nicht nur am Ende. Ein Endwert allein ist eine
# Einzelziehung aus einer schwankenden Groesse — im Referenzlauf lag Top-1
# zwischen Epoche 33 und 40 bei 0,94 bis 1,52 %. Der Mittelwert der letzten
# LETZTE Epochen samt Standardabweichung macht aus dem Vorbehalt eine Zahl,
# und die Monotonie muss nicht mehr ueber vier Einzelpunkte argumentiert
# werden. Reines Logging: am Training aendert sich nichts.
EPOCHEN, LETZTE = 40, 10
verlauf = {}
print(f'{"Zeilen":>9} {"Top-1 Ø±SD":>16} {"Top-10 Ø±SD":>16} {"Rang Ø±SD":>14} '
      f'{"Top-1 Ende":>11} {"Verlust":>9}   (Ø über letzte %d Epochen)' % LETZTE)
for n in (15000, 30000, 60000, 120000):
    rng = np.random.default_rng(20260816)
    p = init(rng)
    Xs, Ys = Xt[:n], Yt[:n]
    hist = []
    for e in range(EPOCHEN):
        o = rng.permutation(n)
        v = 0.0; k = 0
        for a in range(0, n, 256):
            j = o[a:a+256]
            if len(j) < 2: continue
            v += schritt(p, Xs[j], Ys[j], 0.5); k += 1
        hist.append((*guete(p, Xv, Yv), v / k))
    verlauf[n] = hist
    a = np.array(hist[-LETZTE:])
    m, s = a.mean(axis=0), a.std(axis=0)
    print(f'{n:>9,} {m[0]:>8.4f}±{s[0]:.4f} {m[1]:>8.4f}±{s[1]:.4f} '
          f'{m[2]:>7.1f}±{s[2]:.1f} {hist[-1][0]:>11.4f} {m[3]:>9.4f}')

# Trennt die Kurve das Rauschen? Nur wenn die Baender nicht ueberlappen.
print('\nUeberlappen die Top-1-Baender benachbarter Punkte (Ø ± 1 SD)?')
ns = sorted(verlauf)
for lo, hi in zip(ns, ns[1:]):
    al = np.array(verlauf[lo][-LETZTE:])[:, 0]
    ah = np.array(verlauf[hi][-LETZTE:])[:, 0]
    getrennt = al.mean() + al.std() < ah.mean() - ah.std()
    print(f'  {lo:>7,} -> {hi:<7,}  {"getrennt" if getrennt else "UEBERLAPPT"}'
          f'   ({al.mean():.4f}±{al.std():.4f} gegen {ah.mean():.4f}±{ah.std():.4f})')
np.savez_compressed('/home/user/Go-/distillation/kurve_verlauf.npz',
                    **{f'n{n}': np.array(v) for n, v in verlauf.items()})
print('\nVerlauf je Epoche -> kurve_verlauf.npz')
