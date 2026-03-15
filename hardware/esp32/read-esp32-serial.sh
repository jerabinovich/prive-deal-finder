#!/bin/bash

# Script mejorado para leer datos del ESP32-S3

BAUDRATE=115200
OUTPUT_FILE="esp32-output-$(date +%Y%m%d-%H%M%S).txt"

echo "=========================================="
echo "Leyendo datos del ESP32-S3"
echo "=========================================="
echo ""

# Buscar puerto
PORT=""
PORTS=$(ls /dev/cu.usb* /dev/tty.usb* 2>/dev/null)

if [ -z "$PORTS" ]; then
    echo "✗ Error: No se encontraron puertos USB seriales"
    exit 1
fi

for port in $PORTS; do
    if [[ "$port" == *"usbmodem"* ]] || [[ "$port" == *"usbserial"* ]]; then
        PORT="$port"
        break
    fi
done

if [ -z "$PORT" ]; then
    PORT=$(echo $PORTS | awk '{print $1}')
fi

echo "Puerto: $PORT"
echo "Baudrate: $BAUDRATE"
echo ""
echo "⚠ IMPORTANTE:"
echo "1. Presiona RESET en la placa ESP32-S3 AHORA"
echo "2. O carga código que envíe datos por Serial"
echo ""
echo "Leyendo datos (15 segundos)..."
echo "=========================================="
echo ""

# Configurar el puerto serial
stty -f "$PORT" $BAUDRATE cs8 -cstopb -parenb raw -echo 2>/dev/null

# Leer datos con timeout
(
    cat "$PORT" 2>&1
) > "$OUTPUT_FILE" &
READ_PID=$!

# Esperar y luego matar el proceso
sleep 15
kill $READ_PID 2>/dev/null
wait $READ_PID 2>/dev/null

echo ""
echo "=========================================="
echo "Datos capturados:"
echo "=========================================="
if [ -s "$OUTPUT_FILE" ]; then
    cat "$OUTPUT_FILE"
    echo ""
    echo "=========================================="
    echo "✓ Datos guardados en: $OUTPUT_FILE"
else
    echo "(No se capturaron datos)"
    echo ""
    echo "Posibles razones:"
    echo "  - La placa no tiene código que envíe datos"
    echo "  - No se presionó RESET durante la captura"
    echo "  - La placa está en modo bootloader"
    echo ""
    echo "Sugerencias:"
    echo "  1. Presiona RESET en la placa y ejecuta este script de nuevo"
    echo "  2. Carga el código esp32-onboard-info.ino en Arduino IDE"
    echo "  3. Usa screen directamente: screen $PORT $BAUDRATE"
fi
echo ""







