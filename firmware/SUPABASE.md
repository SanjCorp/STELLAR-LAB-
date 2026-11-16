# Telemetría ESP32 mediante Supabase

El firmware principal envía sus lecturas directamente a Supabase. El backend consulta esas filas y entrega al frontend datos reales o simulados con el mismo formato.

```text
ESP32 ──HTTPS POST──> Supabase telemetry ──> FastAPI ──> React
                                  └─ sin datos recientes: simulación
```

El ESP32 y la computadora del panel no necesitan estar en la misma red.

## Configuración

El archivo local `versionnasaofi/secrets.h` contiene:

```cpp
const char* WIFI_SSID = "TU_RED_WIFI";
const char* WIFI_PASSWORD = "TU_CLAVE_WIFI";
const char* SUPABASE_URL = "https://PROYECTO.supabase.co/rest/v1/telemetry";
const char* SUPABASE_KEY = "sb_publishable_PEGAR_AQUI";
const char* ASTRONAUT_ID = "bresnik";
const char* DEVICE_ID = "stellar-ecg-bresnik";
```

Usa en el ESP32 solamente una clave pública con permiso de inserción. La clave secreta se utiliza exclusivamente en `backend/.env` y nunca debe copiarse al firmware, frontend o repositorio.

Encabezados del ESP32:

```text
Content-Type: application/json
apikey: <CLAVE_PUBLICA>
```

Una inserción correcta responde `201`.

## Frecuencia de envío

El AD8232 se lee internamente a 250 Hz, pero el ESP32 inserta solo **una fila por segundo**. De esta forma el envío HTTPS no interrumpe el ECG ni genera cientos de solicitudes.

La radiación manual puede solicitar un envío inmediato al mover su control, pero el estado más reciente sigue formando parte de la misma telemetría.

## Ejemplo de una fila

```json
{
  "astronaut_id": "bresnik",
  "device_id": "stellar-ecg-bresnik",
  "ecg_raw": 2048,
  "heart_rate_bpm": 72.5,
  "leads_off": false,
  "resp_raw": 2100,
  "respiration_rate_bpm": 15.8,
  "temperature_c": 36.7,
  "blood_pressure_systolic_mmhg": 120,
  "blood_pressure_diastolic_mmhg": 80,
  "radiation_dose_rate_usvh": 12.0,
  "ax": 0.12,
  "ay": -0.05,
  "az": 9.79,
  "gx": 1.2,
  "gy": -0.4,
  "gz": 0.1,
  "pos_x_m": 0.0,
  "pos_y_m": 0.0,
  "pos_z_m": 0.0,
  "distance_from_origin_m": 0.0,
  "movement_detected": false,
  "outside_safe_radius": false,
  "area_m2": 0.0,
  "steps": 0,
  "battery_pct": 100,
  "timestamp_ms": 123456
}
```

Los campos estimados se envían como `null` mientras no exista una señal válida. Un electrodo desconectado no debe producir un pulso inventado.

## Migraciones SQL

Ejecuta una vez en Supabase SQL Editor las migraciones de `docs/sql` que todavía no estén aplicadas:

| Archivo | Añade |
|---|---|
| `002_checkins.sql` | chequeos de bienestar |
| `003_pos_z.sql` | posición Z para versiones anteriores |
| `004_vitales_esp32.sql` | temperatura y presión arterial |
| `005_posicion_mpu6050.sql` | posición 3D, distancia y estados de movimiento |
| `006_radiacion.sql` | tasa de dosis de radiación |

Supabase rechaza la fila completa si el ESP32 manda un nombre de columna que no existe. El error habitual es `400 PGRST204`.

## Datos reales y simulación

El backend considera hardware activo durante los **10 segundos** posteriores a la última fila válida de cada astronauta. Si no existe un nodo conectado o las filas dejan de llegar, genera automáticamente telemetría pseudoaleatoria y variable para conservar las gráficas, alertas y pantallas de prueba.

La interfaz marca la procedencia:

- `ESP32`, `HARDWARE` o `SENSOR`: fila real.
- `SIMULACIÓN`: dato generado para demostración.
- `MANUAL`: chequeo introducido desde la aplicación.

La simulación no inserta datos falsos en la tabla `telemetry`; se genera al responder la API y es sustituida en cuanto vuelve la telemetría real.

## Errores frecuentes

| Respuesta | Significado | Revisión |
|---|---|---|
| `201` | fila insertada | sin acción |
| `400 PGRST204` | columna inexistente | ejecuta la migración o corrige el nombre |
| `400 23514` | valor fuera de rango | revisa el JSON |
| `400 23502` | falta un campo obligatorio | revisa `astronaut_id` y `ecg_raw` |
| `401` o `403` | clave o política incorrecta | revisa clave pública y RLS |
| código negativo | fallo de red o timeout | revisa Wi-Fi, alimentación e internet |

## Seguridad

- No publiques `secrets.h` ni `backend/.env`.
- No incluyas credenciales en capturas, documentación o commits.
- Si una clave fue publicada, elimínala del uso y genera una nueva; borrarla del último commit no la elimina del historial.
- `secureClient.setInsecure()` se utiliza solo en el prototipo: cifra la conexión, pero no valida el certificado remoto.
