# NVIDIA Sync Daemon Configuration Analysis

## Summary
The "daemon not running" error occurs when using `--detach` flag because:
1. A non-detached connection process is already using the socket file
2. The `--detach` flag requires exclusive access to the socket
3. Multiple connection processes are running without `--detach`

## Configuration Files Found

### 1. State Store Configuration
**Location:** `/Users/javierrabinovich/Library/Application Support/NVIDIA/Sync/config/state-store.json`
- Contains device configuration for `10.1.10.181` (Spark-15b9)
- Stores device status, ports, and tool configurations
- No daemon-specific settings found

### 2. SSH Configuration
**Location:** `/Users/javierrabinovich/Library/Application Support/NVIDIA/Sync/config/ssh_config`
```
Host 10.1.10.181
    Hostname 10.1.10.181
    User privegroup
    Port 22
    IdentityFile "/Users/javierrabinovich/Library/Application Support/NVIDIA/Sync/config/nvsync.key"
```

### 3. Session Files
**Location:** `/Users/javierrabinovich/Library/Application Support/NVIDIA/Sync/session/`
- `10.1.10.181.pid` - Process ID of the connection daemon
- `10.1.10.181.socket` - Unix socket for IPC communication
- `10.1.10.181.out` - Contains error: "bind: address already in use"
- `10.1.10.181.err` - Error log (currently empty)

### 4. Preferences
**Location:** `/Users/javierrabinovich/Library/Preferences/com.nvidia.nvidia-sync.plist`
- Contains only UI preferences (text direction, fullscreen settings)
- No daemon configuration options

## Root Cause

The error message in `10.1.10.181.out` reveals:
```json
{
 "heading": "Unexpected Error",
 "details": "listen unix /Users/javierrabinovich/Library/Application Support/NVIDIA/Sync/session/10.1.10.181.socket: bind: address already in use"
}
```

**Problem:** When attempting to connect with `--detach`, the daemon tries to bind to the socket file, but it's already bound by existing non-detached connection processes (PIDs: 28184, 29095, 29105).

## Current Process Status

Multiple `nvsync-arm64 connect 10.1.10.181` processes are running **without** `--detach`:
- PID 28184: `nvsync-arm64 connect 10.1.10.181`
- PID 29095: `nvsync-arm64 connect 10.1.10.181`
- PID 29105: `nvsync-arm64 connect 10.1.10.181`

All are connected to the same socket file, preventing `--detach` from binding.

## Solution

To use `--detach` flag, you must:

1. **Disconnect all existing connections:**
   ```bash
   "/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" disconnect 10.1.10.181
   ```

2. **Wait for processes to terminate and socket to be released**

3. **Connect with `--detach` flag:**
   ```bash
   "/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" connect 10.1.10.181 --detach
   ```

### Force reconnect (clears stuck socket + kills leftover connect processes)

If `--detach` keeps failing with `bind: address already in use`, do a hard reset of the connection:

```bash
"/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" disconnect 10.1.10.181
pkill -f "nvsync-arm64 connect 10.1.10.181"
rm -f "/Users/javierrabinovich/Library/Application Support/NVIDIA/Sync/session/10.1.10.181.socket"
"/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" connect 10.1.10.181 --detach
```

Notes:
- This is intentionally aggressive: it kills any process whose command line contains `nvsync-arm64 connect 10.1.10.181`.
- If you want a reusable version, see `./nvidia-sync-reconnect.sh`.

Usage:

```bash
./nvidia-sync-reconnect.sh              # defaults to 10.1.10.181
./nvidia-sync-reconnect.sh 10.1.10.181  # explicit IP
```

## Daemon Configuration Options

Based on the binary strings analysis, the daemon supports:
- `--detach` flag: Put the process into the background
- `--debug` flag: Run with debug logging enabled
- `--verbose` flag: Run with verbose logging enabled

## Additional Notes

- **Version:** nvsync 0.41.21-1-g3252cff
- **Network Issue:** The target host `10.1.10.181` is currently unreachable, which will prevent connections regardless of daemon status
- **No Launch Agents:** No macOS LaunchAgents or LaunchDaemons are configured for NVIDIA Sync
- **No Environment Variables:** No daemon-related environment variables are set

## Recommendations

1. Ensure only one connection process runs at a time
2. Use `--detach` from the start if you need background operation
3. Check network connectivity to `10.1.10.181` before attempting connections
4. Monitor the socket file status: `lsof /Users/javierrabinovich/Library/Application\ Support/NVIDIA/Sync/session/10.1.10.181.socket`

