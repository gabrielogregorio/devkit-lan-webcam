#!/usr/bin/env bash
# Single runner for the LAN Webcam test suite. Same commands the CI runs.
#
#   ./run-tests.sh                    -> lint + backend (pytest) + web (pnpm: lint, unit, build) + launcher (bash)
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

# ---------- web app (React + TypeScript, pnpm on Node 24) ----------
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ] && ! node --version 2>/dev/null | grep -q '^v24'; then
  # shellcheck disable=SC1091
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1
  nvm use 24 >/dev/null 2>&1
fi
if command -v corepack > /dev/null; then
  PNPM=(corepack pnpm)
  run_layer "web      (install, locked)" "${PNPM[@]}" install --frozen-lockfile --silent
  run_layer "web      (prettier)" "${PNPM[@]}" run --silent format:check
  run_layer "web      (eslint + tsc)" "${PNPM[@]}" run --silent lint
  run_layer "web      (vitest, 100% coverage)" "${PNPM[@]}" run --silent unit:coverage
  run_layer "web      (vite build)" "${PNPM[@]}" run --silent build
else
  RESULTS+=("FAIL  web - Node 24 with corepack not found (nvm install 24)"); FAILED=1
fi

# ---------- launcher (bash + stubs, no sudo, no device) ----------
run_layer "launcher (run.sh stubs)" bash tests/launcher/test_launcher.sh

# ---------- E2E (opt-in) ----------
if [ "${RUN_E2E:-0}" = "1" ]; then
  bar; echo ">> e2e (Playwright, fake camera) - starting serve_mock.py on port $E2E_PORT"; bar
  mkdir -p tmp
  # Its own pairing state and plain-HTTP port: never the PC's real config nor the real server's 9080.
  export LAN_WEBCAM_CONFIG_DIR="$PWD/tmp/e2e-config"
  export E2E_HTTP_PORT="${E2E_HTTP_PORT:-19080}"
  # The LAN address, not localhost: browsers treat http://localhost as secure, a LAN IP is the real plain-HTTP case.
  E2E_LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  PORT="$E2E_PORT" HTTP_PORT="$E2E_HTTP_PORT" "$PY" tests/e2e/serve_mock.py > tmp/e2e-server.log 2>&1 &
  E2E_SRV=$!
  # waits for the server to answer (self-signed https)
  for _ in $(seq 1 30); do
    if curl -ks --max-time 2 "https://localhost:$E2E_PORT/" -o /dev/null; then break; fi
    sleep 0.2
  done
  if E2E_BASE_URL="https://localhost:$E2E_PORT" E2E_HTTP_URL="http://${E2E_LAN_IP:-localhost}:$E2E_HTTP_PORT" PORT="$E2E_PORT" \
    node --test tests/e2e/*.spec.mjs; then
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
