#!/bin/bash
# Auto-connect NVIDIA Sync when network becomes available

echo "Monitoring network connectivity to Spark-15b9 (10.1.10.181)..."
echo "Press Ctrl+C to stop"
echo ""

while true; do
    if ping -c 1 -W 2 10.1.10.181 > /dev/null 2>&1; then
        echo "$(date): Network is reachable! Connecting NVIDIA Sync..."
        "/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" connect 10.1.10.181 --detach
        sleep 2
        "/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" status 10.1.10.181
        echo ""
        echo "Connection established! You can now close this script."
        break
    else
        echo "$(date): Waiting for network connectivity..."
        sleep 5
    fi
done
