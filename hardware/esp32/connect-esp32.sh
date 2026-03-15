#!/bin/bash
set -euo pipefail

# Script para conectar y verificar la placa Waveshare ESP32-S3

echo "=========================================="
echo "Conexión ESP32-S3 - Waveshare"
echo "=========================================="
echo ""

# Colores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

OS_NAME="$(uname -s)"

if [[ "${OS_NAME}" != "Darwin" && "${OS_NAME}" != "Linux" ]]; then
    echo -e "${RED}✗ Sistema no soportado: ${OS_NAME}${NC}"
    echo "   Compatible: macOS (Darwin) y Linux"
    exit 1
fi

find_serial_ports() {
    local -a ports=()

    shopt -s nullglob
    if [[ "${OS_NAME}" == "Darwin" ]]; then
        for port in /dev/cu.usb* /dev/tty.usb*; do
            ports+=("${port}")
        done
    else
        for port in /dev/ttyACM* /dev/ttyUSB* /dev/cu.usb* /dev/tty.usb*; do
            ports+=("${port}")
        done
    fi
    shopt -u nullglob

    printf '%s\n' "${ports[@]}"
}

# Buscar puertos USB
echo "1. Buscando dispositivos USB conectados..."
mapfile -t PORTS < <(find_serial_ports)

if [ "${#PORTS[@]}" -eq 0 ]; then
    echo -e "${RED}✗ No se encontraron puertos USB seriales${NC}"
    echo ""
    echo "Asegúrate de que:"
    echo "  - La placa ESP32-S3 esté conectada por USB"
    echo "  - El cable USB soporte transferencia de datos"
    echo "  - Los drivers estén instalados"
    exit 1
fi

echo -e "${GREEN}✓ Puertos encontrados:${NC}"
for port in "${PORTS[@]}"; do
    if [ -e "$port" ]; then
        echo "  → $port"
    fi
done

# Detectar el puerto específico
ESP32_PORT=""
for port in "${PORTS[@]}"; do
    if [[ "$port" == *"usbmodem"* ]] || [[ "$port" == *"usbserial"* ]] || [[ "$port" == *"ttyACM"* ]] || [[ "$port" == *"ttyUSB"* ]]; then
        ESP32_PORT="$port"
        break
    fi
done

if [ -z "$ESP32_PORT" ]; then
    ESP32_PORT="${PORTS[0]}"
fi

echo ""
echo "2. Información del dispositivo:"
if [ -n "$ESP32_PORT" ]; then
    echo -e "${GREEN}✓ Puerto seleccionado: ${ESP32_PORT}${NC}"
    
    # Verificar permisos
    if [ -r "$ESP32_PORT" ] && [ -w "$ESP32_PORT" ]; then
        echo -e "${GREEN}✓ Permisos de lectura/escritura: OK${NC}"
    else
        echo -e "${YELLOW}⚠ Puede que necesites permisos para acceder al puerto${NC}"
        if [[ "${OS_NAME}" == "Linux" ]]; then
            echo "   Sugerencia (Linux): agrega tu usuario al grupo dialout:"
            echo "   sudo usermod -a -G dialout $USER"
            echo "   Luego cierra sesión y vuelve a entrar."
        else
            echo "   Sugerencia (macOS): desconecta/conecta el USB y verifica permisos del dispositivo."
            echo "   Evita usar chmod 666 por riesgo de seguridad."
        fi
    fi
    
    # Información del puerto
    ls -lh "$ESP32_PORT" 2>/dev/null
else
    echo -e "${RED}✗ No se pudo determinar el puerto${NC}"
    exit 1
fi

echo ""
echo "3. Verificando herramientas disponibles..."

# Verificar Python y pyserial
if command -v python3 &> /dev/null; then
    echo -e "${GREEN}✓ Python3 encontrado${NC}"
    
    if python3 -c "import serial" 2>/dev/null; then
        echo -e "${GREEN}✓ pyserial instalado${NC}"
        echo ""
        echo "4. Ejecutando prueba de conexión..."
        python3 "$(dirname "$0")/test-esp32-connection.py"
    else
        echo -e "${YELLOW}⚠ pyserial no está instalado${NC}"
        echo ""
        echo "Para instalar pyserial, ejecuta:"
        echo "  pip3 install pyserial"
    fi
else
    echo -e "${YELLOW}⚠ Python3 no encontrado${NC}"
fi

# Verificar Arduino CLI
if command -v arduino-cli &> /dev/null; then
    echo -e "${GREEN}✓ Arduino CLI encontrado${NC}"
    echo ""
    echo "Para subir código con Arduino CLI:"
    echo "  arduino-cli upload -p \"$ESP32_PORT\" --fqbn esp32:esp32:esp32s3 <tu_sketch>"
else
    echo -e "${YELLOW}⚠ Arduino CLI no encontrado${NC}"
    echo ""
    echo "Para instalar Arduino CLI:"
    echo "  brew install arduino-cli"
fi

echo ""
echo "=========================================="
echo "Resumen:"
echo "=========================================="
echo "Puerto serial: $ESP32_PORT"
echo ""
echo "Para usar este puerto en Arduino IDE:"
echo "  1. Abre Arduino IDE"
echo "  2. Ve a Herramientas > Puerto"
echo "  3. Selecciona: $ESP32_PORT"
echo ""
echo "Para monitorear el puerto serial:"
echo "  screen \"$ESP32_PORT\" 115200"
echo "  (Presiona Ctrl+A luego K para salir)"
echo ""






