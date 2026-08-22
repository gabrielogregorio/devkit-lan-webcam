#!/usr/bin/env bash
# Runner unico da suite de testes do "Celular como Webcam".
#
#   ./run-tests.sh                  -> backend (pytest) + frontend (node) + launcher (bash)
#   RUN_E2E=1 ./run-tests.sh        -> tambem roda o E2E Playwright (baixa browser; mais lento)
#   RUN_DEVICE_TESTS=1 ./run-tests.sh -> tambem roda o teste opt-in do device real
#
# Caminho padrao: NAO sobe nada na 9443 e NAO encosta no /dev/video10 real.
set -u
cd "$(dirname "$0")"

PY=".venv/bin/python"
E2E_PORT="${PORT:-19443}"
FAILED=0
declare -a RESULTS

bar() { printf '%s\n' "------------------------------------------------------------"; }
run_layer() {  # run_layer <nome> <comando...>
  local name="$1"; shift
  bar; echo ">> $name"; bar
  if "$@"; then RESULTS+=("PASS  $name"); else RESULTS+=("FAIL  $name"); FAILED=1; fi
}

# ---------- backend (pytest, ffmpeg mockado, porta efemera) ----------
run_layer "backend  (pytest)" "$PY" -m pytest tests/backend -q

# ---------- frontend unit (node:test, sem DOM) ----------
run_layer "frontend (node:test view-state)" node --test 'tests/frontend/*.test.mjs'

# ---------- launcher (bash + stubs, sem sudo/sem device) ----------
run_layer "launcher (run.sh stubs)" bash tests/launcher/test_launcher.sh

# ---------- E2E (opt-in) ----------
if [ "${RUN_E2E:-0}" = "1" ]; then
  bar; echo ">> e2e (Playwright, camera fake) — subindo serve_mock.py na porta $E2E_PORT"; bar
  PORT="$E2E_PORT" "$PY" tests/e2e/serve_mock.py >/tmp/webcam-e2e-server.log 2>&1 &
  E2E_SRV=$!
  # espera o servidor responder (https self-signed)
  for _ in $(seq 1 30); do
    if curl -ks "https://localhost:$E2E_PORT/" -o /dev/null; then break; fi
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
  RESULTS+=("SKIP  e2e (Playwright) — RUN_E2E=1 para rodar")
fi

# ---------- device integration (opt-in; ja faz skip dentro do pytest) ----------
if [ "${RUN_DEVICE_TESTS:-0}" = "1" ]; then
  run_layer "device (integration, real /dev/video10)" \
    env RUN_DEVICE_TESTS=1 "$PY" -m pytest tests/backend/test_device_integration.py -q
else
  RESULTS+=("SKIP  device (integration) — RUN_DEVICE_TESTS=1 para rodar")
fi

# ---------- placar ----------
echo ""; bar; echo "PLACAR"; bar
for r in "${RESULTS[@]}"; do echo "  $r"; done
bar
if [ "$FAILED" -eq 0 ]; then echo "TUDO VERDE ✅"; else echo "HOUVE FALHAS ❌"; fi
exit "$FAILED"
