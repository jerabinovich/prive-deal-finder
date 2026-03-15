# Parámetros Onboard del ESP32-S3

## Información que muestra la placa

Cuando la placa Waveshare ESP32-S3 se inicializa, puede mostrar información sobre sus parámetros onboard (parámetros integrados). Esta información típicamente incluye:

### Parámetros Comunes

1. **Información del Chip**
   - Modelo: ESP32-S3
   - Frecuencia del CPU
   - Número de cores
   - Versión del chip

2. **Memoria**
   - RAM disponible
   - Flash disponible
   - Particiones

3. **Configuración de Pines**
   - Pines de la pantalla LCD
   - Pines del altavoz (I2S)
   - Pines de comunicación (SPI, I2C)

4. **Configuración de Red**
   - MAC address
   - Configuración Wi-Fi (si está disponible)

5. **Versión del Firmware/Bootloader**
   - Versión del bootloader
   - Información del SDK

---

## Cómo Capturar los Parámetros

### Método 1: Usando el Script de Captura

```bash
./capture-esp32-output.sh
```

Este script capturará la salida durante 10 segundos y la guardará en un archivo.

### Método 2: Guardar Manualmente desde Screen

Si estás usando `screen`:
1. Presiona `Ctrl+A` luego `:`
2. Escribe `hardcopy output.txt`
3. Presiona Enter

### Método 3: Redirigir la Salida

```bash
screen /dev/cu.usbmodem2101 115200 | tee esp32-output.txt
```

---

## Código para Leer Parámetros Programáticamente

Si quieres leer los parámetros desde tu código Arduino:

```cpp
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  // Información del chip
  Serial.println("=== ESP32-S3 Onboard Parameters ===");
  Serial.print("Chip Model: ");
  Serial.println(ESP.getChipModel());
  Serial.print("Chip Revision: ");
  Serial.println(ESP.getChipRevision());
  Serial.print("CPU Frequency: ");
  Serial.print(ESP.getCpuFreqMHz());
  Serial.println(" MHz");
  Serial.print("Number of Cores: ");
  Serial.println(ESP.getChipCores());
  
  // Memoria
  Serial.print("Free Heap: ");
  Serial.print(ESP.getFreeHeap());
  Serial.println(" bytes");
  Serial.print("Total Heap: ");
  Serial.print(ESP.getHeapSize());
  Serial.println(" bytes");
  
  // Flash
  Serial.print("Flash Size: ");
  Serial.print(ESP.getFlashChipSize() / 1024 / 1024);
  Serial.println(" MB");
  Serial.print("Flash Speed: ");
  Serial.print(ESP.getFlashChipSpeed() / 1000000);
  Serial.println(" MHz");
  
  // MAC Address
  Serial.print("MAC Address: ");
  Serial.println(WiFi.macAddress());
  
  // SDK Version
  Serial.print("SDK Version: ");
  Serial.println(ESP.getSdkVersion());
  
  Serial.println("===================================");
}

void loop() {
  // Tu código aquí
}
```

---

## Interpretación de los Parámetros

### Ejemplo de Salida Típica

```
ESP32-S3 Chip Information:
- Model: ESP32-S3
- Cores: 2
- CPU Frequency: 240 MHz
- Flash: 8MB
- RAM: 512KB
- MAC: AA:BB:CC:DD:EE:FF
```

### Parámetros Específicos de Waveshare ESP32-S3 LCD

Para esta placa específica, los parámetros pueden incluir:

1. **Pantalla LCD (1.85" Round, 360x360)**
   - Driver: ST7789V (probable)
   - Resolución: 360x360
   - Interface: SPI
   - Pines: Configuración específica de Waveshare

2. **Altavoz (Smart Speaker Box)**
   - Interface: I2S
   - Pines: I2S_DATA, I2S_BCLK, I2S_LRCLK

3. **Touch (si está disponible)**
   - Interface: I2C o SPI
   - Pines específicos

---

## Documentar tus Parámetros

Si ves parámetros específicos en tu placa, compártelos o guárdalos en un archivo para referencia futura:

```bash
# Capturar y guardar
./capture-esp32-output.sh

# O manualmente desde screen
# Presiona Ctrl+A : hardcopy my-parameters.txt
```

---

## Recursos

- **Documentación ESP32-S3**: [docs.espressif.com](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/)
- **Waveshare Wiki**: [waveshare.com/wiki/ESP32-S3-LCD-1.85](https://www.waveshare.com/wiki/ESP32-S3-LCD-1.85)
- **Esquema de Pines**: Consulta la documentación de Waveshare para el pinout específico

---

## Notas

- Los parámetros onboard pueden variar según la versión del firmware
- Algunos parámetros solo están disponibles después de inicializar ciertos periféricos
- La información se muestra típicamente al iniciar o al presionar RESET







