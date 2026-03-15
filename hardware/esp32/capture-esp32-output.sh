#!/bin/bash

# Script para capturar la salida del ESP32-S3 y guardarla en un archivo

BAUDRATE=115200
OUTPUT_FILE="esp32-output-$(date +%Y%m%d-%H%M%S).txt"

echo "=========================================="
echo "Capturando salida del ESP32-S3"
echo "=========================================="
echo ""

# Buscar puerto ESP32 automáticamente
PORT=""
PORTS=$(ls /dev/cu.usb* /dev/tty.usb* 2>/dev/null)

if [ -z "$PORTS" ]; then
    echo "✗ Error: No se encontraron puertos USB seriales"
    echo ""
    echo "Asegúrate de que:"
    echo "  - La placa ESP32-S3 esté conectada por USB"
    echo "  - El cable USB soporte transferencia de datos"
    echo "  - Los drivers estén instalados"
    exit 1
fi

# Buscar puerto usbmodem o usbserial
for port in $PORTS; do
    if [[ "$port" == *"usbmodem"* ]] || [[ "$port" == *"usbserial"* ]]; then
        PORT="$port"
        break
    fi
done

# Si no se encontró, usar el primero disponible
if [ -z "$PORT" ]; then
    PORT=$(echo $PORTS | awk '{print $1}')
fi

echo "Puerto detectado: $PORT"
echo "Baudrate: $BAUDRATE"
echo "Archivo de salida: $OUTPUT_FILE"
echo ""
echo "Presiona Ctrl+C para detener la captura"
echo "=========================================="
echo ""

# Verificar que el puerto existe
if [ ! -e "$PORT" ]; then
    echo "✗ Error: El puerto $PORT no existe"
    exit 1
fi

# Capturar usando cat y guardar en archivo
echo "Iniciando captura... (10 segundos)"
echo "Presiona RESET en la placa para ver los parámetros onboard"
echo ""

# Intentar usar timeout si está disponible, sino usar head para limitar
if command -v timeout &> /dev/null; then
    timeout 10 cat "$PORT" > "$OUTPUT_FILE" 2>&1
else
    # En macOS, usar gtimeout o simplemente limitar con head
    (cat "$PORT" 2>&1 | head -200) > "$OUTPUT_FILE" &
    CAPTURE_PID=$!
    sleep 10
    kill $CAPTURE_PID 2>/dev/null
    wait $CAPTURE_PID 2>/dev/null
fi

echo ""
echo "Captura completada. Mostrando contenido:"
echo "=========================================="
cat "$OUTPUT_FILE"
echo ""
echo "=========================================="
echo "Contenido guardado en: $OUTPUT_FILE"

