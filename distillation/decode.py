"""KataGo-Shard dekodieren, Mapping PRUEFEN, dann Trainingsdaten bauen.

Aufruf:
    python3 decode.py pruefen  [shard]     nur verifizieren, nichts schreiben
    python3 decode.py bauen    [shard...]  Merkmale + Ziele nach daten.npz

Kanalbelegung aus KataGos eigenem Quelltext (cpp/neuralnet/nninputs.cpp,
fillRowV7), nicht aus Erinnerung:
    0        auf dem Brett
    1, 2     eigene / gegnerische Steine (Sicht des Ziehenden)
    3, 4, 5  genau 1 / 2 / 3 Freiheiten
    6        Ko-Verbote (inkl. Superko)
    9..13    die letzten fuenf Zuege, 9 = der juengste
    14..17   Leiter
    18, 19   aktuelles Territorium
Koordinaten: pos = y * 19 + x  (NNPos::xyToPos, nninputs.h:23) — identisch
zu unserem idx(x, y). Ein Transponierfehler ist damit ausgeschlossen.
"""
import sys, os, numpy as np
from features import board_to_input, liberties, AREA, IN, _NB

REPO = "TomGrc/katago-shuffle-20240527-20260607-zhizi"
LAUF = "shuffleddata/katago_20240527_20260607_zhizi_20260610-150619"
VAL = LAUF + "/val/data0_%d.npz"
TRAIN = LAUF + "/train/data0_%d_0.npz"


def holen(pfad):
    from huggingface_hub import hf_hub_download
    return hf_hub_download(repo_id=REPO, filename=pfad, repo_type="dataset")


def laden(pfad):
    z = np.load(holen(pfad))
    packed = z["binaryInputNCHWPacked"]          # (N, C, ceil(361/8))
    N, C, _ = packed.shape
    bin_ = np.unpackbits(packed, axis=2)[:, :, :AREA]   # (N, C, 361)
    pol = z["policyTargetsNCMove"][:, 0, :].astype(np.int32)  # (N, 362)
    return bin_, pol, C, N


def pruefen(pfad, grenze=3000):
    bin_, pol, C, N = laden(pfad)
    print(f"{pfad}\n  {N} Zeilen, {C} Kanaele, Policy-Ziel {pol.shape}")
    if C != 22:
        print(f"  ! Erwartet wurden 22 Kanaele (V7), gefunden {C} — Belegung neu pruefen.")

    voll = bin_[:grenze, 0, :].sum(axis=1) == AREA     # nur 19x19
    print(f"  19x19-Anteil in den ersten {grenze}: {voll.mean():.3f}")
    idx = np.nonzero(voll)[0]

    ueberlapp = (bin_[idx, 1, :] & bin_[idx, 2, :]).sum()
    print(f"  Punkte gleichzeitig eigen UND gegnerisch: {ueberlapp}  (muss 0 sein)")

    # Kern der Pruefung: Freiheiten SELBST rechnen und gegen Kanal 3/4/5 halten.
    fehl = geprueft = 0
    for r in idx[:400]:
        board = np.zeros(AREA, dtype=np.int8)
        board[bin_[r, 1, :] == 1] = 1
        board[bin_[r, 2, :] == 1] = 2
        libs = liberties(board)
        for k, erwartet in ((3, 1), (4, 2), (5, 3)):
            mein = ((libs == erwartet) & (board != 0)).astype(np.uint8)
            if not np.array_equal(mein, bin_[r, k, :]):
                fehl += 1
                if fehl <= 3:
                    d = np.nonzero(mein != bin_[r, k, :])[0]
                    print(f"  ! Zeile {r}, Kanal {k}: {len(d)} Abweichungen, "
                          f"erste Punkte {d[:6].tolist()}")
        geprueft += 1
    print(f"  Freiheiten nachgerechnet: {geprueft} Stellungen, {fehl} Abweichungen")

    # Kanal 9 soll der juengste Zug sein: der Punkt gehoert dann dem GEGNER.
    hat9 = bin_[idx, 9, :].sum(axis=1)
    eins = idx[hat9 == 1]
    if len(eins):
        p = bin_[eins, 9, :].argmax(axis=1)
        gegner = bin_[eins, 2, :][np.arange(len(eins)), p].mean()
        eigen = bin_[eins, 1, :][np.arange(len(eins)), p].mean()
        print(f"  Kanal 9 (juengster Zug): gegnerisch besetzt {gegner:.3f}, "
              f"eigen {eigen:.3f}  (erwartet: gegnerisch nahe 1)")

    # Policy-Ziel muss auf einen leeren Punkt zeigen (oder Pass = 361).
    zug = pol[idx].argmax(axis=1)
    kein_pass = zug < AREA
    besetzt = bin_[idx][kein_pass, 1:3, :].sum(axis=1)[
        np.arange(kein_pass.sum()), zug[kein_pass]]
    print(f"  Policy-Ziel: Pass-Anteil {1 - kein_pass.mean():.3f}, "
          f"auf besetztem Punkt {besetzt.mean():.4f}  (muss 0 sein)")
    print(f"  Policy-Summe 0 (unbrauchbare Zeilen): "
          f"{(pol[idx].sum(axis=1) == 0).mean():.4f}")


def bauen(pfade, ziel="daten.npz", max_zeilen=200000):
    X, Y = [], []
    for pfad in pfade:
        bin_, pol, C, N = laden(pfad)
        voll = bin_[:, 0, :].sum(axis=1) == AREA
        for r in np.nonzero(voll)[0]:
            if len(X) >= max_zeilen:
                break
            if pol[r].sum() <= 0:
                continue
            zug = int(pol[r].argmax())
            if zug >= AREA:
                continue                      # Pass ist kein Wurzelzug fuer uns
            board = np.zeros(AREA, dtype=np.int8)
            board[bin_[r, 1, :] == 1] = 1
            board[bin_[r, 2, :] == 1] = 2
            ko = np.nonzero(bin_[r, 6, :])[0]
            l9 = np.nonzero(bin_[r, 9, :])[0]
            X.append(board_to_input(board, 1,
                                    int(l9[0]) if len(l9) == 1 else None,
                                    int(ko[0]) if len(ko) == 1 else None))
            Y.append(zug)
        print(f"  {pfad}: gesamt {len(X)} Zeilen")
        if len(X) >= max_zeilen:
            break
    Xa = np.asarray(X, dtype=np.float32)
    Ya = np.asarray(Y, dtype=np.int32)
    np.savez_compressed(ziel, X=Xa, Y=Ya)
    print(f"{ziel}: X {Xa.shape} {Xa.dtype}, Y {Ya.shape}")


if __name__ == "__main__":
    was = sys.argv[1] if len(sys.argv) > 1 else "pruefen"
    rest = sys.argv[2:]
    if was == "pruefen":
        pruefen(rest[0] if rest else VAL % 0)
    elif was == "bauen":
        bauen(rest if rest else [VAL % i for i in range(4)])
    else:
        print(__doc__)
        sys.exit(2)
