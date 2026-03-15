#!/usr/bin/env python3
"""
Script para probar la conexión con la placa Waveshare ESP32-S3
"""

import serial
import serial.tools.list_ports
import sys
import time

def find_esp32_port():
    """Busca el puerto serial del ESP32"""
    ports = serial.tools.list_ports.comports()
    esp32_ports = []
    
    for port in ports:
        # Busca puertos USB que podrían ser ESP32
        if 'usbmodem' in port.device.lower() or 'usbserial' in port.device.lower():
            esp32_ports.append(port)
            print(f"Puerto encontrado: {port.device} - {port.description}")
    
    return esp32_ports

def test_connection(port_name, baudrate=115200):
    """Prueba la conexión serial con la placa"""
    try:
        print(f"\nIntentando conectar a {port_name} a {baudrate} baudios...")
        ser = serial.Serial(port_name, baudrate, timeout=2)
        time.sleep(2)  # Espera a que la placa se inicialice
        
        print("✓ Conexión establecida exitosamente!")
        print(f"  - Puerto: {port_name}")
        print(f"  - Baudrate: {baudrate}")
        print(f"  - Timeout: {ser.timeout}s")
        
        # Intenta leer datos si hay algo disponible
        print("\nEsperando datos del dispositivo (presiona RESET en la placa si no hay salida)...")
        time.sleep(1)
        
        if ser.in_waiting > 0:
            print("\nDatos recibidos:")
            for _ in range(5):  # Lee hasta 5 líneas
                if ser.in_waiting > 0:
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    if line:
                        print(f"  → {line}")
                time.sleep(0.5)
        else:
            print("  (No hay datos disponibles - esto es normal si la placa no está enviando nada)")
        
        ser.close()
        print("\n✓ Prueba completada exitosamente!")
        return True
        
    except serial.SerialException as e:
        print(f"✗ Error al conectar: {e}")
        return False
    except Exception as e:
        print(f"✗ Error inesperado: {e}")
        return False

def main():
    print("=" * 60)
    print("Prueba de Conexión - Waveshare ESP32-S3")
    print("=" * 60)
    
    # Busca puertos disponibles
    print("\n1. Buscando puertos seriales...")
    ports = find_esp32_port()
    
    if not ports:
        print("\n✗ No se encontraron puertos USB seriales.")
        print("\nAsegúrate de que:")
        print("  - La placa ESP32-S3 esté conectada por USB")
        print("  - Los drivers USB estén instalados")
        print("  - El cable USB soporte transferencia de datos")
        return False
    
    # Usa el primer puerto encontrado o el específico
    target_port = None
    
    # Busca específicamente el puerto detectado
    for port in ports:
        if 'usbmodem2101' in port.device:
            target_port = port.device
            break
    
    if not target_port and ports:
        target_port = ports[0].device
    
    if target_port:
        print(f"\n2. Probando conexión con {target_port}...")
        return test_connection(target_port)
    else:
        print("\n✗ No se pudo determinar el puerto a usar.")
        return False

if __name__ == "__main__":
    try:
        success = main()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\nPrueba cancelada por el usuario.")
        sys.exit(1)







