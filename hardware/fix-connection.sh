#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  NVIDIA Sync Connection Fix Assistant"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Check current connectivity
echo "Checking current connectivity to Spark-15b9 (10.1.10.181)..."
if ping -c 1 -W 2 10.1.10.181 > /dev/null 2>&1; then
    echo "✓ Network is reachable!"
    echo ""
    echo "Connecting NVIDIA Sync..."
    "/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" connect 10.1.10.181 --detach
    sleep 2
    echo ""
    echo "Connection status:"
    "/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" status 10.1.10.181
    exit 0
fi

echo "✗ Cannot reach 10.1.10.181"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  FIX OPTIONS"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "1. CONNECT TO VPN (Most common for remote)"
echo "   → Connect to VPN with access to 10.1.10.x network"
echo "   → Then run this script again: ./fix-connection.sh"
echo ""
echo "2. CONFIGURE ROUTER"
echo "   → Open: http://10.0.1.1"
echo "   → Add static route: 10.1.10.0/24"
echo "   → Then run this script again"
echo ""
echo "3. CHECK NETWORK"
echo "   → Verify Spark-15b9 is powered on"
echo "   → Check if it has different IP/hostname"
echo "   → Contact network administrator"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
read -p "Have you connected to VPN or fixed network? (y/n): " answer

if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
    echo ""
    echo "Testing connection..."
    if ping -c 1 -W 2 10.1.10.181 > /dev/null 2>&1; then
        echo "✓ Network is now reachable!"
        echo "Connecting NVIDIA Sync..."
        "/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" connect 10.1.10.181 --detach
        sleep 2
        echo ""
        echo "Connection status:"
        "/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" status 10.1.10.181
    else
        echo "✗ Still cannot reach 10.1.10.181"
        echo "Please check:"
        echo "  - VPN is connected and has access to 10.1.10.x network"
        echo "  - Spark-15b9 is powered on and on network"
        echo "  - Network routing is configured"
    fi
else
    echo ""
    echo "Please:"
    echo "  1. Connect to VPN (if remote)"
    echo "  2. Or fix network routing"
    echo "  3. Then run: ./fix-connection.sh"
fi
