# Enviar datos del ESP32 a Supabase

Esta guía es para el nodo **STELLAR Node** (ESP32). En lugar de enviar a la IP local
(`http://192.168.x.x:8000/api/telemetry`), el ESP32 envía a **Supabase** por internet.
El backend de STELLAR Health lee desde ahí y el panel muestra **LIVE ESP32**.

```
ESP32 --HTTPS POST (clave pública)--> Supabase (tabla telemetry) --> backend --> panel
```

Ventaja: el ESP32 y la computadora del panel **no** tienen que estar en la misma red Wi-Fi.

## 1. Datos de conexión

| Dato | Valor |
|---|---|
| URL | `https://ybtgkwftjkyhacunbami.supabase.co/rest/v1/telemetry` |
| Método | `POST` |
| Encabezados | `apikey: <CLAVE_PUBLICA>` y `Content-Type: application/json` |
| Clave | La **pública** (`sb_publishable_...`). Santiago la envía por privado. |
| Respuesta correcta | `201` (sin cuerpo) |

Reglas:
- Usa **solo** la clave pública. Esa clave solo permite **insertar** filas; no puede leer ni borrar.
- **No** agregues el encabezado `Prefer: return=representation` (pide leer la fila y daría error `401/403`).
- **No** subas la clave a GitHub (el repositorio es público). Ponla en el `.ino` solo en tu copia local, o en un archivo `secrets.h` que no se suba.

## 2. Formato del JSON (una fila por segundo)

Envía **una fila por segundo** con valores ya calculados. No envíes el ECG muestra por muestra
(eso serían ~250 peticiones por segundo).

```json
{
  "astronaut_id": "bresnik",
  "device_id": "stellar-node-bresnik",
  "ecg_raw": 2048,
  "heart_rate_bpm": 72.5,
  "leads_off": false,
  "resp_raw": 2100,
  "respiration_rate_bpm": 15.8,
  "ax": 0.12, "ay": -0.05, "az": 9.79,
  "gx": 1.2, "gy": -0.4, "gz": 0.1,
  "pos_x_m": 0.0, "pos_y_m": 0.0, "area_m2": 0.0,
  "steps": 134,
  "battery_pct": 86,
  "timestamp_ms": 123456
}
```

| Campo | Obligatorio | Regla |
|---|---|---|
| `astronaut_id` | sí | Solo `bresnik`, `parmitano`, `douglas` o `rubio` |
| `ecg_raw` | sí | Entero de 0 a 4095 (última lectura del ADC) |
| `device_id` | no | Texto, p. ej. `stellar-node-bresnik` |
| `heart_rate_bpm` | no | 25–240, o `null` si aún no hay pulso calculado |
| `respiration_rate_bpm` | no | 0–60, o `null` |
| `leads_off` | no | `true` si LO+ o LO- indican electrodo suelto |
| `resp_raw` | no | Entero 0–4095 |
| `ax ay az gx gy gz` | no | Números (MPU6050) |
| `pos_x_m pos_y_m area_m2` | no | Números |
| `steps` | no | Entero ≥ 0 |
| `battery_pct` | no | Entero 0–100 |
| `timestamp_ms` | no | `millis()` del ESP32 |

**No envíes campos que no estén en esta tabla** (por ejemplo `id`, `received_at` o nombres nuevos):
Supabase rechaza la fila completa. La hora (`received_at`) la pone Supabase solo.

## 3. Cambios en el `.ino`

Si ya envías con `HTTPClient` y `ArduinoJson` a la IP local, solo cambian estas partes:

```cpp
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* SUPABASE_URL = "https://ybtgkwftjkyhacunbami.supabase.co/rest/v1/telemetry";
const char* SUPABASE_KEY = "sb_publishable_PEGAR_AQUI";   // NO subir a GitHub

WiFiClientSecure secureClient;

void setup() {
  // ... WiFi.begin(...), sensores, etc.
  secureClient.setInsecure();  // prototipo: HTTPS sin verificar certificado
}

bool sendTelemetry(JsonDocument& doc) {
  if (WiFi.status() != WL_CONNECTED) return false;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(secureClient, SUPABASE_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  int code = http.POST(body);
  if (code != 201) {
    Serial.printf("Supabase respondió %d: %s\n", code, http.getString().c_str());
  }
  http.end();
  return code == 201;
}

void loop() {
  // Leer sensores continuamente aquí (ECG, respiración, MPU6050)...

  static unsigned long lastSend = 0;
  if (millis() - lastSend >= 1000) {     // una vez por segundo
    lastSend = millis();
    JsonDocument doc;                     // ArduinoJson v7 (en v6: StaticJsonDocument<512>)
    doc["astronaut_id"] = "bresnik";
    doc["device_id"] = "stellar-node-bresnik";
    doc["ecg_raw"] = ecgRaw;
    if (heartRate > 0) doc["heart_rate_bpm"] = heartRate; else doc["heart_rate_bpm"] = nullptr;
    doc["leads_off"] = leadsOff;
    // ... resto de campos
    doc["timestamp_ms"] = millis();
    sendTelemetry(doc);
  }
}
```

Notas:
- `setInsecure()` cifra la conexión pero no comprueba el certificado del servidor. Para un prototipo está bien.
- Un `POST` por HTTPS tarda unos 0,3–1 s y **bloquea** el `loop()` mientras tanto. Si eso corta la
  lectura del ECG, mueve el envío a una tarea en el otro núcleo (`xTaskCreatePinnedToCore`).

## 4. Errores frecuentes

| Código | Significado | Solución |
|---|---|---|
| `201` | Correcto | — |
| `401` | Clave incorrecta o falta `apikey` | Revisa la clave pública y el encabezado |
| `400` con `PGRST204` | Mandaste un campo que no existe | Quita ese campo del JSON |
| `400` con `23514` | Valor fuera de rango (p. ej. `astronaut_id` no válido, `ecg_raw` > 4095) | Corrige el valor |
| `400` con `23502` | Falta un campo obligatorio (`astronaut_id` o `ecg_raw`) | Agrégalo |
| negativo (`-1`, `-11`) | Sin conexión / timeout | Revisa Wi-Fi e internet |

## 5. Comprobar sin ESP32 (PowerShell)

```powershell
$pub = "sb_publishable_PEGAR_AQUI"
Invoke-RestMethod -Method Post -Uri "https://ybtgkwftjkyhacunbami.supabase.co/rest/v1/telemetry" -Headers @{apikey=$pub} -ContentType "application/json" -Body '{"astronaut_id":"bresnik","ecg_raw":2000,"heart_rate_bpm":75}'
```

Si no sale error, la fila llegó. En el panel, el astronauta pasa a **LIVE ESP32** mientras lleguen
datos y vuelve a **SIM** unos 5 segundos después de que dejen de llegar.
