#!/bin/bash
# Setup script for Bluetooth testing - installs required dependencies

echo "=========================================="
echo "Bluetooth Test Setup"
echo "=========================================="
echo ""

# Check if bleak is installed
if python3 -c "import bleak" 2>/dev/null; then
    echo "✓ bleak library is already installed"
    exit 0
fi

echo "Installing bleak library for BLE scanning..."
echo ""

# Try different installation methods
echo "Method 1: Trying pip3 with --break-system-packages..."
if pip3 install --break-system-packages bleak 2>/dev/null; then
    echo "✓ Successfully installed bleak"
    exit 0
fi

echo ""
echo "Method 2: Creating virtual environment..."
cd "$(dirname "$0")"
python3 -m venv bluetooth-test-env
source bluetooth-test-env/bin/activate
pip install bleak
echo "✓ Installed bleak in virtual environment"
echo ""
echo "To use the Bluetooth test scripts, activate the virtual environment first:"
echo "  source bluetooth-test-env/bin/activate"
echo "  python3 test-bluetooth-connection.py"
echo ""
echo "Or run: ./test-bluetooth.sh (which will use system Python)"






