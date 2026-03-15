#!/bin/bash
set -euo pipefail

TARGET_IP="${TARGET_IP:-10.1.10.181}"
NVSYNC_BIN="${NVSYNC_BIN:-/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-120}"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Error: auto-fix-network.sh is intended for macOS (Darwin)." >&2
    exit 1
fi

for cmd in scutil route ifconfig ping; do
    if ! command -v "${cmd}" > /dev/null 2>&1; then
        echo "Error: required command not found: ${cmd}" >&2
        exit 1
    fi
done

if [[ ! "${MAX_ATTEMPTS}" =~ ^[0-9]+$ ]]; then
    echo "Error: MAX_ATTEMPTS must be a non-negative integer." >&2
    exit 1
fi

NVSYNC_AVAILABLE=0
if [[ -x "${NVSYNC_BIN}" ]]; then
    NVSYNC_AVAILABLE=1
else
    echo "Warning: nvsync binary not found at ${NVSYNC_BIN}. Auto-connect will be skipped." >&2
fi

get_default_gateway() {
    route -n get default 2>/dev/null | awk '/gateway:/ {print $2; exit}' || true
}

get_default_interface() {
    route -n get default 2>/dev/null | awk '/interface:/ {print $2; exit}' || true
}

connect_nvsync() {
    if [[ "${NVSYNC_AVAILABLE}" -eq 1 ]]; then
        echo "Connecting NVIDIA Sync..."
        "${NVSYNC_BIN}" connect "${TARGET_IP}" --detach
        sleep 2
        "${NVSYNC_BIN}" status "${TARGET_IP}" || true
    else
        echo "Skipping NVIDIA Sync connection because nvsync binary is unavailable."
    fi
}

echo "═══════════════════════════════════════════════════════════════"
echo "  Automatic Network Fix Attempt"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Check current connectivity
echo "1. Checking current network status..."
if ping -c 1 -W 2 "${TARGET_IP}" > /dev/null 2>&1; then
    echo "   ✓ Network is already reachable!"
    echo ""
    connect_nvsync
    exit 0
fi

echo "   ✗ Network is not reachable"
echo ""

# Check for VPN
echo "2. Checking for VPN connections..."
VPN_COUNT=$(scutil --nc list 2>/dev/null | grep -c "Connected" || echo "0")
if [ "$VPN_COUNT" -gt 0 ]; then
    echo "   ✓ VPN connection(s) detected"
    scutil --nc list 2>/dev/null | grep "Connected"
else
    echo "   ✗ No VPN connections found"
    echo ""
    echo "   ACTION REQUIRED: Connect to VPN that has access to 10.1.10.x network"
    echo "   Then run this script again: ./auto-fix-network.sh"
fi
echo ""

# Check network interfaces
echo "3. Checking network interfaces..."
ACTIVE_IF="$(get_default_interface)"
if [[ -n "${ACTIVE_IF}" ]]; then
    echo "   Active interface: ${ACTIVE_IF}"
    ifconfig "${ACTIVE_IF}" 2>/dev/null | awk '/inet / {print "   IP Address: " $2}'
else
    echo "   Active interface: (not detected)"
fi
echo ""

# Check routing
echo "4. Checking routing to ${TARGET_IP}..."
ROUTE="$(route -n get "${TARGET_IP}" 2>/dev/null | awk '/gateway:/ {print $2; exit}' || true)"
if [ -n "$ROUTE" ]; then
    echo "   Route exists via: $ROUTE"
    echo "   Testing gateway..."
    if ping -c 1 -W 2 "${ROUTE}" > /dev/null 2>&1; then
        echo "   ✓ Gateway is reachable"
        echo "   ⚠ Gateway cannot route to ${TARGET_IP%.*}.x network"
        echo ""
        echo "   SOLUTION: Configure router at ${ROUTE} to route to ${TARGET_IP%.*}.0/24"
    else
        echo "   ✗ Gateway is not reachable"
    fi
else
    echo "   ✗ No route found"
fi
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "  FIX REQUIRED"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "To fix network connectivity, you need to:"
echo ""
echo "OPTION 1: Connect to VPN (Recommended for remote)"
echo "  → Connect to VPN with access to ${TARGET_IP%.*}.x network"
echo "  → Then run: ./auto-fix-network.sh"
echo ""
echo "OPTION 2: Configure Router"
echo "  → Open: http://$(get_default_gateway)"
echo "  → Add static route: ${TARGET_IP%.*}.0/24"
echo "  → Then run: ./auto-fix-network.sh"
echo ""
echo "OPTION 3: Contact Network Administrator"
echo "  → Request VPN access or network routing to ${TARGET_IP}"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Monitoring for network availability..."
echo "Press Ctrl+C to stop"
if [[ "${MAX_ATTEMPTS}" -gt 0 ]]; then
    echo "Auto-timeout after ${MAX_ATTEMPTS} checks (set MAX_ATTEMPTS=0 for infinite)."
fi
echo ""

# Monitor and auto-connect when available
ATTEMPTS=0
while true; do
    if ping -c 1 -W 2 "${TARGET_IP}" > /dev/null 2>&1; then
        echo ""
        echo "$(date): ✓ Network is now reachable!"
        connect_nvsync
        echo ""
        echo "Connection status:"
        if [[ "${NVSYNC_AVAILABLE}" -eq 1 ]]; then
            "${NVSYNC_BIN}" status "${TARGET_IP}" || true
        else
            echo "nvsync unavailable; skipped status."
        fi
        echo ""
        echo "✓ Connection established! You can close this script."
        break
    else
        ATTEMPTS=$((ATTEMPTS + 1))
        if [[ "${MAX_ATTEMPTS}" -gt 0 && "${ATTEMPTS}" -ge "${MAX_ATTEMPTS}" ]]; then
            echo ""
            echo "Timeout: network to ${TARGET_IP} is still unreachable after ${ATTEMPTS} attempts."
            exit 1
        fi
        echo -n "."
        sleep 3
    fi
done
