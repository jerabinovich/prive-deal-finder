# Quick Commands for NVIDIA Sync Connection

## From Any Directory

```bash
# Option 1: Use the shortcut in home directory
~/connect-nvidia-sync.sh

# Option 2: Navigate to workspace first
cd "/Users/javierrabinovich/Prive Group AI /PRIVE-GROUP-AI-PLATFORM"
./test-and-connect.sh

# Option 3: Use full path
"/Users/javierrabinovich/Prive Group AI /PRIVE-GROUP-AI-PLATFORM/test-and-connect.sh"
```

## Current Issue: Network is Unreachable

The error `ssh: connect to host 10.1.10.181 port 22: Network is unreachable` means:

**The network route to 10.1.10.181 is not available.**

## To Fix:

### 1. Connect to VPN (Most Common)
```bash
# Connect to VPN that has access to 10.1.10.x network
# Then run:
~/connect-nvidia-sync.sh
```

### 2. Check Network Status
```bash
# Test if network is reachable
ping -c 3 10.1.10.181

# If ping works, then run:
~/connect-nvidia-sync.sh
```

### 3. Monitor and Auto-Connect
```bash
cd "/Users/javierrabinovich/Prive Group AI /PRIVE-GROUP-AI-PLATFORM"
./auto-connect-when-ready.sh
```

## All Available Scripts

Located in: `/Users/javierrabinovich/Prive Group AI /PRIVE-GROUP-AI-PLATFORM/`

- `test-and-connect.sh` - Test connectivity and connect if available
- `auto-connect-when-ready.sh` - Monitor and auto-connect when network is ready
- `fix-connection.sh` - Interactive fix assistant
- `connect-nvidia-sync.sh` - Shortcut in home directory

## Quick Status Check

```bash
# Check NVIDIA Sync status
"/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" status 10.1.10.181

# Test network connectivity
ping -c 3 10.1.10.181
```








