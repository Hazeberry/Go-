#!/bin/sh
# Sagt genau, WELCHER Host in der Allowlist fehlt — statt nur "geht nicht".
# Die Shards liegen nicht auf huggingface.co selbst: der resolve-Pfad
# antwortet mit einer Weiterleitung auf ein CDN, und dieser zweite Host
# braucht die Freigabe genauso. Wer nur huggingface.co freigibt, sieht die
# Metadaten und scheitert erst beim Download.
set -u
REPO=TomGrc/katago-shuffle-20240527-20260607-zhizi
PFAD=shuffleddata/katago_20240527_20260607_zhizi_20260610-150619/val/data0_0.npz
URL="https://huggingface.co/datasets/$REPO/resolve/main/$PFAD"

pruefe() {
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$1" 2>/dev/null)
  if [ "$code" = "000" ]; then
    echo "  FEHLT   $2  (kein Verbindungsaufbau — Policy blockiert diesen Host)"
    return 1
  fi
  echo "  ok      $2  (HTTP $code)"
  return 0
}

echo "1) API-Host"
pruefe "https://huggingface.co/api/datasets/$REPO" "huggingface.co" || {
  echo
  echo "huggingface.co ist noch gesperrt. Ohne diesen Host geht nichts weiter."
  echo "Freigeben und eine FRISCHE Session starten — ein laufender Container"
  echo "behaelt die Policy, mit der er gestartet ist."
  exit 1
}

echo
echo "2) Weiterleitungsziel des eigentlichen Downloads"
ZIEL=$(curl -sSI --max-time 20 "$URL" 2>/dev/null \
       | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}' | tail -1)
if [ -z "$ZIEL" ]; then
  echo "  keine Weiterleitung gemeldet — dann laedt huggingface.co direkt aus."
  CDN_HOST=huggingface.co
else
  CDN_HOST=$(printf '%s' "$ZIEL" | sed -e 's|^https\{0,1\}://||' -e 's|/.*$||')
  echo "  Weiterleitung nach: $CDN_HOST"
  pruefe "https://$CDN_HOST/" "$CDN_HOST" || {
    echo
    echo "Der Metadaten-Host ist frei, der Daten-Host nicht. In der Allowlist"
    echo "zusaetzlich eintragen:  $CDN_HOST"
    exit 1
  }
fi

echo
echo "3) Echter Teil-Download (erste 64 KB)"
BYTES=$(curl -sSL -r 0-65535 --max-time 60 -o /dev/null -w '%{size_download}' "$URL" 2>/dev/null)
echo "  $BYTES Bytes geladen"
[ "${BYTES:-0}" -gt 1000 ] || { echo "  zu wenig — Download blockiert."; exit 1; }

echo
echo "Alles frei. Weiter mit:  python3 decode.py pruefen"
