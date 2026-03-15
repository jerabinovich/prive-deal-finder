# Fix Network Connectivity to DGX Spark

## Current Situation

✅ **Gateway is reachable:** 10.0.1.1 is responding  
✅ **Route exists:** 10.1.10/24 → 10.0.1.1  
❌ **Gateway cannot route:** Router doesn't know how to reach 10.1.10.x network  
❌ **Connection fails:** Network is unreachable

## Diagnosis

- **Your Mac:** 10.0.1.173 (Wi-Fi, en0)
- **DGX Spark:** 10.1.10.181
- **Gateway:** 10.0.1.1 (reachable but can't route to 10.1.10.x)
- **Problem:** Router/network infrastructure doesn't have route to 10.1.10.0/24

## Solutions (Choose One)

### Solution 1: Configure Router (If You Have Access) ⭐ RECOMMENDED

1. **Access Router Admin Panel:**
   ```bash
   # Open in browser:
   open http://10.0.1.1
   ```

2. **Add Static Route:**
   - Destination Network: `10.1.10.0`
   - Subnet Mask: `255.255.255.0` (or `/24`)
   - Gateway: IP of the router/switch that connects to 10.1.10.x network
   - Interface: Usually WAN or appropriate interface

3. **Save and Restart Router** (if required)

4. **Test Connection:**
   ```bash
   ping -c 3 10.1.10.181
   ```

### Solution 2: Connect to Same Network

**Option A: Change Mac Network**
- Connect your Mac to the network where DGX Spark is located (10.1.10.x)
- This may require changing Wi-Fi network or using Ethernet

**Option B: Change DGX Spark Network**
- Configure DGX Spark to use 10.0.1.x network
- Requires access to DGX Spark system

### Solution 3: Use VPN

1. **Connect to VPN** that has access to 10.1.10.x network
2. **Verify route exists** after VPN connection:
   ```bash
   route -n get 10.1.10.181
   ```
3. **Test connection:**
   ```bash
   ping 10.1.10.181
   ```

### Solution 4: Direct Connection (If Physically Close)

If DGX Spark is nearby:
1. Connect Mac and DGX Spark to same network switch
2. Or use Ethernet cable directly (if supported)
3. Configure static IPs on same subnet

### Solution 5: SSH Tunnel Through Intermediate Host

If you have access to a host that CAN reach 10.1.10.181:

```bash
# On intermediate host that can reach DGX Spark:
ssh -L 2222:10.1.10.181:22 user@intermediate-host

# Then update NVIDIA Sync to use localhost:2222
# (This requires modifying the connection settings)
```

## Quick Test Commands

After applying a solution, test with:

```bash
# 1. Test ping
ping -c 3 10.1.10.181

# 2. Test SSH port
nc -zv -w 2 10.1.10.181 22

# 3. Test SSH connection
ssh -v -o ConnectTimeout=5 privegroup@10.1.10.181

# 4. Test NVIDIA Sync
"/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" connect 10.1.10.181 --detach

# 5. Check status
"/Applications/NVIDIA Sync.app/Contents/Resources/bin/nvsync-arm64" status 10.1.10.181
```

## What I Cannot Fix Automatically

- ❌ Router configuration (requires admin access)
- ❌ VPN setup (requires credentials)
- ❌ Physical network changes
- ❌ Network infrastructure routing

## Next Steps

1. **Try Solution 1** if you have router access
2. **Try Solution 2** if you can change networks
3. **Try Solution 3** if VPN is available
4. **Contact network administrator** if in enterprise environment

## Once Fixed

NVIDIA Sync will automatically connect - no configuration changes needed! The daemon is already properly configured and waiting.


