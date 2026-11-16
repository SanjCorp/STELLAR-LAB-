#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>

#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

constexpr uint32_t SEND_PERIOD_MS = 500;
constexpr float SAFE_RADIUS_M = 2.0f;

struct ManualTelemetry {
  uint16_t ecgRaw = 2048;
  float heartRateBpm = 72.0f;
  bool leadsOff = false;
  uint16_t respRaw = 2048;
  float respirationRateBpm = 16.0f;
  float temperatureC = 36.7f;
  uint16_t systolicMmHg = 120;
  uint16_t diastolicMmHg = 80;
  float ax = 0;
  float ay = 0;
  float az = 9.81f;
  float gx = 0;
  float gy = 0;
  float gz = 0;
  float posX = 0;
  float posY = 0;
  float posZ = 0;
  float distanceFromOrigin = 0;
  float areaM2 = 0;
  uint32_t steps = 0;
  uint8_t batteryPct = 100;
  bool movementDetected = false;
  bool outsideSafeRadius = false;
};

ManualTelemetry telemetry;
portMUX_TYPE telemetryMux = portMUX_INITIALIZER_UNLOCKED;

WiFiClientSecure secureClient;
HTTPClient supabaseHttp;
WebServer localServer(80);

bool supabaseHttpInitialized = false;
bool immediateSendRequested = true;

bool credentialsConfigured() {
  return strcmp(WIFI_SSID, "TU_RED_WIFI") != 0 &&
         strcmp(WIFI_PASSWORD, "TU_CLAVE_WIFI") != 0 &&
         strcmp(SUPABASE_KEY, "sb_publishable_PEGAR_AQUI") != 0;
}

void calculateDerivedValues(ManualTelemetry& value) {
  value.distanceFromOrigin =
      sqrtf(value.posX * value.posX + value.posY * value.posY +
            value.posZ * value.posZ);
  value.outsideSafeRadius = value.distanceFromOrigin > SAFE_RADIUS_M;
}

void resetSupabaseConnection() {
  if (supabaseHttpInitialized) {
    supabaseHttp.end();
    supabaseHttpInitialized = false;
  }
  secureClient.stop();
}

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  resetSupabaseConnection();
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Conectando Wi-Fi");

  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 12000) {
    delay(300);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi conectado. IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println("Wi-Fi no disponible; se reintentara.");
  return false;
}

bool ensureSupabaseConnection() {
  if (supabaseHttpInitialized) return true;

  supabaseHttp.setTimeout(8000);
  supabaseHttp.setReuse(true);
  if (!supabaseHttp.begin(secureClient, SUPABASE_URL)) {
    Serial.println("No se pudo iniciar HTTPS persistente.");
    return false;
  }

  supabaseHttp.addHeader("Content-Type", "application/json");
  supabaseHttp.addHeader("apikey", SUPABASE_KEY);
  supabaseHttpInitialized = true;
  return true;
}

bool sendTelemetry(const ManualTelemetry& value) {
  if (!connectWiFi() || !ensureSupabaseConnection()) return false;

  JsonDocument doc;
  doc["astronaut_id"] = ASTRONAUT_ID;
  doc["device_id"] = DEVICE_ID;
  doc["ecg_raw"] = value.ecgRaw;
  doc["heart_rate_bpm"] = roundf(value.heartRateBpm * 10) / 10;
  doc["leads_off"] = value.leadsOff;
  doc["resp_raw"] = value.respRaw;
  doc["respiration_rate_bpm"] =
      roundf(value.respirationRateBpm * 10) / 10;
  doc["temperature_c"] = roundf(value.temperatureC * 10) / 10;
  doc["blood_pressure_systolic_mmhg"] = value.systolicMmHg;
  doc["blood_pressure_diastolic_mmhg"] = value.diastolicMmHg;
  doc["ax"] = roundf(value.ax * 1000) / 1000;
  doc["ay"] = roundf(value.ay * 1000) / 1000;
  doc["az"] = roundf(value.az * 1000) / 1000;
  doc["gx"] = roundf(value.gx * 100) / 100;
  doc["gy"] = roundf(value.gy * 100) / 100;
  doc["gz"] = roundf(value.gz * 100) / 100;
  doc["pos_x_m"] = roundf(value.posX * 1000) / 1000;
  doc["pos_y_m"] = roundf(value.posY * 1000) / 1000;
  doc["pos_z_m"] = roundf(value.posZ * 1000) / 1000;
  doc["distance_from_origin_m"] =
      roundf(value.distanceFromOrigin * 1000) / 1000;
  doc["movement_detected"] = value.movementDetected;
  doc["outside_safe_radius"] = value.outsideSafeRadius;
  doc["area_m2"] = roundf(value.areaM2 * 100) / 100;
  doc["steps"] = value.steps;
  doc["battery_pct"] = value.batteryPct;
  doc["timestamp_ms"] = millis();

  String body;
  serializeJson(doc, body);

  const int code = supabaseHttp.POST(body);
  if (code == 201) {
    Serial.printf(
        "Datos enviados | ECG=%u | FC=%.1f | RESP=%.1f | T=%.1f | "
        "PA=%u/%u | distancia=%.2f m\n",
        value.ecgRaw, value.heartRateBpm, value.respirationRateBpm,
        value.temperatureC, value.systolicMmHg, value.diastolicMmHg,
        value.distanceFromOrigin);
    return true;
  }

  if (code > 0) {
    Serial.printf("Error Supabase %d: %s\n", code,
                  supabaseHttp.getString().c_str());
  } else {
    Serial.printf("Error HTTPS %d: %s. Se reconectara.\n", code,
                  HTTPClient::errorToString(code).c_str());
    resetSupabaseConnection();
  }
  return false;
}

String inputNumber(const char* label, const char* name, const String& value,
                   const char* minValue, const char* maxValue,
                   const char* step) {
  String html;
  html.reserve(260);
  html += F("<label>");
  html += label;
  html += F("<input type='number' name='");
  html += name;
  html += F("' value='");
  html += value;
  html += F("' min='");
  html += minValue;
  html += F("' max='");
  html += maxValue;
  html += F("' step='");
  html += step;
  html += F("' required></label>");
  return html;
}

String dashboardHtml(const ManualTelemetry& value, bool saved) {
  String page;
  page.reserve(11000);
  page += F(
      "<!doctype html><html lang='es'><head><meta charset='utf-8'>"
      "<meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>STELLAR Manual Node</title><style>"
      "*{box-sizing:border-box}body{margin:0;background:#03101c;color:#edf8ff;"
      "font-family:Arial,sans-serif;padding:20px}main{max-width:980px;margin:auto;"
      "background:#081c2b;border:1px solid #1e5874;border-radius:20px;padding:24px}"
      "h1{color:#6fe4ff;margin:0}p{color:#91b7cb}.grid{display:grid;"
      "grid-template-columns:repeat(3,1fr);gap:14px}.group{grid-column:1/-1;"
      "margin-top:12px;color:#6fe4ff;font-weight:bold;border-bottom:1px solid #24506a;"
      "padding-bottom:7px}label{color:#a9c9da;font-size:13px}input[type=number]{"
      "display:block;width:100%;margin-top:6px;padding:11px;background:#04131f;"
      "border:1px solid #2c637c;border-radius:9px;color:white;font-size:16px}"
      ".checks{grid-column:1/-1;display:flex;gap:24px;flex-wrap:wrap;padding:10px 0}"
      ".checks label{font-size:15px}.checks input{margin-right:8px}button{width:100%;"
      "padding:15px;margin-top:20px;border:0;border-radius:11px;background:#25d39f;"
      "font-weight:bold;font-size:16px;color:#00231a;cursor:pointer}.saved{padding:12px;"
      "margin:16px 0;background:#113e34;color:#80ffd7;border-radius:9px}.status{"
      "margin-top:18px;padding:14px;background:#04131f;border-radius:10px;line-height:1.7}"
      ".safe{color:#80ffd7}.alert{color:#ff7373}@media(max-width:700px){"
      ".grid{grid-template-columns:1fr}}</style></head><body><main>"
      "<h1>STELLAR Manual Node</h1><p>Todos los valores se introducen manualmente. "
      "El ESP32 envia el ultimo estado a Supabase cada 500 ms.</p>");

  if (saved) {
    page += F("<div class='saved'>Valores actualizados y enviados.</div>");
  }

  page += F("<form method='post' action='/set'><div class='grid'>");
  page += F("<div class='group'>Corazon y respiracion</div>");
  page += inputNumber("ECG raw (0-4095)", "ecg_raw", String(value.ecgRaw),
                      "0", "4095", "1");
  page += inputNumber("Frecuencia cardiaca (bpm)", "heart_rate_bpm",
                      String(value.heartRateBpm, 1), "25", "240", "0.1");
  page += inputNumber("Respiracion raw (0-4095)", "resp_raw",
                      String(value.respRaw), "0", "4095", "1");
  page += inputNumber("Frecuencia respiratoria (rpm)",
                      "respiration_rate_bpm",
                      String(value.respirationRateBpm, 1), "0", "60", "0.1");

  page += F("<div class='group'>Signos vitales simulados</div>");
  page += inputNumber("Temperatura corporal (C)", "temperature_c",
                      String(value.temperatureC, 1), "30", "45", "0.1");
  page += inputNumber("Presion sistolica (mmHg)", "systolic",
                      String(value.systolicMmHg), "70", "220", "1");
  page += inputNumber("Presion diastolica (mmHg)", "diastolic",
                      String(value.diastolicMmHg), "40", "140", "1");

  page += F("<div class='group'>Aceleracion con gravedad (m/s2)</div>");
  page += inputNumber("AX", "ax", String(value.ax, 3), "-40", "40", "0.001");
  page += inputNumber("AY", "ay", String(value.ay, 3), "-40", "40", "0.001");
  page += inputNumber("AZ", "az", String(value.az, 3), "-40", "40", "0.001");

  page += F("<div class='group'>Giroscopio (grados/s)</div>");
  page += inputNumber("GX", "gx", String(value.gx, 2), "-500", "500", "0.01");
  page += inputNumber("GY", "gy", String(value.gy, 2), "-500", "500", "0.01");
  page += inputNumber("GZ", "gz", String(value.gz, 2), "-500", "500", "0.01");

  page += F("<div class='group'>Posicion manual respecto al origen (m)</div>");
  page += inputNumber("Posicion X", "pos_x_m", String(value.posX, 3), "-20",
                      "20", "0.001");
  page += inputNumber("Posicion Y", "pos_y_m", String(value.posY, 3), "-20",
                      "20", "0.001");
  page += inputNumber("Posicion Z", "pos_z_m", String(value.posZ, 3), "-20",
                      "20", "0.001");
  page += inputNumber("Area recorrida (m2)", "area_m2",
                      String(value.areaM2, 2), "0", "1000", "0.01");
  page += inputNumber("Pasos", "steps", String(value.steps), "0", "1000000",
                      "1");
  page += inputNumber("Bateria (%)", "battery_pct", String(value.batteryPct),
                      "0", "100", "1");

  page += F("<div class='checks'>");
  page += F("<label><input type='checkbox' name='leads_off'");
  if (value.leadsOff) page += F(" checked");
  page += F(">Electrodos desconectados</label>");
  page += F("<label><input type='checkbox' name='movement_detected'");
  if (value.movementDetected) page += F(" checked");
  page += F(">Movimiento detectado</label></div></div>");
  page += F("<button type='submit'>APLICAR Y ENVIAR AHORA</button></form>");

  page += F("<div class='status'>Distancia calculada: <b id='distance'>");
  page += String(value.distanceFromOrigin, 2);
  page += F("</b> m<br>Estado: <b id='zone' class='");
  page += value.outsideSafeRadius ? F("alert'>FUERA DEL RADIO DE 2 M")
                                  : F("safe'>DENTRO DEL RADIO DE 2 M");
  page += F("</b><br>IP del ESP32: ");
  page += WiFi.localIP().toString();
  page += F("</div><script>async function refresh(){try{const r=await fetch('/api/state',"
            "{cache:'no-store'});if(!r.ok)return;const d=await r.json();"
            "document.getElementById('distance').textContent=Number("
            "d.distance_from_origin_m||0).toFixed(2);const z=document.getElementById("
            "'zone');if(d.outside_safe_radius){z.textContent='FUERA DEL RADIO DE 2 M';"
            "z.className='alert';}else{z.textContent='DENTRO DEL RADIO DE 2 M';"
            "z.className='safe';}}catch(e){}}setInterval(refresh,500);</script>"
            "</main></body></html>");
  return page;
}

bool readFloatArg(const char* name, float minValue, float maxValue,
                  float& output) {
  if (!localServer.hasArg(name)) return false;
  output = localServer.arg(name).toFloat();
  return isfinite(output) && output >= minValue && output <= maxValue;
}

bool readIntArg(const char* name, int minValue, int maxValue, int& output) {
  if (!localServer.hasArg(name)) return false;
  output = localServer.arg(name).toInt();
  return output >= minValue && output <= maxValue;
}

void handleDashboard() {
  ManualTelemetry snapshot;
  portENTER_CRITICAL(&telemetryMux);
  snapshot = telemetry;
  portEXIT_CRITICAL(&telemetryMux);
  localServer.send(200, "text/html; charset=utf-8",
                   dashboardHtml(snapshot, localServer.hasArg("saved")));
}

void handleStateJson() {
  ManualTelemetry snapshot;
  portENTER_CRITICAL(&telemetryMux);
  snapshot = telemetry;
  portEXIT_CRITICAL(&telemetryMux);

  JsonDocument doc;
  doc["distance_from_origin_m"] = snapshot.distanceFromOrigin;
  doc["outside_safe_radius"] = snapshot.outsideSafeRadius;
  doc["movement_detected"] = snapshot.movementDetected;
  String body;
  serializeJson(doc, body);
  localServer.send(200, "application/json", body);
}

void handleSetValues() {
  ManualTelemetry updated;
  portENTER_CRITICAL(&telemetryMux);
  updated = telemetry;
  portEXIT_CRITICAL(&telemetryMux);

  int integer = 0;
  bool valid = true;

  valid &= readIntArg("ecg_raw", 0, 4095, integer);
  updated.ecgRaw = integer;
  valid &= readFloatArg("heart_rate_bpm", 25, 240, updated.heartRateBpm);
  valid &= readIntArg("resp_raw", 0, 4095, integer);
  updated.respRaw = integer;
  valid &= readFloatArg("respiration_rate_bpm", 0, 60,
                        updated.respirationRateBpm);
  valid &= readFloatArg("temperature_c", 30, 45, updated.temperatureC);
  valid &= readIntArg("systolic", 70, 220, integer);
  updated.systolicMmHg = integer;
  valid &= readIntArg("diastolic", 40, 140, integer);
  updated.diastolicMmHg = integer;
  valid &= updated.diastolicMmHg < updated.systolicMmHg;

  valid &= readFloatArg("ax", -40, 40, updated.ax);
  valid &= readFloatArg("ay", -40, 40, updated.ay);
  valid &= readFloatArg("az", -40, 40, updated.az);
  valid &= readFloatArg("gx", -500, 500, updated.gx);
  valid &= readFloatArg("gy", -500, 500, updated.gy);
  valid &= readFloatArg("gz", -500, 500, updated.gz);
  valid &= readFloatArg("pos_x_m", -20, 20, updated.posX);
  valid &= readFloatArg("pos_y_m", -20, 20, updated.posY);
  valid &= readFloatArg("pos_z_m", -20, 20, updated.posZ);
  valid &= readFloatArg("area_m2", 0, 1000, updated.areaM2);
  valid &= readIntArg("steps", 0, 1000000, integer);
  updated.steps = integer;
  valid &= readIntArg("battery_pct", 0, 100, integer);
  updated.batteryPct = integer;

  updated.leadsOff = localServer.hasArg("leads_off");
  updated.movementDetected = localServer.hasArg("movement_detected");
  calculateDerivedValues(updated);

  if (!valid) {
    localServer.send(400, "text/plain; charset=utf-8",
                     "Hay valores ausentes, invalidos o fuera de rango.");
    return;
  }

  portENTER_CRITICAL(&telemetryMux);
  telemetry = updated;
  immediateSendRequested = true;
  portEXIT_CRITICAL(&telemetryMux);

  localServer.sendHeader("Location", "/?saved=1", true);
  localServer.send(303, "text/plain", "");
}

void startLocalServer() {
  localServer.on("/", HTTP_GET, handleDashboard);
  localServer.on("/api/state", HTTP_GET, handleStateJson);
  localServer.on("/set", HTTP_POST, handleSetValues);
  localServer.onNotFound([]() {
    localServer.send(404, "text/plain; charset=utf-8", "Ruta no encontrada.");
  });
  localServer.begin();

  Serial.print("Formulario manual disponible en http://");
  Serial.println(WiFi.localIP());
}

void networkTask(void* parameter) {
  uint32_t lastSendMs = 0;

  for (;;) {
    bool shouldSend = false;
    ManualTelemetry snapshot;

    portENTER_CRITICAL(&telemetryMux);
    const bool forceSend = immediateSendRequested;
    if (forceSend) immediateSendRequested = false;
    if (forceSend || millis() - lastSendMs >= SEND_PERIOD_MS) {
      snapshot = telemetry;
      shouldSend = true;
    }
    portEXIT_CRITICAL(&telemetryMux);

    if (shouldSend) {
      sendTelemetry(snapshot);
      lastSendMs = millis();
    }
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\nSTELLAR Manual Telemetry Node v1.0");

  if (!credentialsConfigured()) {
    Serial.println("ERROR: completa secrets.h con Wi-Fi y Supabase.");
    while (true) delay(1000);
  }

  calculateDerivedValues(telemetry);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  secureClient.setInsecure();

  connectWiFi();
  startLocalServer();

  xTaskCreatePinnedToCore(networkTask, "supabase-500ms", 8192, nullptr, 1,
                          nullptr, 0);
}

void loop() {
  localServer.handleClient();
  delay(2);
}

