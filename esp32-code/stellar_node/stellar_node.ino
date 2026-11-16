#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <Wire.h>

#include "secrets.h"

// ESP32 DevKit V1 / WROOM-32 de 38 pines + AD8232 + MPU6050.
// v2.3: telemetria a 1 Hz con HTTPS persistente, posicion menos sensible,
// deteccion de reposo y ajuste a cero al regresar cerca del origen.
// GPIO 34 pertenece a ADC1 y puede utilizarse mientras Wi-Fi está activo.
constexpr uint8_t ECG_PIN = 34;
constexpr uint8_t LO_PLUS_PIN = 32;
constexpr uint8_t LO_MINUS_PIN = 33;

// MPU6050 / GY-521 por I2C. AD0 conectado a GND produce la direccion 0x68.
constexpr uint8_t MPU6050_ADDRESS = 0x68;
constexpr uint8_t MPU_SDA_PIN = 21;
constexpr uint8_t MPU_SCL_PIN = 22;
constexpr uint16_t MPU_SAMPLE_RATE_HZ = 50;
constexpr TickType_t MPU_SAMPLE_PERIOD =
    pdMS_TO_TICKS(1000 / MPU_SAMPLE_RATE_HZ);
constexpr uint16_t MPU_CALIBRATION_SAMPLES = 250;  // 5 segundos inmovil.
constexpr float STANDARD_GRAVITY = 9.80665f;
constexpr float ACCEL_SCALE_4G = 8192.0f;
constexpr float GYRO_SCALE_500DPS = 65.5f;
// Un pico aislado o un giro del pie no deben mover la posicion.
constexpr float MOVEMENT_ACCEL_THRESHOLD = 1.10f;  // m/s2 sin gravedad
constexpr float MOVEMENT_GYRO_THRESHOLD = 12.0f;   // grados/s; solo indica giro
constexpr float LINEAR_ACCEL_DEADZONE = 0.30f;     // ruido residual por eje
constexpr float STATIONARY_ACCEL_BAND = 0.35f;     // |magnitud - gravedad|
constexpr float STATIONARY_GYRO_THRESHOLD = 4.0f;  // grados/s
constexpr uint8_t MOVEMENT_CONFIRM_SAMPLES = 6;    // 120 ms a 50 Hz
constexpr uint32_t STATIONARY_RESET_MS = 600;
// Filtro de orientacion (Mahony): cuanto confia en el acelerometro para corregir el giroscopio.
constexpr float ORIENTATION_KP = 0.60f;
constexpr float ACCEL_TRUST_BAND = 0.45f;
constexpr float VELOCITY_DAMPING_MOVING = 0.98f;
constexpr float VELOCITY_DAMPING_IDLE = 0.78f;
constexpr float MAX_ESTIMATED_SPEED_MPS = 1.50f;
constexpr float SAFE_RADIUS_M = 2.0f;
constexpr float ORIGIN_SNAP_RADIUS_M = 0.20f;
constexpr float DISTANCE_CALIBRATION_FACTOR = 10.0f;

constexpr uint16_t SAMPLE_RATE_HZ = 250;
constexpr TickType_t SAMPLE_PERIOD = pdMS_TO_TICKS(1000 / SAMPLE_RATE_HZ);
constexpr uint32_t SEND_PERIOD_MS = 1000;
constexpr uint32_t REFRACTORY_MS = 300;
constexpr uint8_t ECG_ADC_AVERAGE_SAMPLES = 4;
constexpr uint8_t QRS_INTEGRATION_SAMPLES = 30;  // 120 ms a 250 Hz.
constexpr uint8_t HEART_INTERVAL_CAPACITY = 7;
constexpr float ECG_BASELINE_ALPHA = 0.0125f;  // Rechazo de deriva, ~0.5 Hz.
constexpr float ECG_LOWPASS_ALPHA = 0.34f;     // Atenua EMG y red, ~20 Hz.
constexpr float QRS_MIN_THRESHOLD = 0.5f;
constexpr float ECG_MIN_PEAK_AMPLITUDE = 10.0f;
constexpr uint32_t QRS_MAX_WIDTH_MS = 220;
constexpr float RESPIRATION_DC_ALPHA = 0.0008f;
constexpr float RESPIRATION_MIN_AMPLITUDE = 2.5f;
constexpr uint32_t RESPIRATION_MIN_INTERVAL_MS = 2000;  // 30 rpm.
constexpr uint32_t RESPIRATION_MAX_INTERVAL_MS = 10000; // 6 rpm.
constexpr uint8_t RESPIRATION_INTERVAL_CAPACITY = 5;
constexpr uint32_t LEADS_OFF_DEBOUNCE_MS = 200;  // electrodos "sueltos" solo si dura 0,2 s seguidos
constexpr uint32_t HEART_RATE_STALE_MS = 3000;   // sin latidos 3 s -> pulso = null
constexpr uint32_t WARMUP_MS = 2500;
constexpr uint8_t EDR_CAPACITY = 40;
constexpr uint8_t EDR_MIN_BEATS = 12;
constexpr uint32_t EDR_MIN_WINDOW_MS = 18000;

// Valores permitidos para la simulacion manual.
constexpr float MIN_TEMPERATURE_C = 30.0f;
constexpr float MAX_TEMPERATURE_C = 45.0f;
constexpr uint16_t MIN_SYSTOLIC_MMHG = 70;
constexpr uint16_t MAX_SYSTOLIC_MMHG = 220;
constexpr uint16_t MIN_DIASTOLIC_MMHG = 40;
constexpr uint16_t MAX_DIASTOLIC_MMHG = 140;
constexpr float MIN_RADIATION_USVH = 0.0f;
constexpr float RADIATION_ALERT_USVH = 17.0f;  // 0.017 mSv/h
constexpr float MAX_RADIATION_USVH = 20.0f;    // 0.020 mSv/h

struct EcgState {
  uint16_t raw = 0;
  float filtered = 0;
  float threshold = 90;
  float heartRateBpm = 0;
  uint16_t respRaw = 2048;
  float respirationRateBpm = 0;
  bool respirationValid = false;
  float temperatureC = 36.7f;
  uint16_t systolicMmHg = 120;
  uint16_t diastolicMmHg = 80;
  float radiationDoseRateUsvh = 0.0f;
  float ax = 0;
  float ay = 0;
  float az = 0;
  float gx = 0;
  float gy = 0;
  float gz = 0;
  float posX = 0;
  float posY = 0;
  float posZ = 0;
  float distanceFromOrigin = 0;
  bool movementDetected = false;
  bool outsideSafeRadius = false;
  bool mpuReady = false;
  bool leadsOff = true;
  uint32_t sampleCount = 0;
};

EcgState ecgState;
portMUX_TYPE stateMux = portMUX_INITIALIZER_UNLOCKED;
WiFiClientSecure secureClient;
HTTPClient supabaseHttp;
WebServer localServer(80);
bool supabaseHttpInitialized = false;
bool manualSendRequested = false;
bool resetPositionRequested = false;

// Orientacion del sensor (cuaternion sensor -> cabina). Z de la cabina = hacia arriba.
float q0 = 1, q1 = 0, q2 = 0, q3 = 0;
float gravityMagnitude = STANDARD_GRAVITY;  // la que mide ESTE sensor en reposo
float gyroBiasX = 0;
float gyroBiasY = 0;
float gyroBiasZ = 0;
float velocityX = 0;
float velocityY = 0;
float velocityZ = 0;
float estimatedPosX = 0;
float estimatedPosY = 0;
float estimatedPosZ = 0;
uint32_t stationarySinceMs = 0;
uint32_t leadsOffSinceMs = 0;

float baseline = 2048;
float lowPass = 0;
float previousLowPass = 0;
float qrsIntegrationBuffer[QRS_INTEGRATION_SAMPLES] = {0};
float qrsIntegrationSum = 0;
uint8_t qrsIntegrationIndex = 0;
float qrsSignalLevel = 0;
float qrsNoiseLevel = 0;
float ecgAmplitudeEnvelope = ECG_MIN_PEAK_AMPLITUDE;
bool peakActive = false;
float peakMagnitude = 0;
float peakIntegratedEnergy = 0;
uint32_t peakTimeMs = 0;
uint32_t peakStartedMs = 0;
uint32_t lastBeatMs = 0;
uint32_t leadsConnectedSinceMs = 0;
float intervalsMs[HEART_INTERVAL_CAPACITY] = {0};
uint8_t intervalCount = 0;
uint8_t intervalIndex = 0;
uint32_t edrTimesMs[EDR_CAPACITY] = {0};
float edrAmplitudes[EDR_CAPACITY] = {0};
uint8_t edrCount = 0;
uint16_t derivedRespRaw = 2048;
float derivedRespirationRate = 0;
bool derivedRespirationValid = false;
float respirationDc = 2048;
float respirationEnvelope = RESPIRATION_MIN_AMPLITUDE;
bool respirationHigh = false;
uint32_t lastRespirationPeakMs = 0;
float respirationIntervalsMs[RESPIRATION_INTERVAL_CAPACITY] = {0};
uint8_t respirationIntervalCount = 0;
uint8_t respirationIntervalIndex = 0;
uint16_t rawDerivedRespRaw = 2048;
float rawDerivedRespirationRate = 0;
bool rawDerivedRespirationValid = false;

bool credentialsConfigured() {
  return strcmp(WIFI_SSID, "TU_RED_WIFI") != 0 &&
         strcmp(WIFI_PASSWORD, "TU_CLAVE_WIFI") != 0 &&
         strcmp(SUPABASE_KEY, "sb_publishable_PEGAR_AQUI") != 0;
}

bool writeMpuRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU6050_ADDRESS);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool readMpuRegisters(uint8_t startRegister, uint8_t* buffer, size_t length) {
  Wire.beginTransmission(MPU6050_ADDRESS);
  Wire.write(startRegister);
  if (Wire.endTransmission(false) != 0) return false;

  const size_t received = Wire.requestFrom(
      static_cast<uint8_t>(MPU6050_ADDRESS), static_cast<uint8_t>(length), true);
  if (received != length) return false;
  for (size_t i = 0; i < length; ++i) buffer[i] = Wire.read();
  return true;
}

bool readMpuSample(float& ax, float& ay, float& az,
                   float& gx, float& gy, float& gz) {
  uint8_t data[14];
  if (!readMpuRegisters(0x3B, data, sizeof(data))) return false;

  auto wordAt = [&](uint8_t index) -> int16_t {
    return static_cast<int16_t>(
        (static_cast<uint16_t>(data[index]) << 8) | data[index + 1]);
  };

  const int16_t rawAx = wordAt(0);
  const int16_t rawAy = wordAt(2);
  const int16_t rawAz = wordAt(4);
  const int16_t rawGx = wordAt(8);
  const int16_t rawGy = wordAt(10);
  const int16_t rawGz = wordAt(12);

  ax = rawAx * STANDARD_GRAVITY / ACCEL_SCALE_4G;
  ay = rawAy * STANDARD_GRAVITY / ACCEL_SCALE_4G;
  az = rawAz * STANDARD_GRAVITY / ACCEL_SCALE_4G;
  gx = rawGx / GYRO_SCALE_500DPS;
  gy = rawGy / GYRO_SCALE_500DPS;
  gz = rawGz / GYRO_SCALE_500DPS;
  return true;
}

void setEstimatedPositionZero() {
  velocityX = 0;
  velocityY = 0;
  velocityZ = 0;
  estimatedPosX = 0;
  estimatedPosY = 0;
  estimatedPosZ = 0;
  stationarySinceMs = millis();

  portENTER_CRITICAL(&stateMux);
  ecgState.posX = 0;
  ecgState.posY = 0;
  ecgState.posZ = 0;
  ecgState.distanceFromOrigin = 0;
  ecgState.outsideSafeRadius = false;
  manualSendRequested = true;
  portEXIT_CRITICAL(&stateMux);
}

// ---------- Orientacion ----------
// El MPU6050 mide en SUS ejes. Si el pie gira, esos ejes giran con el. Para que X, Y, Z sean
// los de la cabina se estima la orientacion con el giroscopio, corregida lentamente con la
// gravedad que ve el acelerometro (filtro de Mahony). La guiñada (giro horizontal) no tiene
// referencia absoluta sin magnetometro: deriva poco a poco; por eso existe "posicion cero".
void normalizeQuaternion() {
  const float n = sqrtf(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
  if (n <= 0) { q0 = 1; q1 = q2 = q3 = 0; return; }
  q0 /= n; q1 /= n; q2 /= n; q3 /= n;
}

void initOrientation(float ax, float ay, float az) {
  // Inclinacion inicial a partir de la gravedad; rumbo inicial = 0 (eje X de la cabina).
  const float roll = atan2f(ay, az);
  const float pitch = atan2f(-ax, sqrtf(ay * ay + az * az));
  const float cr = cosf(roll / 2), sr = sinf(roll / 2);
  const float cp = cosf(pitch / 2), sp = sinf(pitch / 2);
  q0 = cr * cp; q1 = sr * cp; q2 = cr * sp; q3 = -sr * sp;
  normalizeQuaternion();
}

// gx, gy, gz en rad/s; ax, ay, az en m/s2. trustAccel = el sensor estaba quieto: solo entonces
// el acelerometro mide puramente la gravedad (si no, confundiria el avance con una inclinacion).
void updateOrientation(float gx, float gy, float gz, float ax, float ay, float az, float dt, bool trustAccel) {
  const float an = sqrtf(ax * ax + ay * ay + az * az);
  if (trustAccel && an > 0 && fabsf(an - gravityMagnitude) < ACCEL_TRUST_BAND) {
    ax /= an; ay /= an; az /= an;
    // Direccion de "arriba" segun la orientacion actual, vista desde el sensor.
    const float vx = 2 * (q1 * q3 - q0 * q2);
    const float vy = 2 * (q0 * q1 + q2 * q3);
    const float vz = q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3;
    gx += ORIENTATION_KP * (ay * vz - az * vy);
    gy += ORIENTATION_KP * (az * vx - ax * vz);
    gz += ORIENTATION_KP * (ax * vy - ay * vx);
  }
  const float a = q0, b = q1, c = q2;
  q0 += 0.5f * dt * (-b * gx - c * gy - q3 * gz);
  q1 += 0.5f * dt * (a * gx + c * gz - q3 * gy);
  q2 += 0.5f * dt * (a * gy - b * gz + q3 * gx);
  q3 += 0.5f * dt * (a * gz + b * gy - c * gx);
  normalizeQuaternion();
}

// Pasa un vector de los ejes del sensor a los ejes de la cabina.
void sensorToCabin(float x, float y, float z, float& wx, float& wy, float& wz) {
  wx = (1 - 2 * (q2 * q2 + q3 * q3)) * x + 2 * (q1 * q2 - q0 * q3) * y + 2 * (q1 * q3 + q0 * q2) * z;
  wy = 2 * (q1 * q2 + q0 * q3) * x + (1 - 2 * (q1 * q1 + q3 * q3)) * y + 2 * (q2 * q3 - q0 * q1) * z;
  wz = 2 * (q1 * q3 - q0 * q2) * x + 2 * (q2 * q3 + q0 * q1) * y + (1 - 2 * (q1 * q1 + q2 * q2)) * z;
}

bool initializeMpu6050() {
  Wire.begin(MPU_SDA_PIN, MPU_SCL_PIN);
  Wire.setClock(400000);
  delay(100);

  uint8_t identity = 0;
  if (!readMpuRegisters(0x75, &identity, 1) || identity != 0x68) {
    Serial.printf("MPU6050 no encontrado en 0x%02X (WHO_AM_I=0x%02X).\n",
                  MPU6050_ADDRESS, identity);
    return false;
  }

  // Despierta el sensor, configura filtro, 50 Hz, acelerometro +/-4 g y giro +/-500 dps.
  if (!writeMpuRegister(0x6B, 0x00) ||
      !writeMpuRegister(0x1A, 0x03) ||
      !writeMpuRegister(0x19, 1000 / MPU_SAMPLE_RATE_HZ - 1) ||
      !writeMpuRegister(0x1B, 0x08) ||
      !writeMpuRegister(0x1C, 0x08)) {
    Serial.println("No se pudo configurar el MPU6050.");
    return false;
  }
  delay(100);

  Serial.println("MPU6050 detectado. NO MUEVAS el sensor durante 5 segundos...");
  double sumAx = 0;
  double sumAy = 0;
  double sumAz = 0;
  double sumGx = 0;
  double sumGy = 0;
  double sumGz = 0;

  for (uint16_t i = 0; i < MPU_CALIBRATION_SAMPLES; ++i) {
    float ax, ay, az, gx, gy, gz;
    if (!readMpuSample(ax, ay, az, gx, gy, gz)) {
      Serial.println("Fallo de lectura durante la calibracion del MPU6050.");
      return false;
    }
    sumAx += ax;
    sumAy += ay;
    sumAz += az;
    sumGx += gx;
    sumGy += gy;
    sumGz += gz;
    if (i % 50 == 49) Serial.print('.');
    delay(1000 / MPU_SAMPLE_RATE_HZ);
  }
  Serial.println();

  const float meanAx = sumAx / MPU_CALIBRATION_SAMPLES;
  const float meanAy = sumAy / MPU_CALIBRATION_SAMPLES;
  const float meanAz = sumAz / MPU_CALIBRATION_SAMPLES;
  gyroBiasX = sumGx / MPU_CALIBRATION_SAMPLES;
  gyroBiasY = sumGy / MPU_CALIBRATION_SAMPLES;
  gyroBiasZ = sumGz / MPU_CALIBRATION_SAMPLES;
  // Algunos MPU6050 miden ~10,8 en vez de 9,8 en reposo: se usa lo que mide este sensor.
  gravityMagnitude = sqrtf(meanAx * meanAx + meanAy * meanAy + meanAz * meanAz);
  initOrientation(meanAx, meanAy, meanAz);
  setEstimatedPositionZero();

  portENTER_CRITICAL(&stateMux);
  ecgState.mpuReady = true;
  portEXIT_CRITICAL(&stateMux);
  Serial.println("Calibracion terminada. Posicion inicial guardada como X=0, Y=0, Z=0.");
  return true;
}

void motionTask(void* parameter) {
  TickType_t lastWake = xTaskGetTickCount();
  uint32_t previousUs = micros();
  bool previousOutside = false;
  uint8_t translationSamples = 0;

  for (;;) {
    bool resetNow = false;
    portENTER_CRITICAL(&stateMux);
    if (resetPositionRequested) {
      resetPositionRequested = false;
      resetNow = true;
    }
    portEXIT_CRITICAL(&stateMux);
    if (resetNow) {
      setEstimatedPositionZero();
      Serial.println("Posicion MPU restablecida a X=0, Y=0, Z=0.");
    }

    float measuredAx, measuredAy, measuredAz;
    float measuredGx, measuredGy, measuredGz;
    if (!readMpuSample(measuredAx, measuredAy, measuredAz,
                       measuredGx, measuredGy, measuredGz)) {
      portENTER_CRITICAL(&stateMux);
      ecgState.mpuReady = false;
      portEXIT_CRITICAL(&stateMux);
      vTaskDelayUntil(&lastWake, MPU_SAMPLE_PERIOD);
      continue;
    }

    const uint32_t nowUs = micros();
    float dt = (nowUs - previousUs) / 1000000.0f;
    previousUs = nowUs;
    dt = constrain(dt, 0.001f, 0.03f);

    float correctedGx = measuredGx - gyroBiasX;
    float correctedGy = measuredGy - gyroBiasY;
    float correctedGz = measuredGz - gyroBiasZ;
    const float measuredAccelMagnitude =
        sqrtf(measuredAx * measuredAx + measuredAy * measuredAy +
              measuredAz * measuredAz);
    const float gyroMagnitude =
        sqrtf(correctedGx * correctedGx + correctedGy * correctedGy +
              correctedGz * correctedGz);
    const bool stationaryCandidate =
        fabsf(measuredAccelMagnitude - gravityMagnitude) <= STATIONARY_ACCEL_BAND &&
        gyroMagnitude <= STATIONARY_GYRO_THRESHOLD;

    constexpr float DEG_TO_RAD_F = 0.01745329f;
    updateOrientation(correctedGx * DEG_TO_RAD_F, correctedGy * DEG_TO_RAD_F,
                      correctedGz * DEG_TO_RAD_F, measuredAx, measuredAy,
                      measuredAz, dt, stationaryCandidate);

    // Aceleracion en ejes de la CABINA y sin la gravedad (antes: ejes del sensor y un filtro
    // lento que confundia una inclinacion con un desplazamiento).
    float worldAx, worldAy, worldAz;
    sensorToCabin(measuredAx, measuredAy, measuredAz, worldAx, worldAy, worldAz);
    worldAz -= gravityMagnitude;

    // Si la magnitud sigue siendo la gravedad y el giroscopio esta quieto, el
    // sensor NO se esta trasladando. Se anula inmediatamente el residuo de
    // inclinacion para que un MPU inmovil nunca acumule metros falsos.
    if (stationaryCandidate) {
      worldAx = 0;
      worldAy = 0;
      worldAz = 0;
      translationSamples = 0;
    }

    // Zona muerta: evita integrar como distancia el ruido pequeno del MPU6050.
    if (fabsf(worldAx) < LINEAR_ACCEL_DEADZONE) worldAx = 0;
    if (fabsf(worldAy) < LINEAR_ACCEL_DEADZONE) worldAy = 0;
    if (fabsf(worldAz) < LINEAR_ACCEL_DEADZONE) worldAz = 0;

    const float accelerationMagnitude =
        sqrtf(worldAx * worldAx + worldAy * worldAy + worldAz * worldAz);
    const bool translationCandidate =
        !stationaryCandidate &&
        accelerationMagnitude > MOVEMENT_ACCEL_THRESHOLD;
    if (translationCandidate) {
      if (translationSamples < MOVEMENT_CONFIRM_SAMPLES) ++translationSamples;
    } else {
      translationSamples = 0;
    }
    const bool translating = translationSamples >= MOVEMENT_CONFIRM_SAMPLES;
    // El giroscopio puede marcar actividad, pero nunca suma posicion por si solo.
    const bool moving = translating || gyroMagnitude > MOVEMENT_GYRO_THRESHOLD;

    if (stationaryCandidate) {
      if (stationarySinceMs == 0) stationarySinceMs = millis();
    } else {
      stationarySinceMs = 0;
    }
    const bool stationaryConfirmed =
        stationarySinceMs != 0 &&
        millis() - stationarySinceMs >= STATIONARY_RESET_MS;

    if (translating) {
      velocityX += worldAx * dt;
      velocityY += worldAy * dt;
      velocityZ += worldAz * dt;
      velocityX *= VELOCITY_DAMPING_MOVING;
      velocityY *= VELOCITY_DAMPING_MOVING;
      velocityZ *= VELOCITY_DAMPING_MOVING;
    } else {
      // Al dejar de trasladarse se frena rapido; girar el pie no mantiene velocidad.
      velocityX *= VELOCITY_DAMPING_IDLE;
      velocityY *= VELOCITY_DAMPING_IDLE;
      velocityZ *= VELOCITY_DAMPING_IDLE;
    }

    if (stationaryConfirmed) {
      velocityX = 0;
      velocityY = 0;
      velocityZ = 0;
      translationSamples = 0;
      // Solo estando realmente quieto se reajusta el sesgo del giroscopio.
      gyroBiasX += 0.005f * (measuredGx - gyroBiasX);
      gyroBiasY += 0.005f * (measuredGy - gyroBiasY);
      gyroBiasZ += 0.005f * (measuredGz - gyroBiasZ);
    }

    float speed = sqrtf(velocityX * velocityX + velocityY * velocityY +
                        velocityZ * velocityZ);
    if (speed > MAX_ESTIMATED_SPEED_MPS) {
      const float scale = MAX_ESTIMATED_SPEED_MPS / speed;
      velocityX *= scale;
      velocityY *= scale;
      velocityZ *= scale;
      speed = MAX_ESTIMATED_SPEED_MPS;
    }
    if (!translating && speed < 0.02f) {
      velocityX = 0;
      velocityY = 0;
      velocityZ = 0;
      speed = 0;
    }

    // Solo se integra mientras existe velocidad util; el ruido en reposo no avanza.
    if (speed > 0) {
      estimatedPosX += velocityX * dt;
      estimatedPosY += velocityY * dt;
      estimatedPosZ += velocityZ * dt;
    }

    float distance = sqrtf(estimatedPosX * estimatedPosX +
                           estimatedPosY * estimatedPosY +
                           estimatedPosZ * estimatedPosZ) *
                     DISTANCE_CALIBRATION_FACTOR;

    // Si la integracion regreso suficientemente cerca del origen y el sensor
    // esta quieto, elimina el residuo numerico para que el servidor muestre 0.
    // No puede corregir una deriva grande: para eso se necesita UWB o reset manual.
    if (stationaryConfirmed && distance <= ORIGIN_SNAP_RADIUS_M) {
      estimatedPosX = 0;
      estimatedPosY = 0;
      estimatedPosZ = 0;
      distance = 0;
    }
    const bool outside = distance > SAFE_RADIUS_M;

    portENTER_CRITICAL(&stateMux);
    // Se envía la aceleración completa del sensor, incluida la gravedad, para que
    // Entrenamiento pueda calcular inclinación/ángulos reales.
    // La posición usa la aceleración en ejes de la cabina y sin gravedad.
    ecgState.ax = measuredAx;
    ecgState.ay = measuredAy;
    ecgState.az = measuredAz;
    ecgState.gx = correctedGx;
    ecgState.gy = correctedGy;
    ecgState.gz = correctedGz;
    ecgState.posX = estimatedPosX;
    ecgState.posY = estimatedPosY;
    ecgState.posZ = estimatedPosZ;
    ecgState.distanceFromOrigin = distance;
    ecgState.movementDetected = moving;
    ecgState.outsideSafeRadius = outside;
    ecgState.mpuReady = true;
    portEXIT_CRITICAL(&stateMux);

    if (outside != previousOutside) {
      Serial.printf("Zona MPU | distancia estimada=%.2f m | estado=%s\n",
                    distance, outside ? "FUERA DE 2 M" : "DENTRO DE 2 M");
      previousOutside = outside;
    }
    vTaskDelayUntil(&lastWake, MPU_SAMPLE_PERIOD);
  }
}

void resetBeatDetector(uint16_t raw) {
  baseline = raw;
  lowPass = 0;
  previousLowPass = 0;
  qrsIntegrationSum = 0;
  qrsIntegrationIndex = 0;
  qrsSignalLevel = 0;
  qrsNoiseLevel = 0;
  ecgAmplitudeEnvelope = ECG_MIN_PEAK_AMPLITUDE;
  for (uint8_t i = 0; i < QRS_INTEGRATION_SAMPLES; ++i) {
    qrsIntegrationBuffer[i] = 0;
  }
  peakActive = false;
  peakMagnitude = 0;
  peakIntegratedEnergy = 0;
  peakTimeMs = 0;
  peakStartedMs = 0;
  lastBeatMs = 0;
  intervalCount = 0;
  intervalIndex = 0;
  for (uint8_t i = 0; i < HEART_INTERVAL_CAPACITY; ++i) {
    intervalsMs[i] = 0;
  }
  edrCount = 0;
  derivedRespRaw = 2048;
  derivedRespirationRate = 0;
  derivedRespirationValid = false;
  respirationDc = raw;
  respirationEnvelope = RESPIRATION_MIN_AMPLITUDE;
  respirationHigh = false;
  lastRespirationPeakMs = 0;
  respirationIntervalCount = 0;
  respirationIntervalIndex = 0;
  for (uint8_t i = 0; i < RESPIRATION_INTERVAL_CAPACITY; ++i) {
    respirationIntervalsMs[i] = 0;
  }
  rawDerivedRespRaw = 2048;
  rawDerivedRespirationRate = 0;
  rawDerivedRespirationValid = false;
}

float medianIntervalMs() {
  if (intervalCount == 0) return 0;

  float sorted[HEART_INTERVAL_CAPACITY];
  for (uint8_t i = 0; i < intervalCount; ++i) sorted[i] = intervalsMs[i];
  for (uint8_t i = 1; i < intervalCount; ++i) {
    const float value = sorted[i];
    int8_t j = i - 1;
    while (j >= 0 && sorted[j] > value) {
      sorted[j + 1] = sorted[j];
      --j;
    }
    sorted[j + 1] = value;
  }

  const uint8_t middle = intervalCount / 2;
  return intervalCount % 2 == 0
             ? (sorted[middle - 1] + sorted[middle]) * 0.5f
             : sorted[middle];
}

float averageHeartRate() {
  if (intervalCount == 0) return 0;
  const float medianMs = medianIntervalMs();
  return medianMs > 0 ? 60000.0f / medianMs : 0;
}

float medianRespirationIntervalMs() {
  if (respirationIntervalCount == 0) return 0;
  float sorted[RESPIRATION_INTERVAL_CAPACITY];
  for (uint8_t i = 0; i < respirationIntervalCount; ++i) {
    sorted[i] = respirationIntervalsMs[i];
  }
  for (uint8_t i = 1; i < respirationIntervalCount; ++i) {
    const float value = sorted[i];
    int8_t j = i - 1;
    while (j >= 0 && sorted[j] > value) {
      sorted[j + 1] = sorted[j];
      --j;
    }
    sorted[j + 1] = value;
  }
  const uint8_t middle = respirationIntervalCount / 2;
  return respirationIntervalCount % 2 == 0
             ? (sorted[middle - 1] + sorted[middle]) * 0.5f
             : sorted[middle];
}

void updateRawRespiration(float slowEcg, uint32_t nowMs, bool warmedUp) {
  respirationDc += RESPIRATION_DC_ALPHA * (slowEcg - respirationDc);
  const float respirationWave = slowEcg - respirationDc;
  respirationEnvelope =
      max(fabsf(respirationWave), respirationEnvelope * 0.9995f);
  const float threshold =
      max(RESPIRATION_MIN_AMPLITUDE, respirationEnvelope * 0.25f);

  const float normalized = constrain(
      respirationWave / max(respirationEnvelope, RESPIRATION_MIN_AMPLITUDE),
      -1.0f, 1.0f);
  rawDerivedRespRaw = constrain(
      (int)lroundf(2048.0f + normalized * 1500.0f), 0, 4095);

  if (warmedUp && !respirationHigh && respirationWave > threshold) {
    respirationHigh = true;
    if (lastRespirationPeakMs == 0) {
      lastRespirationPeakMs = nowMs;
    } else {
      const uint32_t interval = nowMs - lastRespirationPeakMs;
      if (interval >= RESPIRATION_MIN_INTERVAL_MS &&
          interval <= RESPIRATION_MAX_INTERVAL_MS) {
        respirationIntervalsMs[respirationIntervalIndex] = interval;
        respirationIntervalIndex =
            (respirationIntervalIndex + 1) % RESPIRATION_INTERVAL_CAPACITY;
        if (respirationIntervalCount < RESPIRATION_INTERVAL_CAPACITY) {
          ++respirationIntervalCount;
        }
        lastRespirationPeakMs = nowMs;
        const float medianMs = medianRespirationIntervalMs();
        rawDerivedRespirationRate =
            medianMs > 0 ? 60000.0f / medianMs : 0;
        rawDerivedRespirationValid =
            rawDerivedRespirationRate >= 6 && rawDerivedRespirationRate <= 30;
      } else if (interval > RESPIRATION_MAX_INTERVAL_MS) {
        lastRespirationPeakMs = nowMs;
        respirationIntervalCount = 0;
        respirationIntervalIndex = 0;
        rawDerivedRespirationRate = 0;
        rawDerivedRespirationValid = false;
      }
    }
  } else if (respirationHigh && respirationWave < -threshold * 0.35f) {
    respirationHigh = false;
  }

  if (lastRespirationPeakMs != 0 &&
      nowMs - lastRespirationPeakMs > RESPIRATION_MAX_INTERVAL_MS + 3000) {
    rawDerivedRespirationRate = 0;
    rawDerivedRespirationValid = false;
  }
}

void updateDerivedRespiration(uint32_t beatMs, float amplitude) {
  if (edrCount < EDR_CAPACITY) {
    edrTimesMs[edrCount] = beatMs;
    edrAmplitudes[edrCount] = amplitude;
    ++edrCount;
  } else {
    for (uint8_t i = 1; i < EDR_CAPACITY; ++i) {
      edrTimesMs[i - 1] = edrTimesMs[i];
      edrAmplitudes[i - 1] = edrAmplitudes[i];
    }
    edrTimesMs[EDR_CAPACITY - 1] = beatMs;
    edrAmplitudes[EDR_CAPACITY - 1] = amplitude;
  }

  float mean = 0;
  for (uint8_t i = 0; i < edrCount; ++i) mean += edrAmplitudes[i];
  mean /= edrCount;

  float variance = 0;
  for (uint8_t i = 0; i < edrCount; ++i) {
    const float centered = edrAmplitudes[i] - mean;
    variance += centered * centered;
  }

  const float standardDeviation = sqrtf(variance / max(1, (int)edrCount));
  const float normalizedLatest = standardDeviation > 1 ?
      (edrAmplitudes[edrCount - 1] - mean) / standardDeviation : 0;
  derivedRespRaw = constrain(
      (int)lroundf(2048 + constrain(normalizedLatest, -3.0f, 3.0f) * 450),
      0, 4095);

  const uint32_t windowMs = edrTimesMs[edrCount - 1] - edrTimesMs[0];
  if (edrCount < EDR_MIN_BEATS || windowMs < EDR_MIN_WINDOW_MS || variance < 1) {
    derivedRespirationValid = false;
    derivedRespirationRate = 0;
    return;
  }

  // Periodograma sobre muestras irregulares: busca entre 6 y 30 respiraciones/min.
  float bestRate = 0;
  float bestQuality = 0;
  const float originMs = edrTimesMs[0];
  for (float candidate = 6.0f; candidate <= 30.0f; candidate += 0.5f) {
    const float frequencyHz = candidate / 60.0f;
    float cosineProjection = 0;
    float sineProjection = 0;
    for (uint8_t i = 0; i < edrCount; ++i) {
      const float seconds = (edrTimesMs[i] - originMs) / 1000.0f;
      const float phase = TWO_PI * frequencyHz * seconds;
      const float centered = edrAmplitudes[i] - mean;
      cosineProjection += centered * cosf(phase);
      sineProjection += centered * sinf(phase);
    }
    const float quality =
        (cosineProjection * cosineProjection + sineProjection * sineProjection) /
        (variance * edrCount);
    if (quality > bestQuality) {
      bestQuality = quality;
      bestRate = candidate;
    }
  }

  derivedRespirationValid = bestQuality >= 0.18f;
  derivedRespirationRate = derivedRespirationValid ? bestRate : 0;
}

void registerHeartbeat(uint32_t beatMs, float amplitude) {
  if (lastBeatMs != 0) {
    const uint32_t interval = beatMs - lastBeatMs;
    if (interval < 300) return;
    if (interval > 1715) {
      // Hubo una pausa o se perdieron latidos: resincroniza sin fabricar un BPM.
      lastBeatMs = beatMs;
      intervalCount = 0;
      intervalIndex = 0;
      return;
    }

    if (intervalCount >= 3) {
      const float reference = medianIntervalMs();
      if (interval < reference * 0.55f) {
        // Pico demasiado temprano: normalmente movimiento, ruido u onda T.
        return;
      }
      if (interval > reference * 1.80f) {
        // Intervalo aislado demasiado largo: resincroniza sin alterar la mediana.
        lastBeatMs = beatMs;
        return;
      }
    }

    intervalsMs[intervalIndex] = interval;
    intervalIndex = (intervalIndex + 1) % HEART_INTERVAL_CAPACITY;
    if (intervalCount < HEART_INTERVAL_CAPACITY) ++intervalCount;
  }
  lastBeatMs = beatMs;
  updateDerivedRespiration(beatMs, amplitude);
}

void processEcgSample(uint16_t raw, bool leadsOffRaw, uint32_t nowMs) {
  // Antirrebote: un falso contacto de unas muestras ya no reinicia todo el calculo del pulso.
  if (leadsOffRaw) {
    if (leadsOffSinceMs == 0) leadsOffSinceMs = nowMs;
  } else {
    leadsOffSinceMs = 0;
  }
  const bool leadsOff = leadsOffRaw && nowMs - leadsOffSinceMs >= LEADS_OFF_DEBOUNCE_MS;
  if (leadsOffRaw && !leadsOff) {
    // Posible falso contacto: se ignora esta muestra sin reiniciar el detector.
    portENTER_CRITICAL(&stateMux);
    ecgState.raw = raw;
    ++ecgState.sampleCount;
    portEXIT_CRITICAL(&stateMux);
    return;
  }
  if (leadsOff) {
    leadsConnectedSinceMs = 0;
    resetBeatDetector(raw);
    portENTER_CRITICAL(&stateMux);
    ecgState.raw = raw;
    ecgState.filtered = 0;
    ecgState.threshold = 90;
    ecgState.heartRateBpm = 0;
    ecgState.respRaw = 2048;
    ecgState.respirationRateBpm = 0;
    ecgState.respirationValid = false;
    ecgState.leadsOff = true;
    ++ecgState.sampleCount;
    portEXIT_CRITICAL(&stateMux);
    return;
  }

  if (leadsConnectedSinceMs == 0) {
    leadsConnectedSinceMs = nowMs;
    resetBeatDetector(raw);
  }

  const bool warmedUp = nowMs - leadsConnectedSinceMs > WARMUP_MS;

  // Banda util aproximada de ECG: elimina deriva lenta y atenúa ruido muscular/red.
  baseline += ECG_BASELINE_ALPHA * (raw - baseline);
  updateRawRespiration(baseline, nowMs, warmedUp);
  const float highPass = raw - baseline;
  lowPass += ECG_LOWPASS_ALPHA * (highPass - lowPass);

  // Detector QRS ligero tipo Pan-Tompkins: derivada, cuadrado e integracion de 120 ms.
  const float derivative = lowPass - previousLowPass;
  previousLowPass = lowPass;
  const float energy = derivative * derivative;
  qrsIntegrationSum += energy - qrsIntegrationBuffer[qrsIntegrationIndex];
  qrsIntegrationBuffer[qrsIntegrationIndex] = energy;
  qrsIntegrationIndex = (qrsIntegrationIndex + 1) % QRS_INTEGRATION_SAMPLES;
  const float integrated = qrsIntegrationSum / QRS_INTEGRATION_SAMPLES;
  const float magnitude = fabsf(lowPass);
  ecgAmplitudeEnvelope =
      max(magnitude, ecgAmplitudeEnvelope * 0.998f);

  if (!warmedUp) {
    // Aprende el piso de ruido y la energia de los complejos QRS antes de dar BPM.
    qrsNoiseLevel += 0.01f * (integrated - qrsNoiseLevel);
    qrsSignalLevel = max(integrated, qrsSignalLevel * 0.999f);
  }

  const float signalRange = max(0.0f, qrsSignalLevel - qrsNoiseLevel);
  const float threshold =
      max(QRS_MIN_THRESHOLD, qrsNoiseLevel + 0.30f * signalRange);
  const float amplitudeThreshold =
      max(ECG_MIN_PEAK_AMPLITUDE, ecgAmplitudeEnvelope * 0.35f);
  const bool qrsCandidate =
      integrated > threshold || magnitude > amplitudeThreshold;
  const bool outsideRefractory =
      lastBeatMs == 0 || nowMs - lastBeatMs >= REFRACTORY_MS;

  if (warmedUp && !peakActive && outsideRefractory && qrsCandidate) {
    peakActive = true;
    peakMagnitude = magnitude;
    peakIntegratedEnergy = integrated;
    peakTimeMs = nowMs;
    peakStartedMs = nowMs;
  } else if (peakActive) {
    if (integrated > peakIntegratedEnergy) peakIntegratedEnergy = integrated;
    if (magnitude > peakMagnitude) {
      peakMagnitude = magnitude;
      peakTimeMs = nowMs;
    }
    if ((integrated < threshold * 0.55f &&
         magnitude < amplitudeThreshold * 0.55f) ||
        nowMs - peakStartedMs > QRS_MAX_WIDTH_MS) {
      qrsSignalLevel = qrsSignalLevel == 0
                           ? peakIntegratedEnergy
                           : 0.875f * qrsSignalLevel +
                                 0.125f * peakIntegratedEnergy;
      registerHeartbeat(peakTimeMs, peakMagnitude);
      peakActive = false;
      peakIntegratedEnergy = 0;
    }
  } else if (warmedUp) {
    // Adaptacion lenta al ruido para no perseguir cada interferencia transitoria.
    qrsNoiseLevel += 0.002f * (integrated - qrsNoiseLevel);
  }

  // Si deja de detectar latidos, el pulso pasa a null en vez de quedarse congelado.
  const bool beatsStale = lastBeatMs == 0 || nowMs - lastBeatMs > HEART_RATE_STALE_MS;
  const float bpm = beatsStale ? 0 : averageHeartRate();
  const bool respirationValid =
      rawDerivedRespirationValid || derivedRespirationValid;
  const float respirationRate = rawDerivedRespirationValid
                                    ? rawDerivedRespirationRate
                                    : derivedRespirationRate;
  portENTER_CRITICAL(&stateMux);
  ecgState.raw = raw;
  ecgState.filtered = lowPass;
  ecgState.threshold = sqrtf(threshold);
  ecgState.heartRateBpm = bpm;
  ecgState.respRaw = rawDerivedRespRaw;
  ecgState.respirationRateBpm = respirationRate;
  ecgState.respirationValid = respirationValid;
  ecgState.leadsOff = false;
  ++ecgState.sampleCount;
  portEXIT_CRITICAL(&stateMux);
}

void ecgTask(void* parameter) {
  TickType_t lastWake = xTaskGetTickCount();
  for (;;) {
    uint32_t adcSum = 0;
    for (uint8_t i = 0; i < ECG_ADC_AVERAGE_SAMPLES; ++i) {
      adcSum += analogRead(ECG_PIN);
    }
    const uint16_t raw =
        (adcSum + ECG_ADC_AVERAGE_SAMPLES / 2) / ECG_ADC_AVERAGE_SAMPLES;
    const bool leadsOff = digitalRead(LO_PLUS_PIN) == HIGH ||
                          digitalRead(LO_MINUS_PIN) == HIGH;
    processEcgSample(raw, leadsOff, millis());
    vTaskDelayUntil(&lastWake, SAMPLE_PERIOD);
  }
}

void resetSupabaseConnection() {
  if (supabaseHttpInitialized) {
    supabaseHttp.end();
    supabaseHttpInitialized = false;
  }
  secureClient.stop();
}

bool ensureSupabaseConnection() {
  if (supabaseHttpInitialized) return true;

  supabaseHttp.setTimeout(8000);
  supabaseHttp.setReuse(true);
  if (!supabaseHttp.begin(secureClient, SUPABASE_URL)) {
    Serial.println("No se pudo iniciar la conexion HTTPS persistente.");
    return false;
  }
  supabaseHttp.addHeader("Content-Type", "application/json");
  supabaseHttp.addHeader("apikey", SUPABASE_KEY);
  supabaseHttp.addHeader("Connection", "keep-alive");
  supabaseHttpInitialized = true;
  return true;
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
  Serial.println("Wi-Fi no disponible; se reintentará.");
  return false;
}

String dashboardHtml(const EcgState& snapshot, bool saved) {
  String page;
  page.reserve(8500);
  page += F("<!doctype html><html lang='es'><head><meta charset='utf-8'>");
  page += F("<meta name='viewport' content='width=device-width,initial-scale=1'>");
  page += F("<title>STELLAR Vitals</title><style>");
  page += F("*{box-sizing:border-box}body{margin:0;background:#04111d;color:#eef7ff;font-family:Arial,sans-serif;min-height:100vh;display:grid;place-items:center;padding:20px}");
  page += F("main{width:min(520px,100%);background:#091c2b;border:1px solid #1a506d;border-radius:20px;padding:24px;box-shadow:0 20px 60px #0008}");
  page += F("h1{margin:0 0 6px;color:#71ddff;font-size:25px}.sub{color:#8cb1c7;margin:0 0 22px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}");
  page += F("label{display:block;color:#a9c9da;font-size:13px}.wide{grid-column:1/-1}input{width:100%;margin-top:7px;padding:12px;border:1px solid #2c617a;border-radius:10px;background:#061521;color:white;font-size:17px}");
  page += F(".radiation-control{margin-top:8px;padding:15px;background:#061521;border:1px solid #2c617a;border-radius:12px}.radiation-reading{color:#71ddff;font-size:22px;font-weight:800}.radiation-control input[type=range]{padding:0;accent-color:#71ddff;cursor:pointer}.radiation-status{display:block;margin-top:9px;font-weight:800}.critical{color:#ff3b5c}");
  page += F("button{width:100%;margin-top:20px;padding:14px;border:0;border-radius:11px;background:#20c997;color:#001a16;font-weight:800;font-size:15px;cursor:pointer}");
  page += F(".secondary{background:#1d4960;color:#eaffff}.saved{background:#123d36;color:#7fffd4;padding:10px;border-radius:9px;margin-bottom:16px}.motion{margin-top:20px;padding:16px;background:#061521;border-radius:12px;line-height:1.8}.alert{color:#ff7373}.safe{color:#7fffd4}.status{margin-top:18px;padding-top:16px;border-top:1px solid #1a4055;color:#8cb1c7;font-size:13px}.value{color:#fff}");
  page += F("</style></head><body><main><h1>STELLAR Vitals</h1><p class='sub'>Simulador manual del ESP32</p>");
  if (saved) {
    page += F("<div class='saved'>Datos actualizados y preparados para el servidor principal.</div>");
  }
  page += F("<form method='post' action='/set'><div class='grid'>");
  page += F("<label class='wide'>Temperatura corporal (C)<input name='temperature' type='number' min='30' max='45' step='0.1' required value='");
  page += String(snapshot.temperatureC, 1);
  page += F("'></label><label>Presion sistolica (mmHg)<input name='systolic' type='number' min='70' max='220' step='1' required value='");
  page += String(snapshot.systolicMmHg);
  page += F("'></label><label>Presion diastolica (mmHg)<input name='diastolic' type='number' min='40' max='140' step='1' required value='");
  page += String(snapshot.diastolicMmHg);
  page += F("'></label><label class='wide radiation-control'>Radiacion simulada: <span id='radiationValue' class='radiation-reading'>");
  page += String(snapshot.radiationDoseRateUsvh / 1000.0f, 3);
  page += F("</span> mSv/h<input id='radiation' name='radiation' type='range' min='0' max='0.020' step='0.001' required value='");
  page += String(snapshot.radiationDoseRateUsvh / 1000.0f, 3);
  page += F("' oninput='updateRadiation(this)'><span id='radiationStatus' class='radiation-status ");
  if (snapshot.radiationDoseRateUsvh >= MAX_RADIATION_USVH) {
    page += F("critical'>CRITICO (SIMULACION)");
  } else if (snapshot.radiationDoseRateUsvh > RADIATION_ALERT_USVH) {
    page += F("alert'>ALERTA");
  } else {
    page += F("safe'>ACEPTABLE");
  }
  page += F("</span></label></div><button type='submit'>APLICAR Y ENVIAR DATOS</button></form>");
  page += F("<div class='motion'><strong>Movimiento estimado</strong><br>X: <span id='posX' class='value'>");
  page += String(snapshot.posX, 2);
  page += F(" m</span> &nbsp; Y: <span id='posY' class='value'>");
  page += String(snapshot.posY, 2);
  page += F(" m</span> &nbsp; Z: <span id='posZ' class='value'>");
  page += String(snapshot.posZ, 2);
  page += F(" m</span><br>Distancia desde cero: <span id='distance' class='value'>");
  page += String(snapshot.distanceFromOrigin, 2);
  page += F(" m</span><br>Estado: <strong id='motionState' class='");
  page += snapshot.outsideSafeRadius ? F("alert'>FUERA DEL RADIO DE 2 M")
                                     : F("safe'>DENTRO DEL RADIO DE 2 M");
  page += F("</strong><form method='post' action='/reset-position'><button class='secondary' type='submit'>RESTABLECER POSICION CERO</button></form></div>");
  page += F("<div class='status'>ESP32: <span class='value'>");
  page += WiFi.localIP().toString();
  page += F("</span><br>API local: <span class='value'>/api/vitals</span></div>");
  page += F("<script>let radiationBusy=false,radiationQueued=null;function paintRadiation(v){const n=Number(v);document.getElementById('radiationValue').textContent=n.toFixed(3);const s=document.getElementById('radiationStatus');if(n>=0.020){s.textContent='CRITICO (SIMULACION)';s.className='radiation-status critical';}else if(n>0.017){s.textContent='ALERTA';s.className='radiation-status alert';}else{s.textContent='ACEPTABLE';s.className='radiation-status safe';}}async function updateRadiation(input){paintRadiation(input.value);radiationQueued=input.value;if(radiationBusy)return;radiationBusy=true;while(radiationQueued!==null){const value=radiationQueued;radiationQueued=null;try{await fetch('/set-radiation',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'radiation='+encodeURIComponent(value)});}catch(e){}await new Promise(r=>setTimeout(r,300));}radiationBusy=false;}async function refreshMotion(){try{const r=await fetch('/api/motion',{cache:'no-store'});if(!r.ok)return;const d=await r.json();document.getElementById('posX').textContent=Number(d.pos_x_m||0).toFixed(2);document.getElementById('posY').textContent=Number(d.pos_y_m||0).toFixed(2);document.getElementById('posZ').textContent=Number(d.pos_z_m||0).toFixed(2);document.getElementById('distance').textContent=Number(d.distance_from_origin_m||0).toFixed(2);const s=document.getElementById('motionState');if(d.outside_safe_radius){s.textContent='FUERA DEL RADIO DE 2 M';s.className='alert';}else{s.textContent='DENTRO DEL RADIO DE 2 M';s.className='safe';}}catch(e){}}refreshMotion();setInterval(refreshMotion,500);</script></main></body></html>");
  return page;
}

void handleDashboard() {
  EcgState snapshot;
  portENTER_CRITICAL(&stateMux);
  snapshot = ecgState;
  portEXIT_CRITICAL(&stateMux);
  localServer.send(200, "text/html; charset=utf-8",
                   dashboardHtml(snapshot, localServer.hasArg("saved")));
}

void handleVitalsJson() {
  EcgState snapshot;
  portENTER_CRITICAL(&stateMux);
  snapshot = ecgState;
  portEXIT_CRITICAL(&stateMux);

  JsonDocument doc;
  doc["temperature_c"] = roundf(snapshot.temperatureC * 10) / 10;
  doc["blood_pressure_systolic_mmhg"] = snapshot.systolicMmHg;
  doc["blood_pressure_diastolic_mmhg"] = snapshot.diastolicMmHg;
  doc["radiation_dose_rate_usvh"] =
      roundf(snapshot.radiationDoseRateUsvh * 10) / 10;
  String body;
  serializeJson(doc, body);
  localServer.send(200, "application/json", body);
}

void handleMotionJson() {
  EcgState snapshot;
  portENTER_CRITICAL(&stateMux);
  snapshot = ecgState;
  portEXIT_CRITICAL(&stateMux);

  JsonDocument doc;
  doc["mpu_ready"] = snapshot.mpuReady;
  doc["ax"] = snapshot.ax;
  doc["ay"] = snapshot.ay;
  doc["az"] = snapshot.az;
  doc["gx"] = snapshot.gx;
  doc["gy"] = snapshot.gy;
  doc["gz"] = snapshot.gz;
  doc["pos_x_m"] = snapshot.posX;
  doc["pos_y_m"] = snapshot.posY;
  doc["pos_z_m"] = snapshot.posZ;
  doc["distance_from_origin_m"] = snapshot.distanceFromOrigin;
  doc["movement_detected"] = snapshot.movementDetected;
  doc["outside_safe_radius"] = snapshot.outsideSafeRadius;
  String body;
  serializeJson(doc, body);
  localServer.send(200, "application/json", body);
}

void handleResetPosition() {
  portENTER_CRITICAL(&stateMux);
  resetPositionRequested = true;
  portEXIT_CRITICAL(&stateMux);
  localServer.sendHeader("Location", "/", true);
  localServer.send(303, "text/plain", "");
}

void handleSetRadiation() {
  if (!localServer.hasArg("radiation")) {
    localServer.send(400, "application/json", "{\"ok\":false}");
    return;
  }

  const float radiationMsvh = localServer.arg("radiation").toFloat();
  const float radiationUsvh = radiationMsvh * 1000.0f;
  if (radiationUsvh < MIN_RADIATION_USVH ||
      radiationUsvh > MAX_RADIATION_USVH) {
    localServer.send(400, "application/json", "{\"ok\":false}");
    return;
  }

  portENTER_CRITICAL(&stateMux);
  ecgState.radiationDoseRateUsvh = radiationUsvh;
  manualSendRequested = true;
  portEXIT_CRITICAL(&stateMux);

  Serial.printf("Radiacion manual=%.3f mSv/h (%.1f uSv/h)\n",
                radiationMsvh, radiationUsvh);
  localServer.send(200, "application/json", "{\"ok\":true}");
}

void handleSetVitals() {
  if (!localServer.hasArg("temperature") || !localServer.hasArg("systolic") ||
      !localServer.hasArg("diastolic") || !localServer.hasArg("radiation")) {
    localServer.send(400, "text/plain; charset=utf-8", "Faltan valores.");
    return;
  }

  const float temperature = localServer.arg("temperature").toFloat();
  const int systolic = localServer.arg("systolic").toInt();
  const int diastolic = localServer.arg("diastolic").toInt();
  const float radiationMsvh = localServer.arg("radiation").toFloat();
  const float radiation = radiationMsvh * 1000.0f;

  if (temperature < MIN_TEMPERATURE_C || temperature > MAX_TEMPERATURE_C ||
      systolic < MIN_SYSTOLIC_MMHG || systolic > MAX_SYSTOLIC_MMHG ||
      diastolic < MIN_DIASTOLIC_MMHG || diastolic > MAX_DIASTOLIC_MMHG ||
      diastolic >= systolic || radiation < MIN_RADIATION_USVH ||
      radiation > MAX_RADIATION_USVH) {
    localServer.send(400, "text/plain; charset=utf-8",
                     "Valores fuera de rango o presion diastolica mayor/igual a la sistolica.");
    return;
  }

  portENTER_CRITICAL(&stateMux);
  ecgState.temperatureC = temperature;
  ecgState.systolicMmHg = static_cast<uint16_t>(systolic);
  ecgState.diastolicMmHg = static_cast<uint16_t>(diastolic);
  ecgState.radiationDoseRateUsvh = radiation;
  manualSendRequested = true;
  portEXIT_CRITICAL(&stateMux);

  Serial.printf("Simulacion manual | temperatura=%.1f C | presion=%d/%d mmHg | radiacion=%.3f mSv/h\n",
                temperature, systolic, diastolic, radiationMsvh);
  localServer.sendHeader("Location", "/?saved=1", true);
  localServer.send(303, "text/plain", "");
}

void startLocalServer() {
  localServer.on("/", HTTP_GET, handleDashboard);
  localServer.on("/api/vitals", HTTP_GET, handleVitalsJson);
  localServer.on("/api/motion", HTTP_GET, handleMotionJson);
  localServer.on("/set", HTTP_POST, handleSetVitals);
  localServer.on("/set-radiation", HTTP_POST, handleSetRadiation);
  localServer.on("/reset-position", HTTP_POST, handleResetPosition);
  localServer.onNotFound([]() {
    localServer.send(404, "text/plain; charset=utf-8", "Ruta no encontrada.");
  });
  localServer.begin();
  Serial.print("Servidor manual disponible en http://");
  Serial.println(WiFi.localIP());
}

bool sendEcgTelemetry(const EcgState& snapshot) {
  if (!connectWiFi()) return false;

  JsonDocument doc;
  doc["astronaut_id"] = ASTRONAUT_ID;
  doc["device_id"] = DEVICE_ID;
  doc["ecg_raw"] = snapshot.raw;
  if (snapshot.heartRateBpm >= 25 && snapshot.heartRateBpm <= 240) {
    doc["heart_rate_bpm"] = roundf(snapshot.heartRateBpm * 10) / 10;
  } else {
    doc["heart_rate_bpm"] = nullptr;
  }
  doc["leads_off"] = snapshot.leadsOff;
  doc["resp_raw"] = snapshot.respRaw;
  if (snapshot.respirationValid) {
    doc["respiration_rate_bpm"] =
        roundf(snapshot.respirationRateBpm * 10) / 10;
  } else {
    doc["respiration_rate_bpm"] = nullptr;
  }
  doc["temperature_c"] = roundf(snapshot.temperatureC * 10) / 10;
  doc["blood_pressure_systolic_mmhg"] = snapshot.systolicMmHg;
  doc["blood_pressure_diastolic_mmhg"] = snapshot.diastolicMmHg;
  doc["radiation_dose_rate_usvh"] =
      roundf(snapshot.radiationDoseRateUsvh * 10) / 10;
  if (snapshot.mpuReady) {
    doc["ax"] = roundf(snapshot.ax * 1000) / 1000;
    doc["ay"] = roundf(snapshot.ay * 1000) / 1000;
    doc["az"] = roundf(snapshot.az * 1000) / 1000;
    doc["gx"] = roundf(snapshot.gx * 100) / 100;
    doc["gy"] = roundf(snapshot.gy * 100) / 100;
    doc["gz"] = roundf(snapshot.gz * 100) / 100;
    doc["pos_x_m"] = roundf(snapshot.posX * 1000) / 1000;
    doc["pos_y_m"] = roundf(snapshot.posY * 1000) / 1000;
    doc["pos_z_m"] = roundf(snapshot.posZ * 1000) / 1000;
    doc["distance_from_origin_m"] =
        roundf(snapshot.distanceFromOrigin * 1000) / 1000;
    doc["movement_detected"] = snapshot.movementDetected;
    doc["outside_safe_radius"] = snapshot.outsideSafeRadius;
  } else {
    // Sin MPU6050: null (no 0), para que la app no muestre una posicion inventada.
    static const char* const MOTION_KEYS[] = {
        "ax", "ay", "az", "gx", "gy", "gz", "pos_x_m", "pos_y_m", "pos_z_m",
        "distance_from_origin_m", "movement_detected", "outside_safe_radius"};
    for (const char* key : MOTION_KEYS) doc[key] = nullptr;
  }
  doc["area_m2"] = 0;
  doc["steps"] = 0;
  doc["battery_pct"] = 100;
  doc["timestamp_ms"] = millis();

  String body;
  serializeJson(doc, body);

  if (!ensureSupabaseConnection()) return false;
  const int code = supabaseHttp.POST(body);
  if (code == 201) {
    if (snapshot.respirationValid) {
      Serial.printf("ECG enviado | raw=%u | bpm=%.1f | resp=%.1f | electrodos=%s\n",
                    snapshot.raw, snapshot.heartRateBpm,
                    snapshot.respirationRateBpm,
                    snapshot.leadsOff ? "OFF" : "OK");
    } else {
      Serial.printf("ECG enviado | raw=%u | bpm=%.1f | resp=calculando | electrodos=%s\n",
                    snapshot.raw, snapshot.heartRateBpm,
                    snapshot.leadsOff ? "OFF" : "OK");
    }
  } else if (code > 0) {
    Serial.printf("Error Supabase %d: %s\n", code,
                  supabaseHttp.getString().c_str());
  } else {
    Serial.printf("Error HTTPS %d: %s. Se reconectara.\n", code,
                  HTTPClient::errorToString(code).c_str());
    resetSupabaseConnection();
  }
  return code == 201;
}

void networkTask(void* parameter) {
  uint32_t lastSendMs = 0;
  for (;;) {
    bool shouldSend = false;
    EcgState snapshot;
    portENTER_CRITICAL(&stateMux);
    const bool forceSend = manualSendRequested;
    if (forceSend) manualSendRequested = false;
    const uint32_t now = millis();
    if (forceSend || now - lastSendMs >= SEND_PERIOD_MS) {
      snapshot = ecgState;
      shouldSend = true;
      lastSendMs = now;  // Periodo medido desde el inicio: un envio cada 1 s.
    }
    portEXIT_CRITICAL(&stateMux);

    if (shouldSend) sendEcgTelemetry(snapshot);
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\nSTELLAR ECG + MPU6050 Node v2.3");

  if (!credentialsConfigured()) {
    Serial.println("ERROR: copia secrets.example.h como secrets.h y completa Wi-Fi/Supabase.");
    while (true) delay(1000);
  }

  pinMode(ECG_PIN, INPUT);
  pinMode(LO_PLUS_PIN, INPUT);
  pinMode(LO_MINUS_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(ECG_PIN, ADC_11db);

  const bool mpuStarted = initializeMpu6050();

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  secureClient.setInsecure();  // Prototipo: cifra HTTPS, pero no valida el certificado.

  connectWiFi();
  startLocalServer();

  xTaskCreatePinnedToCore(ecgTask, "ecg-250hz", 4096, nullptr, 3, nullptr, 1);
  if (mpuStarted) {
    xTaskCreatePinnedToCore(motionTask, "mpu-50hz", 4096, nullptr, 2, nullptr, 1);
  }
  xTaskCreatePinnedToCore(networkTask, "supabase-1hz", 8192, nullptr, 1, nullptr, 0);
}

void loop() {
  // Atiende la pagina local; ECG y HTTPS trabajan en tareas separadas.
  localServer.handleClient();
  delay(2);
}

