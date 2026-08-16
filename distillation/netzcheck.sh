#!/bin/sh
# Sagt genau, WELCHER Host in der Allowlist fehlt — statt nur "geht nicht".
# Die Shards liegen nicht auf huggingface.co selbst: der resolve-Pfad
# antwortet mit einer Weiterleitung auf ein CDN, und dieser zweite Host
# braucht die Freigabe genauso. Wer nur huggingface.co freigibt, sieht die
# Metadaten und scheitert erst beim Download.
#
# Ein Fehlschlag heisst nicht automatisch "Policy". Ein abgelehnter Proxy,
# ein fehlendes CA-Bundle und ein toter DNS scheitern alle gleich lautlos,
# fuehren aber zu drei verschiedenen Reparaturen. Darum wird curls eigene
# Begruendung mitgelesen und nicht weggeworfen.
set -u
REPO=TomGrc/katago-shuffle-20240527-20260607-zhizi
PFAD=shuffleddata/katago_20240527_20260607_zhizi_20260610-150619/val/data0_0.npz
URL="https://huggingface.co/datasets/$REPO/resolve/main/$PFAD"

FEHLERDATEI=$(mktemp) || exit 1
trap 'rm -f "$FEHLERDATEI"' EXIT INT TERM

# Uebersetzt curls Ausstiegscode plus Meldung in die Reparatur, die wirklich
# noetig ist. Ausgegeben wird beides: die Deutung und der Rohtext.
deuten() {
  rc=$1
  roh=$(tr -d '\r' < "$FEHLERDATEI" | grep -v '^[[:space:]]*$' | tail -1)
  case "$rc" in
    5|56|35)
      case "$roh" in
        *CONNECT*40[0-9]*|*"Received HTTP code"*|*"tunnel failed"*)
          echo "  -> Der Proxy lehnt den Tunnel ab. Das ist die Netzpolicy:"
          echo "     Host gehoert in die Allowlist." ;;
        *certificate*|*CA*|*SSL*|*TLS*)
          echo "  -> Zertifikatsfehler, KEINE Policy. Die Allowlist zu aendern"
          echo "     hilft hier nicht — das CA-Bundle des Proxys fehlt." ;;
        *)
          echo "  -> Verbindung abgebrochen. Rohtext unten beachten." ;;
      esac ;;
    6)
      echo "  -> Der Name loest nicht auf (DNS). Tippfehler im Host oder"
      echo "     kein Resolver — nicht zwingend die Allowlist." ;;
    7)
      echo "  -> Verbindung abgelehnt. Proxy laeuft nicht oder falscher Port." ;;
    28)
      echo "  -> Zeitueberschreitung. Stille Verwerfung sieht so aus; eine"
      echo "     Policy antwortet meist schneller mit einer Ablehnung." ;;
    60|77)
      echo "  -> CA-Bundle nicht nutzbar, KEINE Policy." ;;
    *)
      echo "  -> Unerwarteter curl-Fehler." ;;
  esac
  echo "     curl-Code $rc: ${roh:-keine Meldung}"
}

pruefe() {
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$1" 2>"$FEHLERDATEI")
  rc=$?
  if [ "$rc" != 0 ] || [ "$code" = "000" ]; then
    echo "  FEHLT   $2  (kein Verbindungsaufbau)"
    deuten "$rc"
    return 1
  fi
  echo "  ok      $2  (HTTP $code)"
  return 0
}

echo "1) API-Host"
pruefe "https://huggingface.co/api/datasets/$REPO" "huggingface.co" || {
  echo
  echo "huggingface.co ist nicht erreichbar. Ohne diesen Host geht nichts"
  echo "weiter — und Host Nummer zwei (das CDN) bleibt unbekannt, weil erst"
  echo "die Weiterleitung ihn verraet. Also: freigeben, neu pruefen, dann"
  echo "zeigt Schritt 2 den zweiten Host."
  echo "Wichtig: eine FRISCHE Session starten — ein laufender Container"
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
BYTES=$(curl -sSL -r 0-65535 --max-time 60 -o /dev/null -w '%{size_download}' "$URL" 2>"$FEHLERDATEI")
rc=$?
echo "  ${BYTES:-0} Bytes geladen"
if [ "$rc" != 0 ] || [ "${BYTES:-0}" -le 1000 ]; then
  echo "  zu wenig — Download blockiert."
  deuten "$rc"
  exit 1
fi

echo
echo "Alles frei. Weiter mit:  python3 decode.py pruefen"
