#!/bin/bash
# Bluetooth Connection Test Script for ESP32-S3
# Tests Bluetooth/BLE connectivity on macOS

echo "=========================================="
echo "Bluetooth Connection Test"
echo "=========================================="
echo ""

# Check if Bluetooth is enabled
echo "1. Checking Bluetooth status..."
if system_profiler SPBluetoothDataType | grep -q "State: On"; then
    echo "   ✓ Bluetooth is enabled"
else
    echo "   ✗ Bluetooth is not enabled"
    echo "   Please enable Bluetooth in System Settings"
    exit 1
fi

# Get Bluetooth adapter info
echo ""
echo "2. Bluetooth Adapter Information:"
system_profiler SPBluetoothDataType | grep -A 5 "Apple Bluetooth Software Version" | head -3

# Check if bluetoothctl is available
echo ""
echo "3. Checking for Bluetooth tools..."
if command -v bluetoothctl &> /dev/null; then
    echo "   ✓ bluetoothctl is available"
    BLUETOOTHCTL_AVAILABLE=true
else
    echo "   ⚠ bluetoothctl not found (install via: brew install blueutil)"
    BLUETOOTHCTL_AVAILABLE=false
fi

# Check if Python bleak is available
echo ""
echo "4. Checking Python BLE libraries..."
if python3 -c "import bleak" 2>/dev/null; then
    echo "   ✓ bleak library is available"
    PYTHON_BLE_AVAILABLE=true
else
    echo "   ⚠ bleak library not found"
    echo "   Install with: pip3 install bleak"
    PYTHON_BLE_AVAILABLE=false
fi

# Scan for BLE devices
echo ""
echo "5. Scanning for BLE devices..."
echo "   (This may take 10-15 seconds)"
echo ""

if [ "$PYTHON_BLE_AVAILABLE" = true ]; then
    # Use Python script for BLE scanning
    python3 << 'EOF'
import asyncio
from bleak import BleakScanner
import sys

async def scan_devices():
    print("   Scanning for BLE devices...")
    devices = await BleakScanner.discover(timeout=10.0)
    
    if not devices:
        print("   ✗ No BLE devices found")
        print("   Make sure your ESP32-S3 is powered on and advertising")
        return
    
    print(f"   ✓ Found {len(devices)} BLE device(s):")
    print("")
    
    esp32_devices = []
    for device in devices:
        name = device.name or "Unknown"
        addr = device.address
        rssi = device.rssi if hasattr(device, 'rssi') else "N/A"
        
        print(f"   Device: {name}")
        print(f"   Address: {addr}")
        print(f"   RSSI: {rssi} dBm")
        
        # Check if it might be an ESP32
        if "ESP32" in name.upper() or "ESP" in name.upper():
            esp32_devices.append(device)
            print(f"   → Potential ESP32 device!")
        print("")
    
    if esp32_devices:
        print(f"   ✓ Found {len(esp32_devices)} potential ESP32 device(s)")
    else:
        print("   ⚠ No devices with 'ESP32' in name found")
        print("   If your ESP32 is advertising, it may have a different name")

try:
    asyncio.run(scan_devices())
except Exception as e:
    print(f"   ✗ Error during scan: {e}")
    sys.exit(1)
EOF
else
    echo "   ⚠ Cannot scan - bleak library not installed"
    echo "   Install with: pip3 install bleak"
fi

echo ""
echo "=========================================="
echo "Test Complete"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Make sure your ESP32-S3 is powered on"
echo "2. Ensure Bluetooth BLE is enabled in your ESP32 code"
echo "3. Run this script again to scan for devices"
echo "4. Use the Python script for detailed connection testing"
echo ""






