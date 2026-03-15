#!/bin/bash
set -euo pipefail

# Force-reset an NVIDIA Sync connection by:
# 1) disconnecting
# 2) killing any leftover connect processes
# 3) removing the stuck socket
# 4) reconnecting with --detach
#
# Usage:
#   ./nvidia-sync-reconnect.sh              # defaults to 10.1.10.181
#   ./nvidia-sync-reconnect.sh 10.1.10.181
usage() {
  cat <<'EOF'
Usage:
  ./nvidia-sync-reconnect.sh              # defaults to 10.1.10.181
  ./nvidia-sync-reconnect.sh 10.1.10.181  # explicit IP
  ./nvidia-sync-reconnect.sh -h|--help

Environment overrides:
  NVSYNC_BIN  Path to nvsync binary (defaults to NVIDIA Sync.app location)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

IP="${1:-10.1.10.181}"
NVSYNC="${NVSYNC_BIN:-/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64}"
SESSION_DIR="${HOME}/Library/Application Support/NVIDIA/Sync/session"
SOCKET_PATH="${SESSION_DIR}/${IP}.socket"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: this script is intended for macOS (Darwin)." >&2
  exit 1
fi

is_valid_ipv4() {
  local ip="$1"
  local -a octets

  [[ "${ip}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS='.' read -r -a octets <<< "${ip}"
  [[ "${#octets[@]}" -eq 4 ]] || return 1

  for octet in "${octets[@]}"; do
    [[ "${octet}" =~ ^[0-9]+$ ]] || return 1
    ((octet >= 0 && octet <= 255)) || return 1
  done
}

if ! is_valid_ipv4 "${IP}"; then
  echo "Error: invalid IPv4 address '${IP}'." >&2
  exit 1
fi

if [[ ! -x "${NVSYNC}" ]]; then
  echo "Error: nvsync binary not found/executable at: ${NVSYNC}" >&2
  echo "Tip: set NVSYNC_BIN to the correct path, or reinstall NVIDIA Sync." >&2
  exit 1
fi

echo "Force reconnecting NVIDIA Sync for ${IP}..."

"${NVSYNC}" disconnect "${IP}" || true

# Kill only leftover connect processes for the specific target IP.
while IFS= read -r pid; do
  kill "${pid}" || true
done < <(ps ax -o pid= -o command= | awk -v ip="${IP}" '
  $0 ~ /nvsync-arm64/ && $0 ~ (" connect " ip "([[:space:]]|$)") { print $1 }
' || true)

mkdir -p "${SESSION_DIR}"
case "${SOCKET_PATH}" in
  "${SESSION_DIR}"/*) ;;
  *)
    echo "Error: refusing to remove socket outside session directory." >&2
    exit 1
    ;;
esac
rm -f -- "${SOCKET_PATH}"

"${NVSYNC}" connect "${IP}" --detach

sleep 1
"${NVSYNC}" status "${IP}" || true


