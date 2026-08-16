"""Ueberwachtes Training des PolicyNet in numpy, Export im Browser-Format.

    python3 train.py daten.npz gewichte.json [--epochen N] [--lr X] [--batch B]

Ziel ist der gespielte bzw. gesuchte Zug (Kreuzentropie), NICHT der +/-Reward
der bisherigen Selbstspielregel — die hat nachweislich nichts gelernt.

Die Gewichte werden exakt so abgelegt, wie PolicyNet.save() sie schreibt:
JSON mit base64 der rohen Float32-Puffer, W1[j*IN + i] und W2[k*HID + j].
Damit laedt sie sowohl der Browser (localStorage 'go_pnet') als auch der
Harness (--net).

Unterschied zur JS-Regel, bewusst und benannt: hier wird in Minibatches
gerechnet statt Beispiel fuer Beispiel. Das ist dieselbe Zielfunktion, aber
ein anderer Optimierungspfad — die Lernrate ist deshalb nicht 1:1 mit netLR
im Dashboard vergleichbar.
"""
import sys, json, base64, numpy as np

IN, HID, OUT = 3971, 128, 361


def init(rng):
    he = lambda n: np.sqrt(2.0 / n)
    return {
        "W1": (rng.random((HID, IN), dtype=np.float32) * 2 - 1) * np.float32(he(IN)),
        "b1": np.zeros(HID, dtype=np.float32),
        "W2": (rng.random((OUT, HID), dtype=np.float32) * 2 - 1) * np.float32(he(HID)),
        "b2": np.zeros(OUT, dtype=np.float32),
    }


def vorwaerts(p, X):
    h = X @ p["W1"].T + p["b1"]
    np.maximum(h, 0, out=h)
    z = h @ p["W2"].T + p["b2"]
    z -= z.max(axis=1, keepdims=True)
    np.exp(z, out=z)
    z /= z.sum(axis=1, keepdims=True)
    return h, z


def schritt(p, X, y, lr):
    h, probs = vorwaerts(p, X)
    B = len(y)
    dZ = probs.copy()
    dZ[np.arange(B), y] -= 1.0
    dZ /= B
    dH = (dZ @ p["W2"]) * (h > 0)
    p["W2"] -= lr * (dZ.T @ h)
    p["b2"] -= lr * dZ.sum(axis=0)
    p["W1"] -= lr * (dH.T @ X)
    p["b1"] -= lr * dH.sum(axis=0)
    return float(-np.log(np.maximum(probs[np.arange(B), y], 1e-12)).mean())


def guete(p, X, y, block=4096):
    """Top-1/Top-10 und mittlerer Rang des Zielzugs — dieselbe Kennzahl wie im
    JS-Test, damit die Zahlen vergleichbar bleiben."""
    t1 = t10 = 0
    rang = 0
    for a in range(0, len(y), block):
        _, probs = vorwaerts(p, X[a:a + block])
        yy = y[a:a + block]
        eigen = probs[np.arange(len(yy)), yy][:, None]
        r = (probs > eigen).sum(axis=1) + 1
        rang += int(r.sum())
        t1 += int((r == 1).sum())
        t10 += int((r <= 10).sum())
    n = len(y)
    return t1 / n, t10 / n, rang / n


def speichern(p, pfad, spiele, siege):
    enc = lambda a: base64.b64encode(np.ascontiguousarray(a, dtype=np.float32).tobytes()).decode()
    json.dump({"W1": enc(p["W1"].reshape(-1)), "b1": enc(p["b1"]),
               "W2": enc(p["W2"].reshape(-1)), "b2": enc(p["b2"]),
               "games": spiele, "wins": siege}, open(pfad, "w"))


def main():
    daten, ziel = sys.argv[1], sys.argv[2]
    rest = sys.argv[3:]
    hol = lambda name, std, typ: typ(rest[rest.index(name) + 1]) if name in rest else std
    epochen = hol("--epochen", 8, int)
    lr = hol("--lr", 0.05, float)
    batch = hol("--batch", 256, int)

    d = np.load(daten)
    X, Y = d["X"].astype(np.float32), d["Y"].astype(np.int64)
    n_val = max(1, min(5000, len(Y) // 10))
    Xv, Yv, Xt, Yt = X[:n_val], Y[:n_val], X[n_val:], Y[n_val:]
    print(f"{len(Yt)} Trainings-, {len(Yv)} Testzeilen · lr {lr} · Batch {batch}")

    rng = np.random.default_rng(20260816)
    p = init(rng)
    t1, t10, r = guete(p, Xv, Yv)
    print(f"  vor Training   Top-1 {t1:.4f}  Top-10 {t10:.4f}  Ø Rang {r:.1f}")

    for e in range(1, epochen + 1):
        ordn = rng.permutation(len(Yt))
        verlust = 0.0
        schritte = 0
        # Auch den letzten, unvollstaendigen Batch mitnehmen. Vorher lief die
        # Schleife bei weniger Zeilen als Batchgroesse GAR NICHT und meldete
        # trotzdem "Verlust 0.0000" — ein Training, das nichts tut und dabei
        # gesund aussieht. Aufgefallen bei 252 Zeilen mit Batch 256.
        for a in range(0, len(ordn), batch):
            j = ordn[a:a + batch]
            if len(j) < 2:
                continue
            verlust += schritt(p, Xt[j], Yt[j], lr)
            schritte += 1
        if schritte == 0:
            raise SystemExit(f"Kein Trainingsschritt moeglich: {len(Yt)} Zeilen. "
                             f"Mehr Daten oder kleineres --batch.")
        t1, t10, r = guete(p, Xv, Yv)
        print(f"  Epoche {e:2d}     Top-1 {t1:.4f}  Top-10 {t10:.4f}  Ø Rang {r:.1f}"
              f"   Verlust {verlust / schritte:.4f}   ({schritte} Schritte)")

    speichern(p, ziel, spiele=max(2, epochen), siege=epochen // 2)
    print(f"Gewichte → {ziel}")


if __name__ == "__main__":
    main()
