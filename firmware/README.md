# Firmware STELLAR Node

El firmware principal está en [`versionnasaofi/versionnasaofi.ino`](../versionnasaofi/versionnasaofi.ino). Está preparado para un **ESP32 DevKit V1 / ESP32-WROOM-32 de 38 pines**, un módulo ECG **AD8232** y un **MPU6050** colocado en el pie.

## Qué hace el nodo

- Muestrea el AD8232 a 250 Hz.
- Filtra el ECG y estima frecuencia cardiaca desde los complejos QRS.
- Estima respiración desde variaciones lentas del ECG; no usa un cinturón respiratorio independiente.
- Lee aceleración y giroscopio del MPU6050 a 50 Hz.
- Estima X, Y, Z y distancia desde el punto cero.
- Detecta si la posición estimada supera el radio demostrativo de 2 m.
- Aloja una página web local para introducir temperatura, presión y radiación simuladas.
- Envía una fila por segundo a Supabase mediante HTTPS.
- Separa la lectura ECG de las comunicaciones usando tareas de ambos núcleos.

## Arduino IDE

Instala:

1. En **Gestor de tarjetas**, `esp32 by Espressif Systems` y selecciona **ESP32 Dev Module**.
2. En **Administrador de bibliotecas**, `ArduinoJson`.

`WebServer`, `WiFi`, `WiFiClientSecure`, `HTTPClient` y `Wire` forman parte del paquete de placas ESP32. El firmware accede al MPU6050 directamente por I²C, por lo que no necesita las librerías Adafruit MPU6050 ni Adafruit Unified Sensor.

## Cableado

| Módulo | Pin del módulo | ESP32 |
|---|---|---|
| AD8232 | OUTPUT | GPIO 34 |
| AD8232 | LO+ | GPIO 32 |
| AD8232 | LO- | GPIO 33 |
| AD8232 | 3.3V | 3V3 |
| AD8232 | GND | GND |
| MPU6050 | SDA | GPIO 21 |
| MPU6050 | SCL | GPIO 22 |
| MPU6050 | VCC | 3V3 |
| MPU6050 | GND | GND |

GPIO 34 pertenece a ADC1 y puede utilizarse mientras el Wi-Fi está activo. No apliques más de 3.3 V a ningún GPIO.

## Credenciales locales

Dentro de `versionnasaofi`:

1. Copia `secrets.example.h` como `secrets.h`.
2. Completa `WIFI_SSID`, `WIFI_PASSWORD`, `SUPABASE_URL` y la clave pública de inserción.
3. Define `ASTRONAUT_ID` y un `DEVICE_ID` único.

`secrets.h` está ignorado por Git y no debe publicarse.

| Astronauta | `ASTRONAUT_ID` | `DEVICE_ID` sugerido |
|---|---|---|
| Randy Bresnik | `bresnik` | `stellar-ecg-bresnik` |
| Luca Parmitano | `parmitano` | `stellar-ecg-parmitano` |
| Andre Douglas | `douglas` | `stellar-ecg-douglas` |
| Frank Rubio | `rubio` | `stellar-ecg-rubio` |

## Arranque y calibración

1. Coloca el MPU6050 en el punto que será X=0, Y=0, Z=0.
2. Enciende el ESP32 y no muevas el sensor durante los cinco segundos de calibración.
3. Abre el monitor serie a 115200 baudios.
4. Espera a que aparezcan la IP local y el mensaje de conexión Wi-Fi.
5. Coloca correctamente los electrodos del AD8232 y permanece quieto unos segundos mientras se adapta el detector.

El botón **Restablecer posición cero** de la página local vuelve a guardar el origen. El MPU6050 acumula deriva y no puede sustituir un sistema UWB o GPS para obtener distancia absoluta.

## Servidor web local del ESP32

Abre en un navegador la dirección indicada en el monitor serie, por ejemplo:

```text
http://192.168.1.50
```

La página permite:

- Introducir temperatura corporal.
- Introducir presión sistólica y diastólica.
- Mover el control de radiación entre 0.000 y 0.020 mSv/h.
- Enviar los cambios de radiación mientras se mueve el control.
- Consultar posición y distancia estimadas.
- Restablecer el punto cero.

Estos valores son simulados y se identifican como tales en la aplicación.

## Datos enviados

El firmware inserta en `telemetry`, entre otros:

| Campo | Descripción |
|---|---|
| `ecg_raw` | lectura ADC promediada del AD8232 |
| `heart_rate_bpm` | pulso estimado; `null` sin señal válida |
| `resp_raw` | señal respiratoria derivada del ECG |
| `respiration_rate_bpm` | respiración estimada; `null` mientras calcula |
| `leads_off` | electrodos desconectados |
| `ax`, `ay`, `az` | aceleración con gravedad para postura |
| `gx`, `gy`, `gz` | velocidad angular |
| `pos_x_m`, `pos_y_m`, `pos_z_m` | posición estimada desde el origen |
| `distance_from_origin_m` | distancia radial estimada |
| `movement_detected` | movimiento detectado |
| `outside_safe_radius` | distancia mayor al radio de 2 m |
| `temperature_c` | temperatura manual simulada |
| `blood_pressure_systolic_mmhg` | presión sistólica manual simulada |
| `blood_pressure_diastolic_mmhg` | presión diastólica manual simulada |
| `radiation_dose_rate_usvh` | radiación manual en µSv/h |

Antes de cargar el firmware, aplica en Supabase las migraciones necesarias de `docs/sql`, especialmente:

- `004_vitales_esp32.sql`
- `005_posicion_mpu6050.sql`
- `006_radiacion.sql`

Si el JSON contiene una columna inexistente, Supabase rechaza la fila completa con `PGRST204`.

## Seguridad eléctrica

El AD8232 del prototipo no es equipo clínico. Cuando haya electrodos conectados a una persona, alimenta el ESP32 únicamente mediante batería o una fuente aislada adecuada. No conectes el cuerpo a un circuito unido directamente a la red eléctrica.
