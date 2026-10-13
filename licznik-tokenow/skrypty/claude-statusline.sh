#!/usr/bin/env bash
# Claude Code statusline hook wrapper — zero AI queries, local accounting
DIR="$(cd "$(dirname "$0")" && pwd)"
HDIR="${HDIR:-$(cd "$DIR/../../.." 2>/dev/null && pwd)}"
if [ -f "$DIR/raportuj-tokeny.py" ]; then
  exec python3 "$DIR/raportuj-tokeny.py" "$@"
elif [ -f "/narzedzia/umiejetnosci/licznik-tokenow/skrypty/raportuj-tokeny.py" ]; then
  exec python3 "/narzedzia/umiejetnosci/licznik-tokenow/skrypty/raportuj-tokeny.py" "$@"
elif [ -n "$HDIR" ] && [ -f "$HDIR/umiejetnosci/licznik-tokenow/skrypty/raportuj-tokeny.py" ]; then
  exec python3 "$HDIR/umiejetnosci/licznik-tokenow/skrypty/raportuj-tokeny.py" "$@"
else
  cat >/dev/null
  echo "⚡ tokeny: ok"
fi
