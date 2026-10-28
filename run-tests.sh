#!/usr/bin/env bash
# Single runner for the LAN Webcam test suite. Same commands the CI runs.
#
#   ./run-tests.sh                    -> backend (pytest) + frontend (node) + launcher (bash)
#   RUN_E2E=1 ./run-tests.sh          -> also the Playwright E2E (downloads a browser; slower)
#   RUN_DEVICE_TESTS=1 ./run-tests.sh -> also the opt-in test of the real device
#
# Default path: starts NOTHING on 9443 and does NOT touch the real /dev/video10.
set -u
cd "$(dirname "$0")" || exit

PY=".venv/bin/python"
E2E_PORT="${PORT:-19443}"
FAILED=0
declare -a RESULTS

bar() { printf '%s\n' "------------------------------------------------------------"; }
run_layer() {  # run_layer <name> <command...>
  local name="$1"; shift
  bar; echo ">> $name"; bar
  if "$@"; then RESULTS+=("PASS  $name"); else RESULTS+=("FAIL  $name"); FAILED=1; fi
}

# ---------- lint (ruff from the venv; shellcheck when installed) ----------
run_layer "lint     (ruff)" "$PY" -m ruff check .
if command -v shellcheck > /dev/null; then
  run_layer "lint     (shellcheck)" shellcheck --severity=warning ./*.sh tests/launcher/*.sh
else
  RESULTS+=("SKIP  lint (shellcheck) - sudo apt install shellcheck")
fi

# ---------- backend (pytest, mocked ffmpeg, ephemeral port) ----------
run_layer "backend  (pytest)" "$PY" -m pytest tests/backend -q

# ---------- frontend unit (node:test, no DOM) ----------
run_layer "frontend (node:test view state + i18n)" node --test 'tests/frontend/*.test.mjs'

# ---------- launcher (bash + stubs, no sudo, no device) ----------
run_layer "launcher (run.sh stubs)" bash tests/launcher/test_launcher.sh

# ---------- E2E (opt-in) ----------
if [ "${RUN_E2E:-0}" = "1" ]; then
  bar; echo ">> e2e (Playwright, fake camera) - starting serve_mock.py on port $E2E_PORT"; bar
  mkdir -p tmp
  PORT="$E2E_PORT" "$PY" tests/e2e/serve_mock.py > tmp/e2e-server.log 2>&1 &
  E2E_SRV=$!
  # waits for the server to answer (self-signed https)
  for _ in $(seq 1 30); do
    if curl -ks --max-time 2 "https://localhost:$E2E_PORT/" -o /dev/null; then break; fi
    sleep 0.2
  done
  if E2E_BASE_URL="https://localhost:$E2E_PORT" PORT="$E2E_PORT" node --test 'tests/e2e/*.spec.mjs'; then
    RESULTS+=("PASS  e2e (Playwright)")
  else
    RESULTS+=("FAIL  e2e (Playwright)"); FAILED=1
  fi
  kill "$E2E_SRV" 2>/dev/null
  wait "$E2E_SRV" 2>/dev/null
else
  RESULTS+=("SKIP  e2e (Playwright) - RUN_E2E=1 to run it")
fi

# ---------- device integration (opt-in; pytest also skips it on its own) ----------
if [ "${RUN_DEVICE_TESTS:-0}" = "1" ]; then
  run_layer "device (integration, real /dev/video10)" \
    env RUN_DEVICE_TESTS=1 "$PY" -m pytest tests/backend/test_device_integration.py -q
else
  RESULTS+=("SKIP  device (integration) - RUN_DEVICE_TESTS=1 to run it")
fi

# ---------- scoreboard ----------
echo ""; bar; echo "SCOREBOARD"; bar
for r in "${RESULTS[@]}"; do echo "  $r"; done
bar
if [ "$FAILED" -eq 0 ]; then echo "ALL GREEN ✅"; else echo "FAILURES ❌"; fi
exit "$FAILED"
