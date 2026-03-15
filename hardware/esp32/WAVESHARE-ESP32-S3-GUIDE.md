# Guía de Programación: Waveshare ESP32-S3 1.85" Round LCD Development Board

## Descripción del Dispositivo

La placa de desarrollo Waveshare ESP32-S3 con pantalla LCD redonda de 1.85 pulgadas (360×360 píxeles) incluye:
- **Microcontrolador**: ESP32-S3
- **Pantalla**: LCD redonda de 1.85 pulgadas, resolución 360×360
- **Conectividad**: Wi-Fi y Bluetooth BLE 5
- **Características adicionales**: AI Speech, Smart Speaker Box, altavoz integrado

## Entornos de Desarrollo Soportados

Puedes programar esta placa usando:
1. **Arduino IDE** (recomendado para principiantes)
2. **ESP-IDF** (entorno oficial de Espressif, más avanzado)
3. **MicroPython** (programación en Python)

---

## Configuración con Arduino IDE

### 1. Instalación del Arduino IDE

- Descarga e instala la versión más reciente del Arduino IDE desde [arduino.cc](https://www.arduino.cc/en/software)

### 2. Configuración del Soporte para ESP32

1. Abre el Arduino IDE
2. Ve a `Archivo` > `Preferencias`
3. En el campo **"Gestor de URLs adicionales de tarjetas"**, añade:
   ```
   https://dl.espressif.com/dl/package_esp32_index.json
   ```
4. Ve a `Herramientas` > `Placa` > `Gestor de tarjetas...`
5. Busca "esp32" e instala el paquete **"esp32"** de Espressif Systems

### 3. Configuración de la Placa

1. En `Herramientas` > `Placa`, selecciona **"ESP32S3 Dev Module"**
2. Asegúrate de que el puerto COM correspondiente esté seleccionado en `Herramientas` > `Puerto`
3. Si la placa solo tiene un puerto USB, activa la opción **"USB CDC"** en `Herramientas` > `USB CDC On Boot`

### 4. Instalación de Bibliotecas Necesarias

#### LVGL (Librería Gráfica)
- **Propósito**: Crear interfaces de usuario avanzadas para la pantalla
- **Instalación**: 
  - Desde el Gestor de Bibliotecas del Arduino IDE, busca "LVGL"
  - O descarga manualmente desde: [github.com/lvgl/lvgl](https://github.com/lvgl/lvgl)

#### ESP32-audioI2S
- **Propósito**: Manejo de audio para el altavoz integrado
- **Instalación**:
  - Desde el Gestor de Bibliotecas del Arduino IDE
  - O desde: [github.com/earlephilhower/ESP8266Audio](https://github.com/earlephilhower/ESP8266Audio)

---

## Ejemplo de Código Básico

### Programa de Prueba Inicial

```cpp
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("ESP32-S3 LCD Board iniciado correctamente");
}

void loop() {
  Serial.println("Hola, Mundo!");
  delay(2000);
}
```

Este código:
- Inicializa la comunicación serial a 115200 baudios
- Imprime un mensaje cada 2 segundos
- Úsalo para verificar que la placa funciona correctamente

---

## Configuración con ESP-IDF

ESP-IDF es el entorno de desarrollo oficial de Espressif y ofrece más control sobre el hardware.

### Instalación

1. Instala **Visual Studio Code**
2. Instala el complemento **"Espressif IDF"** desde el marketplace de VS Code
3. Sigue las instrucciones del complemento para configurar ESP-IDF

### Ventajas de ESP-IDF

- Control más detallado del hardware
- Mejor rendimiento
- Acceso a todas las características del ESP32-S3
- Ideal para proyectos avanzados

---

## Configuración con MicroPython

Si prefieres programar en Python:

1. Instala **MicroPython** en la placa
2. Usa un entorno como **Thonny** para desarrollar
3. Permite programación más rápida y fácil para algunos proyectos

---

## Recursos Adicionales

### Documentación Oficial

- **Wiki de Waveshare**: [waveshare.com/wiki/ESP32-S3-LCD-1.85](https://www.waveshare.com/wiki/ESP32-S3-LCD-1.85)
- **Página del Producto**: [waveshare.com/esp32-s3-touch-lcd-1.85c.htm](https://www.waveshare.com/esp32-s3-touch-lcd-1.85c.htm)

### Repositorios de Ejemplos

- Busca en GitHub ejemplos específicos para "ESP32-S3-LCD-1.85"
- Waveshare suele proporcionar repositorios con demos y ejemplos

### Video Tutorial

- [ESP32-S3 1.85inch Round LCD Development Board - YouTube](https://www.youtube.com/watch?v=7WFi56rvMSw)

---

## Características Principales a Programar

### 1. Pantalla LCD (360×360)
- Usa LVGL para crear interfaces gráficas
- Soporta gráficos, texto, imágenes
- Pantalla redonda - considera esto en el diseño

### 2. Wi-Fi
- Conectividad a redes inalámbricas
- Puede funcionar como servidor web o cliente
- Útil para IoT y proyectos conectados

### 3. Bluetooth BLE 5
- Comunicación Bluetooth de bajo consumo
- Ideal para conectar con smartphones y otros dispositivos

### 4. Audio (Smart Speaker Box)
- Altavoz integrado
- Usa ESP32-audioI2S para reproducir audio
- Soporta varios formatos de audio

### 5. AI Speech
- Capacidades de reconocimiento de voz
- Procesamiento de comandos de voz
- Requiere bibliotecas específicas de IA

---

## Próximos Pasos

1. **Configura el entorno** (Arduino IDE recomendado para empezar)
2. **Carga el programa de prueba** para verificar la conexión
3. **Explora los ejemplos** de Waveshare para la pantalla LCD
4. **Experimenta con LVGL** para crear interfaces gráficas
5. **Prueba las funciones de audio** con el altavoz integrado
6. **Implementa conectividad Wi-Fi** para proyectos IoT

---

## Notas Importantes

- La pantalla es **redonda**, no rectangular - ajusta tus diseños en consecuencia
- El ESP32-S3 tiene más memoria y potencia que el ESP32 estándar
- Asegúrate de tener los drivers USB correctos instalados
- La velocidad de comunicación serial recomendada es **115200 baudios**

---

## Solución de Problemas

### La placa no se detecta
- Verifica los drivers USB
- Prueba otro cable USB
- Asegúrate de que el puerto COM esté correctamente seleccionado

### Error al compilar
- Verifica que todas las bibliotecas estén instaladas
- Asegúrate de tener la versión correcta del paquete ESP32
- Revisa que la placa seleccionada sea "ESP32S3 Dev Module"

### La pantalla no muestra nada
- Verifica las conexiones
- Revisa los ejemplos de Waveshare para la inicialización correcta
- Asegúrate de que LVGL esté correctamente configurado

---

**Última actualización**: Basado en información disponible de Waveshare y recursos de la comunidad ESP32







