#!/bin/bash
# Test connectivity and connect if available

echo "Testing connection to Spark-15b9 (10.1.10.181)..."
echo ""

# Test ping
if ping -c 3 10.1.10.181 > /dev/null 2>&1; then
    echo "✓ Ping successful!"
    
    # Test SSH port
    if nc -zv -w 2 10.1.10.181 22 > /dev/null 2>&1; then
        echo "✓ SSH port (22) is open!"
        
        # Connect NVIDIA Sync
        echo "Connecting NVIDIA Sync..."
        "/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" connect 10.1.10.181 --detach
        
        sleep 2
        
        # Check status
        echo ""
        echo "Connection status:"
        "/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" status 10.1.10.181
        
    else
        echo "✗ SSH port (22) is not accessible"
        echo "Network may be reachable but firewall is blocking SSH"
    fi
else
    echo "✗ Cannot ping 10.1.10.181"
    echo ""
    echo "Network connectivity issue. Please:"
    echo "  1. Connect to VPN (if remote)"
    echo "  2. Check network routing"
    echo "  3. Verify Spark-15b9 is powered on and on network"
fi
