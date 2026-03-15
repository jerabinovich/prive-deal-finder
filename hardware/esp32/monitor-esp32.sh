#!/bin/bash

# Script para monitorear el puerto serial del ESP32-S3

PORT="/dev/cu.usbmodem2101"
BAUDRATE=115200

echo "=========================================="
echo "Monitor Serial - ESP32-S3"
echo "=========================================="
echo ""
echo "Puerto: $PORT"
echo "Baudrate: $BAUDRATE"
echo ""
echo "Presiona Ctrl+C para salir"
echo "=========================================="
echo ""

# Verificar que el puerto existe
if [ ! -e "$PORT" ]; then
    echo "Error: El puerto $PORT no existe"
    echo ""
    echo "Buscando puertos disponibles..."
    ls /dev/cu.usb* /dev/tty.usb* 2>/dev/null
    exit 1
fi

# Intentar usar screen primero
if command -v screen &> /dev/null; then
    echo "Usando screen para monitorear el puerto..."
    echo "(Presiona Ctrl+A luego K para salir)"
    echo ""
    screen "$PORT" "$BAUDRATE"
elif command -v minicom &> /dev/null; then
    echo "Usando minicom para monitorear el puerto..."
    minicom -D "$PORT" -b "$BAUDRATE"
else
    echo "Screen y minicom no están disponibles."
    echo ""
    echo "Opciones:"
    echo "1. Instalar screen: brew install screen"
    echo "2. Usar el Monitor Serial de Arduino IDE"
    echo "3. Ejecutar este comando directamente en tu terminal:"
    echo "   screen $PORT $BAUDRATE"
    echo ""
    echo "Intentando leer datos con cat (presiona Ctrl+C para salir)..."
    echo ""
    cat "$PORT"
fi







