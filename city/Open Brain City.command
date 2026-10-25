#!/bin/zsh
# Double-click in Finder to launch the local city window.
set -e
CITY_DIR="${0:A:h}"
CITY_PORT="${BRAIN_CITY_PORT:-8765}"
CITY_VAULT="${BRAIN_CITY_VAULT:-$HOME/Documents/brain}"
CITY_STATE="$HOME/.cache/brain-city"
READER_PORT="${BRAIN_READER_PORT:-8766}"
READER_STATE="$HOME/.cache/brain-reader"
"$CITY_DIR/build.sh"
# The reader stocks the city's article market; with uv it also ranks by meaning (fastembed).
if ! /usr/bin/curl --max-time 2 --silent --fail "http://127.0.0.1:$READER_PORT/api/sources" >/dev/null; then
  mkdir -p "$READER_STATE"
  READER_UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
  if [[ -x "$READER_UV" ]]; then READER_RUN=("$READER_UV" run --quiet --with fastembed python3); else READER_RUN=(python3); fi
  nohup "${READER_RUN[@]}" "$CITY_DIR/../reader/server.py" --vault "$CITY_VAULT" --port "$READER_PORT" >"$READER_STATE/server.log" 2>&1 </dev/null &
  disown
fi
if ! /usr/bin/curl --max-time 2 --silent --fail "http://127.0.0.1:$CITY_PORT/api/city" >/dev/null; then
  mkdir -p "$CITY_STATE"
  nohup python3 "$CITY_DIR/server.py" --vault "$CITY_VAULT" --port "$CITY_PORT" --reader "http://127.0.0.1:$READER_PORT" >"$CITY_STATE/server-$CITY_PORT.log" 2>&1 </dev/null &
  disown
  CITY_READY=0
  for CITY_ATTEMPT in {1..30}; do
    if /usr/bin/curl --max-time 1 --silent --fail "http://127.0.0.1:$CITY_PORT/api/city" >/dev/null; then
      CITY_READY=1
      break
    fi
    sleep 0.2
  done
  if [[ "$CITY_READY" != 1 ]]; then
    echo "Brain City не запустилося. Деталі: $CITY_STATE/server-$CITY_PORT.log"
    exit 1
  fi
fi
open "$CITY_DIR/build/Brain City.app"
