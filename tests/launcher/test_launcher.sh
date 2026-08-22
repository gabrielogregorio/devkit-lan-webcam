#!/usr/bin/env bash
# Testes do launcher run.sh — SEM sudo, SEM subir servidor real, SEM device real.
#
# Estrategia: para cada caso, montamos um "sandbox" temporario com uma COPIA do
# run.sh real e stubs no PATH (pgrep/pkill/hostname/cat/sleep) + um
# .venv/bin/python FALSO que so registra que foi "exec"ado (em vez de subir o
# servidor de verdade). Assim exercitamos o script real sem efeitos colaterais.
#
# Uso:  bash tests/launcher/test_launcher.sh
set -u

REAL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LAUNCHER_SH="$REAL_DIR/run.sh"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
nok()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; echo "         $2"; }

# assert_contains <haystack> <needle> <msg>
assert_contains() { case "$1" in *"$2"*) ok "$3";; *) nok "$3" "esperava conter: '$2' | obtido: '$1'";; esac; }
assert_not_contains() { case "$1" in *"$2"*) nok "$3" "NAO deveria conter: '$2'";; *) ok "$3";; esac; }
assert_eq() { [ "$1" = "$2" ] && ok "$3" || nok "$3" "esperava '$2', obtido '$1'"; }

# ---- monta um sandbox isolado e ecoa o caminho ----
make_sandbox() {
  local sb; sb="$(mktemp -d)"
  cp "$LAUNCHER_SH" "$sb/run.sh"
  : > "$sb/server.py"          # placeholder (o python falso ignora)
  : > "$sb/cert.pem"; : > "$sb/key.pem"   # pula geracao de cert
  : > "$sb/reload-cam.sh"
  mkdir -p "$sb/.venv/bin" "$sb/bin"

  # python FALSO: registra o exec e sai 0 (nao sobe servidor)
  cat > "$sb/.venv/bin/python" <<EOF
#!/usr/bin/env bash
echo "PYTHON_EXEC \$*" >> "$sb/exec.log"
exit 0
EOF
  chmod +x "$sb/.venv/bin/python"

  # stubs no PATH
  cat > "$sb/bin/pgrep" <<EOF
#!/usr/bin/env bash
[ "\${PGREP_RUNNING:-0}" = "1" ] && exit 0 || exit 1
EOF
  cat > "$sb/bin/pkill" <<EOF
#!/usr/bin/env bash
echo "pkill \$*" >> "$sb/pkill.log"
exit 0
EOF
  cat > "$sb/bin/hostname" <<'EOF'
#!/usr/bin/env bash
echo "192.168.0.101"
EOF
  cat > "$sb/bin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cat > "$sb/bin/cat" <<EOF
#!/usr/bin/env bash
case "\$1" in
  *exclusive_caps*) echo "\${EXCLCAPS:-Y,N,N,N}";;
  *) exec /bin/cat "\$@";;
esac
EOF
  chmod +x "$sb/bin/"*
  echo "$sb"
}

run_webcam() {  # run_webcam <sandbox> <args...> ; usa env já setado pelo caller
  local sb="$1"; shift
  ( cd "$sb" && PATH="$sb/bin:$PATH" bash "$sb/run.sh" "$@" ) 2>&1
}

echo "TAP-ish launcher tests"

# 1) status PARADO
sb=$(make_sandbox)
out=$(CAM_DEVICE="$sb/dev_video10" PGREP_RUNNING=0 EXCLCAPS="Y,N,N" run_webcam "$sb" status)
: > "$sb/dev_video10"  # device presente p/ a 2a linha do status (refaz abaixo)
assert_contains "$out" "Servidor parado" "status: mostra 'Servidor parado' quando nada roda"
rm -rf "$sb"

# 1b) status PARADO com device presente -> mostra exclusive_caps
sb=$(make_sandbox); : > "$sb/dev_video10"
out=$(CAM_DEVICE="$sb/dev_video10" PGREP_RUNNING=0 EXCLCAPS="Y,N,N" run_webcam "$sb" status)
assert_contains "$out" "Servidor parado" "status(device): parado"
assert_contains "$out" "exclusive_caps=Y" "status: reporta exclusive_caps do device"
rm -rf "$sb"

# 2) status RODANDO
sb=$(make_sandbox); : > "$sb/dev_video10"
out=$(CAM_DEVICE="$sb/dev_video10" PGREP_RUNNING=1 EXCLCAPS="Y,N,N" run_webcam "$sb" status)
assert_contains "$out" "Servidor RODANDO" "status: mostra 'RODANDO' quando pgrep acha o processo"
assert_contains "$out" "192.168.0.101" "status: mostra o IP no link"
rm -rf "$sb"

# 3) start SEM device -> exit!=0, manda rodar reload-cam.sh, NAO sobe python
sb=$(make_sandbox)  # sem criar dev_video10
out=$(CAM_DEVICE="$sb/dev_video10" PGREP_RUNNING=0 run_webcam "$sb" start); rc=$?
assert_eq "$rc" "1" "start sem device: exit code 1"
assert_contains "$out" "reload-cam.sh" "start sem device: orienta rodar reload-cam.sh"
assert_eq "$([ -f "$sb/exec.log" ] && echo yes || echo no)" "no" "start sem device: NAO faz exec do python"
rm -rf "$sb"

# 4) start com device porem exclusive_caps != Y -> avisa, mas SOBE (exec python)
sb=$(make_sandbox); : > "$sb/dev_video10"
out=$(CAM_DEVICE="$sb/dev_video10" PGREP_RUNNING=0 EXCLCAPS="N,N,N" run_webcam "$sb" start)
assert_contains "$out" "exclusive_caps=N" "start: avisa quando exclusive_caps != Y"
assert_eq "$([ -f "$sb/exec.log" ] && echo yes || echo no)" "yes" "start(caps=N): ainda assim sobe o servidor"
rm -rf "$sb"

# 5) Instancia unica: start mata o anterior (stop_server/pkill) ANTES de subir
sb=$(make_sandbox); : > "$sb/dev_video10"
out=$(CAM_DEVICE="$sb/dev_video10" PGREP_RUNNING=0 EXCLCAPS="Y,N,N" run_webcam "$sb" start)
pkilllog=$(cat "$sb/pkill.log" 2>/dev/null)
# o padrao usa [s]erver.py / [m]jpeg pra nao casar consigo mesmo no pgrep/pkill
assert_contains "$pkilllog" "erver.py" "instancia unica: start chama pkill do server.py (mata anterior)"
assert_contains "$pkilllog" "jpeg -i pipe:0" "instancia unica: start tambem mata ffmpeg orfao"
assert_eq "$([ -f "$sb/exec.log" ] && echo yes || echo no)" "yes" "start: faz exec do python (sobe 1 servidor)"
exec_count=$(grep -c PYTHON_EXEC "$sb/exec.log")
assert_eq "$exec_count" "1" "start: exatamente 1 exec do servidor"
rm -rf "$sb"

# 6) stop -> chama pkill e informa 'parado'
sb=$(make_sandbox)
out=$(CAM_DEVICE="$sb/dev_video10" run_webcam "$sb" stop)
assert_contains "$out" "Servidor parado" "stop: informa que parou"
assert_contains "$(cat "$sb/pkill.log" 2>/dev/null)" "erver.py" "stop: chama pkill do server.py"
rm -rf "$sb"

# 7) argumento invalido -> uso + exit!=0
sb=$(make_sandbox)
out=$(run_webcam "$sb" banana); rc=$?
assert_eq "$rc" "1" "arg invalido: exit 1"
assert_contains "$out" "uso:" "arg invalido: imprime uso"
rm -rf "$sb"

echo ""
echo "launcher: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ]
