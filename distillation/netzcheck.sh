#!/bin/sh
# Sagt genau, WELCHE Hosts in der Allowlist fehlen — statt nur "geht nicht",
# und statt nur den ersten zu nennen.
#
# Warum alle auf einmal: die Shards liegen nicht auf huggingface.co selbst.
# Der resolve-Pfad antwortet mit einer Weiterleitung auf ein CDN, und dieser
# zweite Host braucht die Freigabe genauso. Eine laufende Session behaelt die
# Policy, mit der sie gestartet ist — wer die Hosts einzeln nachtraegt,
# bezahlt jeden mit einer weiteren Session. Deshalb wird hier nicht beim
# ersten Fehlschlag abgebrochen, sondern die vollstaendige Liste ausgegeben.
set -u
REPO=TomGrc/katago-shuffle-20240527-20260607-zhizi
PFAD=shuffleddata/katago_20240527_20260607_zhizi_20260610-150619/val/data0_0.npz
URL="https://huggingface.co/datasets/$REPO/resolve/main/$PFAD"

# Metadaten-Host, Kurzform, und die Auslieferungswege, die der Hub heute
# benutzt (klassisches CDN und Xet). Welcher davon zum Zug kommt, entscheidet
# der Hub zur Laufzeit — freigegeben sein muessen sie deshalb alle.
HOSTS="huggingface.co hf.co cdn-lfs.huggingface.co cdn-lfs-us-1.hf.co transfer.xethub.hf.co cas-bridge.xethub.hf.co"

FEHLEN=""
echo "1) Erreichbarkeit der bekannten Hosts"
for h in $HOSTS; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://$h/" 2>/dev/null)
  if [ "$code" = "000" ]; then
    echo "  FEHLT   $h  (kein Verbindungsaufbau — Policy blockiert diesen Host)"
    FEHLEN="$FEHLEN $h"
  else
    echo "  ok      $h  (HTTP $code)"
  fi
done

if [ -n "$FEHLEN" ]; then
  echo
  echo "In die Allowlist eintragen — alle auf einmal, nicht nacheinander:"
  for h in $FEHLEN; do echo "  $h"; done
  echo
  echo "Danach eine FRISCHE Session starten: ein laufender Container behaelt"
  echo "die Policy, mit der er gestartet ist."
  echo
  echo "Ohne Netz laesst sich immerhin pruefen, ob die Pruefung Zaehne hat:"
  echo "  python3 decode.py selbsttest"
  exit 1
fi

echo
echo "2) Weiterleitungsziel des eigentlichen Downloads"
ZIEL=$(curl -sSI --max-time 20 "$URL" 2>/dev/null \
       | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}' | tail -1)
if [ -z "$ZIEL" ]; then
  echo "  keine Weiterleitung gemeldet — dann laedt huggingface.co direkt aus."
else
  CDN_HOST=$(printf '%s' "$ZIEL" | sed -e 's|^https\{0,1\}://||' -e 's|/.*$||')
  echo "  Weiterleitung nach: $CDN_HOST"
  case " $HOSTS " in
    *" $CDN_HOST "*) ;;
    *) code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://$CDN_HOST/" 2>/dev/null)
       if [ "$code" = "000" ]; then
         echo
         echo "Neuer, oben nicht gelisteter Auslieferungshost. Zusaetzlich"
         echo "eintragen:  $CDN_HOST"
         exit 1
       fi
       echo "  ok      $CDN_HOST  (HTTP $code)" ;;
  esac
fi

echo
echo "3) Echter Teil-Download (erste 64 KB)"
BYTES=$(curl -sSL -r 0-65535 --max-time 60 -o /dev/null -w '%{size_download}' "$URL" 2>/dev/null)
echo "  $BYTES Bytes geladen"
[ "${BYTES:-0}" -gt 1000 ] || { echo "  zu wenig — Download blockiert."; exit 1; }

echo
echo "Alles frei. Weiter mit:  python3 decode.py pruefen"
