#!/usr/bin/env bash
# Installs, upgrades or removes Stint Server on Linux (systemd).
#
#   sudo ./install.sh                 install, or upgrade if already installed
#   sudo ./install.sh --uninstall     remove the service and program, keep the data
#   sudo ./install.sh --uninstall --purge
#                                     ...and delete all data (timesheets, backups)
#
# Options:
#   --binary PATH    the stint-server program to install (default: ./stint-server next to this script)
#   --no-firewall    don't touch ufw/firewalld
#
# What it does:
#   - creates a system user "stint" and the data folder /var/lib/stint (only that user can read it)
#   - installs /usr/local/bin/stint-server and the systemd service "stint-server" (starts at boot)
#   - if ufw or firewalld is active, allows Stint from private networks only
#     (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 and Tailscale's 100.64.0.0/10)
#   - lets the "stint" user keep the computer from sleeping (a polkit rule), so timers keep syncing
#   - upgrades in place: stops the service, replaces the program, starts it again
#     (Stint backs up the database itself before any schema change)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_SRC="$HERE/stint-server"
UNIT_SRC="$HERE/stint-server.service"
BIN=/usr/local/bin/stint-server
UNIT=/etc/systemd/system/stint-server.service
DATA=/var/lib/stint
USER_NAME=stint
SERVICE=stint-server
# HTTPS (with room for Stint's automatic port fallback: 47600, 47602, ... 47610)
TCP_PORTS="47600:47610"
# UDP discovery responder and mDNS
UDP_PORTS=(47609 5353)
NETS=(10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10)
FW_COMMENT="Stint Server"
POLKIT_RULE=/etc/polkit-1/rules.d/50-stint-server.rules

action=install
purge=0
firewall=1
while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) action=uninstall ;;
    --purge) purge=1 ;;
    --no-firewall) firewall=0 ;;
    --binary) BIN_SRC="$(realpath "$2")"; shift ;;
    -h | --help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this with sudo."
if ! command -v systemctl >/dev/null || [ ! -d /run/systemd/system ]; then
  die "this script needs systemd. Run $BIN_SRC --service yourself under your init system instead."
fi

ufw_active() { command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "^Status: active"; }
firewalld_active() { command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; }

firewall_open() {
  [ "$firewall" -eq 1 ] || return 0
  if ufw_active; then
    say "Allowing Stint through ufw (private networks only)…"
    for net in "${NETS[@]}"; do
      ufw allow proto tcp from "$net" to any port "$TCP_PORTS" comment "$FW_COMMENT" >/dev/null
      for p in "${UDP_PORTS[@]}"; do ufw allow proto udp from "$net" to any port "$p" comment "$FW_COMMENT" >/dev/null; done
    done
  elif firewalld_active; then
    say "Allowing Stint through firewalld (private networks only)…"
    for net in "${NETS[@]}"; do
      firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address=$net port port=${TCP_PORTS/:/-} protocol=tcp accept" >/dev/null
      for p in "${UDP_PORTS[@]}"; do
        firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address=$net port port=$p protocol=udp accept" >/dev/null
      done
    done
    firewall-cmd --reload >/dev/null
  else
    echo "No active ufw or firewalld found: nothing to open. If you use another firewall, allow TCP $TCP_PORTS and UDP ${UDP_PORTS[*]} from your office network."
  fi
}

firewall_close() {
  [ "$firewall" -eq 1 ] || return 0
  if command -v ufw >/dev/null; then
    for net in "${NETS[@]}"; do
      ufw delete allow proto tcp from "$net" to any port "$TCP_PORTS" >/dev/null 2>&1 || true
      for p in "${UDP_PORTS[@]}"; do ufw delete allow proto udp from "$net" to any port "$p" >/dev/null 2>&1 || true; done
    done
  fi
  if firewalld_active; then
    for net in "${NETS[@]}"; do
      firewall-cmd --permanent --remove-rich-rule="rule family=ipv4 source address=$net port port=${TCP_PORTS/:/-} protocol=tcp accept" >/dev/null 2>&1 || true
      for p in "${UDP_PORTS[@]}"; do
        firewall-cmd --permanent --remove-rich-rule="rule family=ipv4 source address=$net port port=$p protocol=udp accept" >/dev/null 2>&1 || true
      done
    done
    firewall-cmd --reload >/dev/null 2>&1 || true
  fi
}

# logind only lets logged-in users block sleep by default; allow the service account too.
sleep_rule_add() {
  [ -d /etc/polkit-1/rules.d ] || {
    echo "(polkit rules folder not found: Stint may not be able to keep this computer awake; Health will say so.)"
    return 0
  }
  cat >"$POLKIT_RULE" <<'RULE'
// Installed by Stint Server: lets the "stint" service account keep the computer awake.
polkit.addRule(function (action, subject) {
  if (subject.user == "stint" &&
      (action.id == "org.freedesktop.login1.inhibit-block-sleep" ||
       action.id == "org.freedesktop.login1.inhibit-block-idle")) {
    return polkit.Result.YES;
  }
});
RULE
  chmod 0644 "$POLKIT_RULE"
}

uninstall() {
  say "Removing Stint Server…"
  systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
  rm -f "$UNIT" "$BIN" "$POLKIT_RULE"
  systemctl daemon-reload
  firewall_close
  if [ "$purge" -eq 1 ]; then
    rm -rf "$DATA"
    userdel "$USER_NAME" >/dev/null 2>&1 || true
    say "Stint Server and all its data have been removed."
  else
    say "Stint Server has been removed. Your data is still in $DATA (reinstalling picks it up again; --purge deletes it)."
  fi
}

install() {
  [ -f "$BIN_SRC" ] || die "can't find the program at $BIN_SRC (use --binary PATH)."
  [ -f "$UNIT_SRC" ] || die "can't find $UNIT_SRC next to this script."
  "$BIN_SRC" version >/dev/null 2>&1 || die "$BIN_SRC doesn't run on this machine (wrong architecture?)."
  local version
  version="$("$BIN_SRC" version)"

  if ! id "$USER_NAME" >/dev/null 2>&1; then
    say "Creating the system user \"$USER_NAME\"…"
    useradd --system --home-dir "$DATA" --no-create-home --shell /usr/sbin/nologin --user-group "$USER_NAME"
  fi
  install -d -m 0750 -o "$USER_NAME" -g "$USER_NAME" "$DATA"

  local upgrading=0
  if systemctl is-active --quiet "$SERVICE"; then
    upgrading=1
    say "Stopping the running Stint Server to upgrade it…"
    systemctl stop "$SERVICE"
  fi

  say "Installing Stint Server $version…"
  install -m 0755 "$BIN_SRC" "$BIN"
  install -m 0644 "$UNIT_SRC" "$UNIT"
  sleep_rule_add
  systemctl daemon-reload
  systemctl enable --now "$SERVICE" >/dev/null 2>&1 || systemctl enable --now "$SERVICE"
  firewall_open

  # Wait for it to answer, then say where to go next.
  local runtime="$DATA/run/runtime.json" admin="" https=""
  for _ in $(seq 1 60); do
    if [ -f "$runtime" ]; then
      admin="$(sed -n 's/.*"adminUrl": *"\([^"]*\)".*/\1/p' "$runtime")"
      https="$(sed -n 's/.*"httpsPort": *\([0-9]*\).*/\1/p' "$runtime")"
      if [ -n "$admin" ] && curl -fs "${admin}api/info" >/dev/null 2>&1; then break; fi
    fi
    sleep 0.5
  done
  if [ -z "$admin" ] || ! curl -fs "${admin}api/info" >/dev/null 2>&1; then
    systemctl --no-pager status "$SERVICE" || true
    die "Stint Server didn't start. See: journalctl -u $SERVICE"
  fi

  local setup_done http_port
  setup_done="$(curl -fs "${admin}api/setup/status" | grep -c '"setupComplete":true' || true)"
  http_port="$(printf '%s' "$admin" | sed -n 's/.*:\([0-9]*\)\/$/\1/p')"
  echo
  if [ "$upgrading" -eq 1 ]; then
    say "Stint Server $version is running (upgraded)."
  else
    say "Stint Server $version is running and starts automatically with this computer."
  fi
  echo "  Data:     $DATA (backups in $DATA/backups unless you choose another folder)"
  echo "  Logs:     journalctl -u $SERVICE   and   $DATA/logs"
  echo "  Office:   https://$(hostname).local:$https  (the Stint app finds it by itself)"
  if [ "$setup_done" = "0" ]; then
    echo
    say "Next: finish setup in a browser ON THIS COMPUTER:"
    echo "  ${admin}setup"
    echo "  No screen here? From your own computer run:"
    echo "    ssh -L $http_port:localhost:$http_port $(logname 2>/dev/null || echo you)@$(hostname)"
    echo "  and open http://localhost:$http_port/setup"
  fi
}

case "$action" in
  install) install ;;
  uninstall) uninstall ;;
esac
