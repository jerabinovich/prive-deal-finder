# How to Fix Network Connectivity - Step by Step Guide

## Quick Diagnosis

**Problem:** Your Mac cannot reach Spark-15b9 at `10.1.10.181`  
**Reason:** Different network subnets with no route between them  
**Solution:** Establish network connectivity (choose one method below)

---

## Solution 1: Connect via VPN (BEST for Remote Connection) ⭐

### Step 1: Identify VPN
- Do you have VPN access to the network where Spark-15b9 is located?
- Check with your IT department or network administrator
- Common VPN types: Cisco AnyConnect, OpenVPN, WireGuard, etc.

### Step 2: Connect to VPN
1. Open VPN client on your Mac
2. Connect to the VPN that has access to `10.1.10.x` network
3. Wait for connection to establish

### Step 3: Verify Connection
```bash
# Test if you can now reach Spark-15b9
ping -c 3 10.1.10.181
```

### Step 4: Connect NVIDIA Sync
```bash
# Run the test and connect script
./test-and-connect.sh
```

**OR** let it auto-connect:
```bash
./auto-connect-when-ready.sh
```

---

## Solution 2: Configure Router (If You Have Admin Access)

### Step 1: Access Router
1. Open browser and go to: `http://10.0.1.1`
2. Log in with admin credentials

### Step 2: Add Static Route
1. Find "Static Routes" or "Routing" section
2. Click "Add Route" or similar
3. Enter:
   - **Destination Network:** `10.1.10.0`
   - **Subnet Mask:** `255.255.255.0` (or `/24`)
   - **Gateway:** IP address of router/switch that connects to 10.1.10.x network
   - **Interface:** Usually WAN or appropriate interface
4. Save/Apply changes

### Step 3: Test Connection
```bash
ping -c 3 10.1.10.181
```

### Step 4: Connect NVIDIA Sync
```bash
./test-and-connect.sh
```

---

## Solution 3: Connect to Same Network

### Option A: Change Mac Network
1. Connect your Mac to the same Wi-Fi/Ethernet network as Spark-15b9
2. This may require being physically near the system or using a different network

### Option B: Change Spark-15b9 Network
1. Access Spark-15b9 directly (if possible)
2. Configure it to use `10.0.1.x` network instead
3. Update NVIDIA Sync configuration with new IP

---

## Solution 4: Use SSH Tunnel (If You Have Intermediate Host)

### Step 1: Find Intermediate Host
- A server that can reach BOTH your network AND 10.1.10.x network
- Could be a jump host, bastion server, or gateway

### Step 2: Create SSH Tunnel
```bash
ssh -L 2222:10.1.10.181:22 user@intermediate-host
```

### Step 3: Update NVIDIA Sync Configuration
- Modify connection to use `localhost:2222` instead of `10.1.10.181:22`
- This requires editing the configuration files

---

## Solution 5: Contact Network Administrator

If you're in an enterprise environment:

1. **Contact IT/Network Team:**
   - Explain you need access to `10.1.10.181` (Spark-15b9)
   - Request VPN access or network routing configuration
   - Provide your Mac's IP: `10.0.1.173`

2. **Provide Details:**
   - Source: `10.0.1.173` (your Mac)
   - Destination: `10.1.10.181` (Spark-15b9)
   - Purpose: NVIDIA Sync remote connection
   - Port: 22 (SSH)

---

## Quick Test After Any Solution

After implementing any solution above, test with:

```bash
# 1. Test basic connectivity
ping -c 3 10.1.10.181

# 2. Test SSH port
nc -zv -w 2 10.1.10.181 22

# 3. Test SSH connection
ssh -v -o ConnectTimeout=5 privegroup@10.1.10.181

# 4. Connect NVIDIA Sync (automatic)
./test-and-connect.sh
```

---

## Which Solution Should You Use?

- **Remote connection?** → Use **Solution 1 (VPN)**
- **Have router admin access?** → Use **Solution 2 (Router)**
- **Physically near Spark-15b9?** → Use **Solution 3 (Same Network)**
- **Have intermediate server?** → Use **Solution 4 (SSH Tunnel)**
- **Enterprise environment?** → Use **Solution 5 (Contact Admin)**

---

## Once Fixed

NVIDIA Sync will automatically connect - no configuration changes needed! The daemon is already properly configured and waiting.

Run `./test-and-connect.sh` to verify and connect immediately.








