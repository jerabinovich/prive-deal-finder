/*
 * ESP32-S3 Onboard Parameters Reader
 * Muestra información detallada de los parámetros onboard de la placa
 * Compatible con Waveshare ESP32-S3 1.85" Round LCD
 */

void setup() {
  // Inicializar comunicación serial
  Serial.begin(115200);
  delay(2000); // Esperar a que el monitor serial se conecte
  
  Serial.println("\n");
  Serial.println("==========================================");
  Serial.println("ESP32-S3 Onboard Parameters");
  Serial.println("==========================================");
  Serial.println();
  
  // ==========================================
  // INFORMACIÓN DEL CHIP
  // ==========================================
  Serial.println("--- CHIP INFORMATION ---");
  Serial.print("Chip Model: ");
  Serial.println(ESP.getChipModel());
  
  Serial.print("Chip Revision: ");
  Serial.println(ESP.getChipRevision());
  
  Serial.print("CPU Frequency: ");
  Serial.print(ESP.getCpuFreqMHz());
  Serial.println(" MHz");
  
  Serial.print("Number of Cores: ");
  Serial.println(ESP.getChipCores());
  
  Serial.print("Chip Features: ");
  Serial.println(ESP.getChipFeatures());
  
  Serial.println();
  
  // ==========================================
  // MEMORIA
  // ==========================================
  Serial.println("--- MEMORY INFORMATION ---");
  Serial.print("Free Heap: ");
  Serial.print(ESP.getFreeHeap());
  Serial.println(" bytes");
  
  Serial.print("Largest Free Block: ");
  Serial.print(ESP.getMaxAllocHeap());
  Serial.println(" bytes");
  
  Serial.print("Minimum Free Heap (ever): ");
  Serial.print(ESP.getMinFreeHeap());
  Serial.println(" bytes");
  
  Serial.print("Total Heap Size: ");
  Serial.print(ESP.getHeapSize());
  Serial.println(" bytes");
  
  Serial.println();
  
  // ==========================================
  // FLASH
  // ==========================================
  Serial.println("--- FLASH INFORMATION ---");
  Serial.print("Flash Size: ");
  Serial.print(ESP.getFlashChipSize() / 1024 / 1024);
  Serial.println(" MB");
  
  Serial.print("Flash Speed: ");
  Serial.print(ESP.getFlashChipSpeed() / 1000000);
  Serial.println(" MHz");
  
  Serial.print("Flash Mode: ");
  uint8_t flashMode = ESP.getFlashChipMode();
  switch(flashMode) {
    case FM_QIO:  Serial.println("QIO"); break;
    case FM_QOUT: Serial.println("QOUT"); break;
    case FM_DIO:  Serial.println("DIO"); break;
    case FM_DOUT: Serial.println("DOUT"); break;
    default: Serial.println("Unknown"); break;
  }
  
  Serial.println();
  
  // ==========================================
  // SDK Y VERSIÓN
  // ==========================================
  Serial.println("--- SDK INFORMATION ---");
  Serial.print("SDK Version: ");
  Serial.println(ESP.getSdkVersion());
  
  Serial.print("Arduino Core Version: ");
  Serial.println(ESP.getCoreVersion());
  
  Serial.println();
  
  // ==========================================
  // RED (Wi-Fi)
  // ==========================================
  Serial.println("--- NETWORK INFORMATION ---");
  Serial.print("MAC Address: ");
  Serial.println(WiFi.macAddress());
  
  Serial.print("Hostname: ");
  Serial.println(WiFi.getHostname());
  
  Serial.println();
  
  // ==========================================
  // INFORMACIÓN DEL SISTEMA
  // ==========================================
  Serial.println("--- SYSTEM INFORMATION ---");
  Serial.print("Free Sketch Space: ");
  Serial.print(ESP.getFreeSketchSpace());
  Serial.println(" bytes");
  
  Serial.print("Sketch Size: ");
  Serial.print(ESP.getSketchSize());
  Serial.println(" bytes");
  
  Serial.print("Sketch MD5: ");
  Serial.println(ESP.getSketchMD5());
  
  Serial.println();
  
  // ==========================================
  // INFORMACIÓN ESPECÍFICA DE WAVESHARE
  // ==========================================
  Serial.println("--- WAVESHARE ESP32-S3 LCD 1.85\" ---");
  Serial.println("Display: 1.85\" Round LCD, 360x360 pixels");
  Serial.println("Features: Wi-Fi, Bluetooth BLE 5, AI Speech, Speaker");
  Serial.println();
  
  Serial.println("==========================================");
  Serial.println("Parameters reading complete!");
  Serial.println("==========================================");
  Serial.println();
  Serial.println("Press RESET button to see parameters again.");
  Serial.println();
}

void loop() {
  // Mostrar información de memoria cada 5 segundos
  static unsigned long lastUpdate = 0;
  unsigned long now = millis();
  
  if (now - lastUpdate >= 5000) {
    lastUpdate = now;
    
    Serial.print("[");
    Serial.print(now / 1000);
    Serial.print("s] Free Heap: ");
    Serial.print(ESP.getFreeHeap());
    Serial.println(" bytes");
  }
  
  delay(100);
}







