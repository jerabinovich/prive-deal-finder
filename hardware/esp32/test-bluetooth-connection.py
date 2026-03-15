#!/usr/bin/env python3
"""
Bluetooth BLE Connection Test Script for ESP32-S3
Tests Bluetooth Low Energy connectivity and communication
"""

import asyncio
import sys
from bleak import BleakScanner, BleakClient
from bleak.backends.characteristic import BleakGATTCharacteristic
import time

# Common ESP32 BLE service UUIDs
ESP32_SERVICE_UUID = "0000ff00-0000-1000-8000-00805f9b34fb"
ESP32_CHAR_UUID = "0000ff01-0000-1000-8000-00805f9b34fb"

async def scan_for_devices(timeout=10.0):
    """Scan for BLE devices"""
    print("=" * 60)
    print("Bluetooth BLE Device Scanner")
    print("=" * 60)
    print(f"\nScanning for {timeout} seconds...")
    print("Make sure your ESP32-S3 is powered on and advertising\n")
    
    devices = await BleakScanner.discover(timeout=timeout)
    
    if not devices:
        print("✗ No BLE devices found")
        print("\nTroubleshooting:")
        print("  - Ensure ESP32-S3 is powered on")
        print("  - Check that BLE is enabled in your ESP32 code")
        print("  - Make sure the device is within range")
        return []
    
    print(f"✓ Found {len(devices)} BLE device(s):\n")
    
    esp32_devices = []
    for i, device in enumerate(devices, 1):
        name = device.name or "Unknown"
        addr = device.address
        rssi = device.rssi if hasattr(device, 'rssi') else "N/A"
        
        print(f"{i}. {name}")
        print(f"   Address: {addr}")
        print(f"   RSSI: {rssi} dBm")
        
        # Check if it might be an ESP32
        if "ESP32" in name.upper() or "ESP" in name.upper():
            esp32_devices.append(device)
            print(f"   → Potential ESP32 device!")
        print()
    
    return devices, esp32_devices

async def get_device_services(client):
    """Get all services and characteristics from a device"""
    print("Services and Characteristics:")
    print("-" * 60)
    
    services = await client.get_services()
    for service in services:
        print(f"\nService: {service.uuid}")
        print(f"  Description: {service.description}")
        
        for char in service.characteristics:
            props = char.properties
            props_str = ", ".join(props)
            print(f"  Characteristic: {char.uuid}")
            print(f"    Properties: {props_str}")
            print(f"    Handle: {char.handle}")
    
    return services

async def test_connection(device_address, device_name=""):
    """Test connection to a BLE device"""
    print("=" * 60)
    print(f"Testing Connection to: {device_name or device_address}")
    print("=" * 60)
    print()
    
    try:
        print(f"Connecting to {device_address}...")
        async with BleakClient(device_address, timeout=10.0) as client:
            print(f"✓ Connected successfully!")
            print(f"  Address: {device_address}")
            print(f"  Is Connected: {client.is_connected}")
            print()
            
            # Get device info
            print("Device Information:")
            print("-" * 60)
            print(f"  MTU Size: {client.mtu_size}")
            print()
            
            # Get services
            services = await get_device_services(client)
            
            # Try to find ESP32 service
            esp32_service = None
            for service in services:
                if "ff00" in service.uuid.lower() or "esp32" in str(service.uuid).lower():
                    esp32_service = service
                    break
            
            if esp32_service:
                print(f"\n✓ Found ESP32 service: {esp32_service.uuid}")
                print("\nYou can now interact with the ESP32 via BLE!")
            else:
                print("\n⚠ No standard ESP32 service found")
                print("  The device may use custom service UUIDs")
            
            print("\n✓ Connection test successful!")
            return True
            
    except asyncio.TimeoutError:
        print(f"✗ Connection timeout - device may not be reachable")
        return False
    except Exception as e:
        print(f"✗ Connection failed: {e}")
        return False

async def main():
    """Main function"""
    print("\n" + "=" * 60)
    print("ESP32-S3 Bluetooth BLE Connection Test")
    print("=" * 60)
    print()
    
    # Check if bleak is available
    try:
        import bleak
    except ImportError:
        print("✗ Error: bleak library not installed")
        print("\nInstall it with:")
        print("  pip3 install bleak")
        sys.exit(1)
    
    # Step 1: Scan for devices
    devices, esp32_devices = await scan_for_devices(timeout=15.0)
    
    if not devices:
        print("\nNo devices found. Exiting.")
        return
    
    # Step 2: Ask user to select a device
    if esp32_devices:
        print(f"\n✓ Found {len(esp32_devices)} potential ESP32 device(s)")
        print("\nSelect a device to test connection:")
        print("  0 - Test all devices")
        
        for i, device in enumerate(esp32_devices, 1):
            print(f"  {i} - {device.name or device.address}")
        
        try:
            choice = input("\nEnter choice (0-{}): ".format(len(esp32_devices)))
            choice = int(choice)
            
            if choice == 0:
                # Test all ESP32 devices
                for device in esp32_devices:
                    await test_connection(device.address, device.name)
                    print("\n" + "=" * 60 + "\n")
            elif 1 <= choice <= len(esp32_devices):
                device = esp32_devices[choice - 1]
                await test_connection(device.address, device.name)
            else:
                print("Invalid choice")
        except (ValueError, KeyboardInterrupt):
            print("\nCancelled")
    else:
        print("\n⚠ No ESP32 devices found, but you can test other devices")
        print("\nSelect a device to test connection:")
        print("  0 - Skip connection test")
        
        for i, device in enumerate(devices[:5], 1):  # Show first 5
            print(f"  {i} - {device.name or device.address}")
        
        try:
            choice = input("\nEnter choice (0-{}): ".format(min(5, len(devices))))
            choice = int(choice)
            
            if choice == 0:
                print("Skipping connection test")
            elif 1 <= choice <= min(5, len(devices)):
                device = devices[choice - 1]
                await test_connection(device.address, device.name)
            else:
                print("Invalid choice")
        except (ValueError, KeyboardInterrupt):
            print("\nCancelled")
    
    print("\n" + "=" * 60)
    print("Test Complete")
    print("=" * 60)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nTest cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Error: {e}")
        sys.exit(1)






