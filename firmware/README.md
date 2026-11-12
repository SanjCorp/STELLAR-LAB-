# STELLAR Node para ESP32 de 38 pines

Configuración asumida: **ESP32 DevKit V1 / ESP32-WROOM-32 de 38 pines**, módulo ECG **AD8232**, un cinturón respiratorio analógico y un único sensor de movimiento **MPU6050** colocado en el pie.

## Librerías en Arduino IDE

Desde **Herramientas > Administrar bibliotecas**, instala:

- Adafruit MPU6050
- Adafruit Unified Sensor
- ArduinoJson

`WiFi`, `HTTPClient` y `Wire` vienen con el paquete de placas ESP32. En **Gestor de tarjetas**, instala `esp32 by Espressif Systems` y selecciona `ESP32 Dev Module`.

## Cableado

| Módulo | Pin del módulo | ESP32 |
|---|---|---|
| AD8232 | OUTPUT | GPIO 34 (ADC, solo entrada) |
| AD8232 | LO+ | GPIO 32 |
| AD8232 | LO- | GPIO 33 |
| AD8232 | 3.3V | 3V3 |
| AD8232 | GND | GND |
| Cinturón respiratorio | Señal analógica | GPIO 35 (ADC, solo entrada) |
| Cinturón respiratorio | VCC | 3V3 |
| Cinturón respiratorio | GND | GND |
| MPU6050 | SDA | GPIO 21 |
| MPU6050 | SCL | GPIO 22 |
| MPU6050 | VCC | 3V3 |
| MPU6050 | GND | GND |

Edita `WIFI_SSID`, `WIFI_PASSWORD` y `API_URL` en el archivo `.ino`. Se dejó configurada la IP local detectada (`http://192.168.1.2:8000/api/telemetry`). Si el router cambia esa dirección, actualízala; no uses `localhost` desde el ESP32.

Cada astronauta debe usar un nodo distinto. Antes de cargar el programa cambia `ASTRONAUT_ID` y `DEVICE_ID`:

| Astronauta | `ASTRONAUT_ID` | Ejemplo de `DEVICE_ID` |
|---|---|---|
| Randy Bresnik | `bresnik` | `stellar-node-bresnik` |
| Luca Parmitano | `parmitano` | `stellar-node-parmitano` |
| Andre Douglas | `douglas` | `stellar-node-douglas` |
| Frank Rubio | `rubio` | `stellar-node-rubio` |

El nodo envía por Wi-Fi a `POST /api/telemetry`: ECG crudo, pulso estimado, respiración, aceleración, giroscopio, posición 2D, área, pasos y batería. El umbral del pulso (`180`) es demostrativo y debe calibrarse con el AD8232 real.

La estimación de área usa doble integración con corrección cuando el pie está quieto. Sirve para una demostración, pero acumula deriva y no sustituye un sistema de posicionamiento. Envía `r` por el monitor serie para reiniciar posición y área.

La entrada respiratoria espera un cinturón piezorresistivo o sensor de estiramiento con salida acondicionada entre 0 y 3.3 V. El umbral de detección (`60`) debe calibrarse con el sensor físico. Nunca apliques más de 3.3 V a un GPIO del ESP32.

> El AD8232 y el cinturón respiratorio de este prototipo no constituyen equipos clínicos. Usa únicamente alimentación por batería y no conectes el cuerpo a equipos alimentados desde la red eléctrica.

