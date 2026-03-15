# Información de Conexión - ESP32-S3 Waveshare

## ✅ Estado de la Conexión

**La placa está conectada y detectada correctamente.**

### Puerto Serial Detectado

- **Puerto principal**: `/dev/cu.usbmodem2101`
- **Puerto alternativo**: `/dev/tty.usbmodem2101`
- **Permisos**: ✅ Lectura/escritura OK
- **Baudrate recomendado**: 115200

---

## Uso Rápido

### 1. En Arduino IDE

1. Abre **Arduino IDE**
2. Ve a `Herramientas` > `Puerto`
3. Selecciona: **`/dev/cu.usbmodem2101`**
4. Configura la placa: `Herramientas` > `Placa` > `ESP32S3 Dev Module`
5. Sube tu código

### 2. Monitoreo Serial

Para ver la salida del dispositivo en tiempo real:

```bash
screen /dev/cu.usbmodem2101 115200
```

**Para salir de screen**: Presiona `Ctrl+A` luego `K` y confirma con `Y`

### 3. Scripts de Prueba

#### Script de Conexión (Bash)
```bash
./connect-esp32.sh
```

Este script:
- Detecta automáticamente el puerto
- Verifica permisos
- Muestra información del dispositivo
- Indica herramientas disponibles

#### Script de Prueba Python (requiere pyserial)
```bash
python3 test-esp32-connection.py
```

---

## Instalación de Herramientas

### Instalar pyserial (para scripts Python)

Si tu sistema requiere entorno virtual:
```bash
python3 -m venv venv
source venv/bin/activate
pip install pyserial
```

O con Homebrew:
```bash
brew install pyserial
```

### Instalar Arduino CLI

```bash
brew install arduino-cli
```

Luego configura ESP32:
```bash
arduino-cli core update-index
arduino-cli core install esp32:esp32
```

---

## Verificación de Conexión

### Método 1: Verificar que el puerto existe
```bash
ls -la /dev/cu.usbmodem2101
```

### Método 2: Usar el script de conexión
```bash
./connect-esp32.sh
```

### Método 3: Probar comunicación serial
```bash
# Con screen (si está instalado)
screen /dev/cu.usbmodem2101 115200

# O con cu (si está instalado)
cu -l /dev/cu.usbmodem2101 -s 115200
```

---

## Solución de Problemas

### El puerto no aparece

1. **Verifica la conexión física**
   - Asegúrate de que el cable USB esté bien conectado
   - Prueba con otro cable USB (debe soportar datos, no solo carga)

2. **Revisa los drivers**
   - En macOS, los drivers USB generalmente se instalan automáticamente
   - Si no funciona, busca drivers específicos para ESP32-S3

3. **Reinicia la placa**
   - Presiona el botón RESET en la placa
   - Desconecta y vuelve a conectar el USB

### Error de permisos

Si obtienes "Permission denied":
```bash
sudo chmod 666 /dev/cu.usbmodem2101
```

O agrega tu usuario al grupo `dialout` (si existe en macOS):
```bash
sudo dseditgroup -o edit -a $(whoami) -t user dialout
```

### El puerto cambia de número

Si el puerto cambia (por ejemplo, a `usbmodem2102`):
- Es normal cuando desconectas y vuelves a conectar
- El script `connect-esp32.sh` detectará automáticamente el nuevo puerto
- En Arduino IDE, simplemente selecciona el nuevo puerto de la lista

---

## Comandos Útiles

### Listar todos los puertos seriales
```bash
ls /dev/cu.* /dev/tty.* | grep -i usb
```

### Ver información detallada del USB
```bash
system_profiler SPUSBDataType
```

### Monitorear el puerto en tiempo real
```bash
# Con screen
screen /dev/cu.usbmodem2101 115200

# Con minicom (si está instalado)
minicom -D /dev/cu.usbmodem2101 -b 115200
```

---

## Próximos Pasos

1. ✅ **Conexión verificada** - La placa está conectada
2. ⏭️ **Configurar Arduino IDE** - Sigue la guía en `WAVESHARE-ESP32-S3-GUIDE.md`
3. ⏭️ **Cargar código de prueba** - Usa el ejemplo básico de la guía
4. ⏭️ **Explorar funcionalidades** - Pantalla LCD, Wi-Fi, Bluetooth, Audio

---

**Última verificación**: Wed Nov 26 19:54:30 EST 2025
**Puerto activo**: `/dev/cu.usbmodem2101`

