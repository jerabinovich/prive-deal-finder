## Quick Network Check Commands

# Check if DGX Spark is reachable
ping -c 3 10.1.10.181

# Test SSH port
nc -zv -w 2 10.1.10.181 22

# Check routing
route -n get 10.1.10.181

# Test SSH connection
ssh -v -o ConnectTimeout=5 privegroup@10.1.10.181

# Once connected, test NVIDIA Sync
"/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" connect 10.1.10.181 --detach

