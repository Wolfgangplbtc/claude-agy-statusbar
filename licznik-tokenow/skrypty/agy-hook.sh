#!/usr/bin/env bash
# Antigravity (agy) lifecycle hook — zero AI queries, non-blocking
DIR="$(cd "$(dirname "$0")" && pwd)"
HDIR="${HDIR:-$(cd "$DIR/../../.." 2>/dev/null && pwd)}"
STAN_DIR="/narzedzia/stan"
[ -d "$STAN_DIR" ] || [ -z "$HDIR" ] || STAN_DIR="$HDIR/stan"
[ -d "$STAN_DIR" ] || STAN_DIR="$HOME/agent-hub/stan"
[ -d "$STAN_DIR" ] || STAN_DIR="/tmp"

AGENT="${AGENT_NAME:-${AGENT:-$(hostname)}}"
PLIK="$STAN_DIR/tokeny-$AGENT.json"
NOW=$(date +%s)

# Jesli plik jest swiezy (mniej niz 10 minut), natychmiast wyjdz
if [ -f "$PLIK" ]; then
  LAST=$(stat -c %Y "$PLIK" 2>/dev/null || echo 0)
  if [ $((NOW - LAST)) -lt 600 ]; then
    exit 0
  fi
fi

# Jesli brak lub stary, odpal w tle zeby nie blokowac
(
  if command -v agy >/dev/null 2>&1; then
    u=$(timeout 15 agy --print "/usage" 2>/dev/null || true)
    if [ -n "$u" ]; then
      pole() {
        printf '%s\n' "$u" | awk -F'\t' -v g="$1" -v t="$2" -v k="$3" \
          'index($1,g)==1 && index($2,t)==1 {gsub(/%/,"",$k); print $k; exit}'
      }
      gt=$(pole "Gemini" "Weekly" 3);  gto=$(pole "Gemini" "Weekly" 4)
      g5=$(pole "Gemini" "Five" 3);    g5o=$(pole "Gemini" "Five" 4)
      cat <<EOF > "$PLIK.tmp"
{
  "agent": "$AGENT",
  "typ": "agy",
  "pula_5h_zostalo": ${g5:-null},
  "pula_7d_zostalo": ${gt:-null},
  "odnowa_5h": "${g5o:-}",
  "odnowa_7d": "${gto:-}",
  "czas": $NOW,
  "zrodlo": "agy-hook"
}
EOF
      mv "$PLIK.tmp" "$PLIK" 2>/dev/null || true
    fi
  fi
) >/dev/null 2>&1 &

exit 0
