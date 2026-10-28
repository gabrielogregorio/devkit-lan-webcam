#!/usr/bin/env bash
# Tests of the run.sh launcher - NO sudo, NO real server, NO real device.
#
# Approach: each case builds a temporary sandbox with a COPY of the real run.sh,
# stubs on the PATH (pgrep/pkill/hostname/cat/sleep) and a FAKE .venv/bin/python
# that only records it was exec'd (instead of starting the server). That exercises
# the real script with no side effects.
#
# Usage:  bash tests/launcher/test_launcher.sh
set -u

REAL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LAUNCHER_SH="$REAL_DIR/run.sh"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
nok()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; echo "         $2"; }

# assert_contains <haystack> <needle> <msg>
assert_contains() { case "$1" in *"$2"*) ok "$3";; *) nok "$3" "expected to contain: '$2' | got: '$1'";; esac; }
assert_not_contains() { case "$1" in *"$2"*) nok "$3" "should NOT contain: '$2'";; *) ok "$3";; esac; }
assert_eq() { [ "$1" = "$2" ] && ok "$3" || nok "$3" "expected '$2', got '$1'"; }

# ---- builds an isolated sandbox and echoes its path ----
make_sandbox() {
  local sb; sb="$(mktemp -d)"
  cp "$LAUNCHER_SH" "$sb/run.sh"
  : > "$sb/server.py"          # placeholder (the fake python ignores it)
  : > "$sb/cert.pem"; : > "$sb/key.pem"   # skips the certificate generation
  : > "$sb/reload-cam.sh"
  mkdir -p "$sb/.venv/bin" "$sb/bin"

  # FAKE python: records the exec and exits 0 (no server)
  cat > "$sb/.venv/bin/python" <<EOF
#!/usr/bin/env bash
echo "PYTHON_EXEC \$*" >> "$sb/exec.log"
exit 0
EOF
  chmod +x "$sb/.venv/bin/python"

  # stubs on the PATH
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

run_webcam() {  # run_webcam <sandbox> <args...> ; uses the env the caller set
  local sb="$1"; shift
  ( cd "$sb" && PATH="$sb/bin:$PATH" bash "$sb/run.sh" "$@" ) 2>&1
}

echo "TAP-ish launcher tests"

# 1) status STOPPED
sb=$(make_sandbox)
out=$(CAM_DEVICE="$sb/dev_video10" PGREP_RUNNING=0 EXCLCAPS="Y,N,N" run_webcam "$sb" status)
assert_contains "$out" "Server stopped" "status: shows 'Server stopped' when nothing runs"
rm -rf "$sb"

# 1b) status STOPPED with the device present -> shows exclusive_caps
sb=$(make_sandbox); : > "$sb/dev_video10"
out=$(CAM_DEVICE="$sb/dev_video10" PGREP_RUNNING=0 EXCLCAPS="Y,N,N" run_webcam "$sb" status)
assert_contains "$out" "Server stopped" "status(device): stopped"
assert_contains "$out" "exclusive_caps=Y" "status: reports the device exclusive_caps"
rm -rf "$sb"

# 2) status RUNNING
sb=$(make_sandbox); : > "$sb/dev_video10"
out=$(CAM_DEVICE="$sb/dev_video10" PGREP_RUNNING=1 EXCLCAPS="Y,N,N" run_webcam "$sb" status)
assert_contains "$out" "Server RUNNING" "status: shows 'RUNNING' when pgrep finds the process"
assert_contains "$out" "192.168.0.101" "status: shows the IP in the link"
rm -rf "$sb"

# 3) start WITHOUT the device -> exit!=0, says to run reload-cam.sh, does NOT start python
sb=$(make_sandbox)  # no dev_video10
out=$(CAM_DEVICE="$sb/dev_video10" PGREP_RUNNING=0 run_webcam "$sb" start); rc=$?
assert_eq "$rc" "1" "start without device: exit code 1"
assert_contains "$out" "reload-cam.sh" "start without device: says to run reload-cam.sh"
assert_eq "$([ -f "$sb/exec.log" ] && echo yes || echo no)" "no" "start without device: does NOT exec python"
rm -rf "$sb"

# 4) start with the device but exclusive_caps != Y -> warns, but STARTS (exec python)
sb=$(make_sandbox); : > "$sb/dev_video10"
out=$(CAM_DEVICE="$sb/dev_video10" PGREP_RUNNING=0 EXCLCAPS="N,N,N" run_webcam "$sb" start)
assert_contains "$out" "exclusive_caps=N" "start: warns when exclusive_caps != Y"
assert_eq "$([ -f "$sb/exec.log" ] && echo yes || echo no)" "yes" "start(caps=N): still starts the server"
rm -rf "$sb"

# 5) Single instance: start kills the previous one (stop_server/pkill) BEFORE starting
sb=$(make_sandbox); : > "$sb/dev_video10"
out=$(CAM_DEVICE="$sb/dev_video10" PGREP_RUNNING=0 EXCLCAPS="Y,N,N" run_webcam "$sb" start)
pkilllog=$(cat "$sb/pkill.log" 2>/dev/null)
# the pattern uses [s]erver.py / [m]jpeg so pgrep/pkill do not match themselves
assert_contains "$pkilllog" "erver" "single instance: start pkills server.py (kills the previous one)"
assert_contains "$pkilllog" "jpeg -i pipe:0" "single instance: start also kills an orphan ffmpeg"
assert_eq "$([ -f "$sb/exec.log" ] && echo yes || echo no)" "yes" "start: execs python (starts 1 server)"
exec_count=$(grep -c PYTHON_EXEC "$sb/exec.log")
assert_eq "$exec_count" "1" "start: exactly 1 exec of the server"
rm -rf "$sb"

# 6) stop -> calls pkill and says 'stopped'
sb=$(make_sandbox)
out=$(CAM_DEVICE="$sb/dev_video10" run_webcam "$sb" stop)
assert_contains "$out" "Server stopped" "stop: says it stopped"
assert_contains "$(cat "$sb/pkill.log" 2>/dev/null)" "erver" "stop: pkills server.py"
rm -rf "$sb"

# 7) invalid argument -> usage + exit!=0
sb=$(make_sandbox)
out=$(run_webcam "$sb" banana); rc=$?
assert_eq "$rc" "1" "invalid arg: exit 1"
assert_contains "$out" "usage:" "invalid arg: prints usage"
rm -rf "$sb"

echo ""
echo "launcher: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
