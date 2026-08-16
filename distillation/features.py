"""Nachbau von boardToInput (index.html, <script id="policy-net">) in numpy.

Zweck: KataGo-Stellungen in GENAU den Vektor uebersetzen, den unser Netz im
Browser sieht. Der Nachbau ist die Fehlerquelle Nummer eins des ganzen
Vorhabens, deshalb wird er gegen die JS-Fassung geprueft (kata_check.js),
nicht gegen die Beschreibung.

Layout, 3971 Werte (aus dem JS uebernommen, Indizes woertlich):
    0.. 360  eigene Steine
  361.. 721  gegnerische Steine
  722..2165  Freiheiten one-hot 1..4+, INTERLEAVED: 722 + i*4 + (lib-1)
 2166..2526  Atari (genau 1 Freiheit)
 2527..2887  Ko-Punkt
 2888..3248  letzter Zug
 3249..3609  Randabstand min(x,18-x,y,18-y)/9.5
 3610..3970  einfaches eigenes Territorium
"""
import numpy as np

SIZE = 19
AREA = SIZE * SIZE
IN = 3971

# Nachbarn einmal vorberechnen, gleiche Reihenfolge wie NEIGHBORS im JS
_NB = [[] for _ in range(AREA)]
for _y in range(SIZE):
    for _x in range(SIZE):
        _i = _y * SIZE + _x
        if _x > 0:        _NB[_i].append(_i - 1)
        if _x < SIZE - 1: _NB[_i].append(_i + 1)
        if _y > 0:        _NB[_i].append(_i - SIZE)
        if _y < SIZE - 1: _NB[_i].append(_i + SIZE)

_RAND = np.empty(AREA, dtype=np.float32)
for _y in range(SIZE):
    for _x in range(SIZE):
        _RAND[_y * SIZE + _x] = min(_x, SIZE - 1 - _x, _y, SIZE - 1 - _y) / (SIZE / 2)


def liberties(board):
    """Freiheiten je besetztem Punkt, wie floodFill im JS (Gruppenfreiheiten)."""
    libs = np.zeros(AREA, dtype=np.int32)
    seen = np.zeros(AREA, dtype=bool)
    for start in range(AREA):
        if board[start] == 0 or seen[start]:
            continue
        col = board[start]
        stack = [start]
        seen[start] = True
        group = []
        frei = set()
        while stack:
            cur = stack.pop()
            group.append(cur)
            for n in _NB[cur]:
                if board[n] == 0:
                    frei.add(n)
                elif board[n] == col and not seen[n]:
                    seen[n] = True
                    stack.append(n)
        for gpos in group:
            libs[gpos] = len(frei)
    return libs


def board_to_input(board, color, last_move=None, ko_pos=None):
    """board: int8-Array mit 0 leer, 1 schwarz, 2 weiss. color: 1 oder 2.
    last_move: Index oder None. ko_pos: Index oder None."""
    inp = np.zeros(IN, dtype=np.float32)
    opp = 2 if color == 1 else 1

    own_mask = board == color
    opp_mask = board == opp
    inp[0:AREA][own_mask] = 1
    inp[AREA:2 * AREA][opp_mask] = 1

    libs = liberties(board)
    besetzt = board != 0
    lib_klasse = np.clip(libs, 1, 4)
    idx = 722 + np.arange(AREA) * 4 + (lib_klasse - 1)
    inp[idx[besetzt]] = 1

    atari = besetzt & (libs == 1)
    inp[722 + AREA * 4 + np.arange(AREA)[atari]] = 1

    if ko_pos is not None and ko_pos >= 0:
        inp[722 + AREA * 5 + ko_pos] = 1

    if last_move is not None and last_move >= 0:
        inp[722 + AREA * 6 + last_move] = 1

    inp[722 + AREA * 7: 722 + AREA * 8] = _RAND

    # Layer 10: eigener Stein ODER leerer Punkt ohne gegnerischen Nachbarn
    terr = own_mask.copy()
    leer = board == 0
    for i in np.nonzero(leer)[0]:
        if not any(board[n] == opp for n in _NB[i]):
            terr[i] = True
    inp[722 + AREA * 8: 722 + AREA * 9] = terr.astype(np.float32)

    return inp
