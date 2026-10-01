#!/usr/bin/env bash
# Starts a built stint-server binary in a throwaway data folder and checks that it serves
# the web client, the API (HTTP on loopback and HTTPS), runs setup and makes a backup.
#   bash installer/smoke-test.sh apps/server/dist/stint-server-linux-x64
set -euo pipefail
BIN="$(realpath "$1")"
DATA="$(mktemp -d)"
LOG="$DATA/server.log"
cleanup() { kill "$PID" 2>/dev/null || true; rm -rf "$DATA"; }
trap cleanup EXIT

STINT_DATA_DIR="$DATA" STINT_OPEN_BROWSER=0 STINT_DISABLE_UPDATE_CHECK=1 \
  STINT_PORT=47800 STINT_HTTP_PORT=47801 STINT_DISCOVERY_PORT=47809 "$BIN" >"$LOG" 2>&1 &
PID=$!
for _ in $(seq 1 40); do
  curl -fs http://127.0.0.1:47801/api/info >/dev/null 2>&1 && break
  sleep 0.5
done
fail() { echo "SMOKE TEST FAILED: $1"; cat "$LOG"; exit 1; }

"$BIN" version | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+' || fail "version"
curl -fs http://127.0.0.1:47801/ | grep -q '<div id="root">' || fail "web client not embedded"
curl -fsk https://127.0.0.1:47800/api/info | grep -q '"product":"stint"' || fail "HTTPS API"
jar="$DATA/cookies"
curl -fs -c "$jar" -H 'x-stint-request: 1' -H 'content-type: application/json' \
  -d '{"organizationName":"Smoke Test Ltd","admin":{"name":"Smoke Admin","email":"admin@smoke.test","password":"smoke test password"}}' \
  http://127.0.0.1:47801/api/setup | grep -q '"ok":true' || fail "setup"
curl -fs -b "$jar" -X POST -H 'x-stint-request: 1' -H 'content-type: application/json' -d '{}' \
  http://127.0.0.1:47801/api/admin/backups/run | grep -q '"ok":true' || fail "backup"
curl -fs -b "$jar" -H 'x-stint-request: 1' http://127.0.0.1:47801/api/admin/health | grep -q '"checks"' || fail "health"
[ -f "$DATA/run/runtime.json" ] || fail "runtime.json"
echo "Smoke test passed: $("$BIN" version)"
