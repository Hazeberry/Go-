"""KataGo-Shard dekodieren, Mapping PRUEFEN, dann Trainingsdaten bauen.

Aufruf:
    python3 decode.py pruefen  [shard]     nur verifizieren, nichts schreiben
    python3 decode.py selbsttest           pruefen gegen selbst gebaute Shards
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
from features import board_to_input, liberties, AREA, IN, SIZE, _NB

REPO = "TomGrc/katago-shuffle-20240527-20260607-zhizi"
LAUF = "shuffleddata/katago_20240527_20260607_zhizi_20260610-150619"
VAL = LAUF + "/val/data0_%d.npz"
TRAIN = LAUF + "/train/data0_%d_0.npz"


def holen(pfad):
    if os.path.exists(pfad):          # selbst gebauter Shard, kein Netz noetig
        return pfad
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

    ueberlapp = int((bin_[idx, 1, :] & bin_[idx, 2, :]).sum())
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
    return {"zeilen": int(N), "kanaele": int(C), "geprueft": int(geprueft),
            "fehl": int(fehl), "ueberlapp": ueberlapp,
            "besetzt": float(besetzt.mean()) if kein_pass.sum() else 0.0}


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


# ---------------------------------------------------------------------------
# Selbsttest: pruefen() gegen selbst gebaute Shards im V7-Format.
#
# Er beantwortet NICHT, ob KataGos Kanaele so belegt sind wie oben notiert —
# das kann nur ein echter Shard. Er beantwortet die Frage davor: schlaegt die
# Gegenrechnung ueberhaupt an, wenn die Belegung falsch ist? Ohne diese
# Antwort waere ein stilles "0 Abweichungen" auf echten Daten wertlos, weil
# eine Pruefung, die nie etwas findet, genauso aussieht.
#
# Deshalb laufen zwei Shards durch: ein sauberer, bei dem die Pruefung
# schweigen muss, und ein absichtlich verdorbener mit vertauschten
# Koordinaten (x/y) in Kanal 3, bei dem sie anschlagen muss.
# ---------------------------------------------------------------------------

def _libs_unionfind(board):
    """Freiheiten per Union-Find — bewusst ein anderer Algorithmus als
    features.liberties (Flutfuellung). Wuerden beide denselben Fehler machen,
    zeigte die Gegenrechnung nur auf sich selbst."""
    eltern = list(range(AREA))

    def wurzel(a):
        while eltern[a] != a:
            eltern[a] = eltern[eltern[a]]
            a = eltern[a]
        return a

    for i in range(AREA):
        if board[i] == 0:
            continue
        for n in _NB[i]:
            if board[n] == board[i]:
                ra, rb = wurzel(i), wurzel(n)
                if ra != rb:
                    eltern[ra] = rb

    frei = {}
    for i in range(AREA):
        if board[i] == 0:
            continue
        menge = frei.setdefault(wurzel(i), set())
        for n in _NB[i]:
            if board[n] == 0:
                menge.add(n)

    libs = np.zeros(AREA, dtype=np.int32)
    for i in range(AREA):
        if board[i] != 0:
            libs[i] = len(frei[wurzel(i)])
    return libs


def _stellung(rng, steine):
    """Zufaellige Stellung ohne Gruppen mit null Freiheiten — die gibt es auf
    einem echten Brett nicht, und KataGo schreibt sie folglich nie."""
    board = np.zeros(AREA, dtype=np.int8)
    punkte = rng.permutation(AREA)[:steine]
    board[punkte[0::2]] = 1
    board[punkte[1::2]] = 2
    while True:
        libs = _libs_unionfind(board)
        tot = (board != 0) & (libs == 0)
        if not tot.any():
            return board, libs
        board[tot] = 0


def _shard_bauen(pfad, zeilen=64, seed=7, vergiftet=False):
    """Schreibt einen Shard mit genau den Schluesseln und Formen, die KataGo
    schreibt: gepackte Bits (N, 22, 46) und policyTargetsNCMove (N, 1, 362).

    Gibt zurueck, in wie vielen Zeilen Kanal 3 ueberhaupt gesetzt ist. Nur
    diese koennen eine Koordinatenvertauschung verraten — ein leerer Kanal
    sieht transponiert genauso aus wie vorher."""
    rng = np.random.default_rng(seed)
    bits = np.zeros((zeilen, 22, AREA), dtype=np.uint8)
    pol = np.zeros((zeilen, 1, AREA + 1), dtype=np.int16)
    for r in range(zeilen):
        board, libs = _stellung(rng, int(rng.integers(20, 200)))
        bits[r, 0, :] = 1                       # ganzes 19x19-Brett
        bits[r, 1, :] = (board == 1)            # eigene Steine
        bits[r, 2, :] = (board == 2)            # gegnerische
        for k, wert in ((3, 1), (4, 2), (5, 3)):
            m = ((libs == wert) & (board != 0)).astype(np.uint8)
            if vergiftet and k == 3:
                m = m.reshape(SIZE, SIZE).T.reshape(AREA)   # x und y vertauscht
            bits[r, k, :] = m
        gegner = np.nonzero(board == 2)[0]
        if len(gegner):                         # Kanal 9: der juengste Zug
            bits[r, 9, int(gegner[rng.integers(len(gegner))])] = 1
        leer = np.nonzero(board == 0)[0]        # Policy-Ziel: leerer Punkt
        pol[r, 0, int(leer[rng.integers(len(leer))])] = 100
    np.savez(pfad, binaryInputNCHWPacked=np.packbits(bits, axis=2),
             policyTargetsNCMove=pol)
    return int((bits[:, 3, :].sum(axis=1) > 0).sum())


def selbsttest():
    import tempfile
    verz = tempfile.mkdtemp(prefix="kanalcheck-")
    sauber = os.path.join(verz, "sauber.npz")
    krumm = os.path.join(verz, "krumm.npz")
    _shard_bauen(sauber, vergiftet=False)
    verraeterisch = _shard_bauen(krumm, vergiftet=True)

    print("A) Sauber gebauter Shard — die Pruefung muss schweigen")
    a = pruefen(sauber, grenze=64)
    print()
    print("B) Derselbe Shard, in Kanal 3 x und y vertauscht —")
    print("   die Pruefung muss anschlagen")
    b = pruefen(krumm, grenze=64)

    print()
    fehler = []
    if a["fehl"] or a["ueberlapp"] or a["besetzt"]:
        fehler.append("A haette schweigen muessen")
    if not b["fehl"]:
        fehler.append("B ist unentdeckt durchgelaufen — die Pruefung ist blind")
    if fehler:
        for f in fehler:
            print(f"FEHLGESCHLAGEN: {f}")
        return 1
    print(f"Bestanden: A ohne Befund, B mit {b['fehl']} von hoechstens "
          f"{verraeterisch} moeglichen Abweichungen erkannt.")
    print("(In den uebrigen Zeilen steht in Kanal 3 nichts — die sind unter")
    print(" Vertauschung mit sich selbst identisch und koennen nichts zeigen.)")
    print("Die Gegenrechnung schlaegt bei falscher Belegung an. Was sie zu")
    print("KataGos echten Kanaelen sagt, entscheidet erst ein echter Shard:")
    print("  sh netzcheck.sh && python3 decode.py pruefen")
    return 0


if __name__ == "__main__":
    was = sys.argv[1] if len(sys.argv) > 1 else "pruefen"
    rest = sys.argv[2:]
    if was == "pruefen":
        pruefen(rest[0] if rest else VAL % 0)
    elif was == "selbsttest":
        sys.exit(selbsttest())
    elif was == "bauen":
        bauen(rest if rest else [VAL % i for i in range(4)])
    else:
        print(__doc__)
        sys.exit(2)
