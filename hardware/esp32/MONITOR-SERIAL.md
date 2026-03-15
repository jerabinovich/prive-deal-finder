# Cómo Monitorear el Puerto Serial del ESP32-S3

## Método 1: Usar Screen (Recomendado)

Ejecuta este comando directamente en tu terminal:

```bash
screen /dev/cu.usbmodem2101 115200
```

**Para salir de screen:**
1. Presiona `Ctrl+A`
2. Luego presiona `K`
3. Confirma con `Y`

## Método 2: Usar el Script de Monitoreo

Ejecuta el script que creamos:

```bash
./monitor-esp32.sh
```

Este script detectará automáticamente si `screen` está disponible y lo usará.

## Método 3: Arduino IDE Monitor Serial

1. Abre **Arduino IDE**
2. Conecta la placa (puerto `/dev/cu.usbmodem2101`)
3. Ve a `Herramientas` > `Monitor Serial`
4. Asegúrate de que el baudrate esté en **115200**

## Método 4: Instalar Screen (si no está instalado)

```bash
brew install screen
```

Luego usa el Método 1.

## Método 5: Usar Python (si pyserial está instalado)

Si tienes pyserial instalado, puedes usar este script:

```python
import serial
import time

port = '/dev/cu.usbmodem2101'
baudrate = 115200

ser = serial.Serial(port, baudrate, timeout=1)
print(f"Monitoreando {port} a {baudrate} baudios...")
print("Presiona Ctrl+C para salir\n")

try:
    while True:
        if ser.in_waiting > 0:
            line = ser.readline().decode('utf-8', errors='ignore')
            print(line, end='')
        time.sleep(0.01)
except KeyboardInterrupt:
    print("\n\nCerrando conexión...")
    ser.close()
```

---

## Notas Importantes

- **Baudrate**: El ESP32-S3 generalmente usa **115200** baudios por defecto
- **Puerto**: Si el puerto cambia (ej: `usbmodem2102`), actualiza el comando
- **Datos**: Si no ves datos, presiona el botón **RESET** en la placa
- **Primera conexión**: Puede tomar unos segundos para que la placa se inicialice

---

## Solución de Problemas

### "Device busy" o "Permission denied"
```bash
# Verifica que no hay otro proceso usando el puerto
lsof | grep usbmodem

# Si hay un proceso, ciérralo o usa otro método
```

### No se ven datos
1. Verifica que el código en la placa esté enviando datos por Serial
2. Presiona el botón RESET en la placa
3. Verifica que el baudrate sea correcto (115200)

### El puerto cambió
Ejecuta el script de conexión para detectar el nuevo puerto:
```bash
./connect-esp32.sh
```







