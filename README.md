# STELLAR Health

Prototipo local para el reto NASA Space Apps Challenge 2026 **Create Health Monitoring Software for Astronauts on Space Missions**. Integra un panel web React + TypeScript, una API FastAPI y firmware para un ESP32 DevKit de 38 pines con AD8232, cinturón respiratorio y MPU6050.

El flujo principal sigue el reto: **recopilar** indicadores, **evaluar** cambios frente a una línea base y **actuar** mediante instrucciones claras. El astronauta dispone de monitorización cardiovascular, respiratoria y de movimiento, un entrenador 3D de ejercicios y un chequeo breve de bienestar psicológico.

## Perfiles locales Artemis III

- Randy Bresnik: comandante. Ve su información personal y un panel adicional de solo lectura para supervisar a toda la tripulación.
- Luca Parmitano: piloto. Ve únicamente su salud, ejercicios, bienestar y preferencias.
- Andre Douglas y Frank Rubio: especialistas de misión. Cada uno ve únicamente su perfil personal.
- NASA: perfil técnico para configuración de la interfaz. En el prototipo no tiene contraseña; la autenticación queda pendiente para una fase posterior.

Los perfiles se eligen localmente mediante una pantalla tipo servicio de streaming. No existen cuentas, correos ni contraseñas en esta versión.

Las fotografías de los cuatro perfiles son retratos oficiales publicados por NASA en la página de la tripulación Artemis III y se almacenan localmente en `frontend/public/crew`.

## Flujo ESP32 por red local

Cada astronauta usa un ESP32 identificado por `astronaut_id`. El nodo envía por Wi-Fi ECG, frecuencia cardiaca estimada, respiración, IMU, recorrido y batería a `POST /api/telemetry`. La API separa el historial de cada tripulante; el panel personal consulta `/api/state` y `/api/history`, mientras que la vista del comandante consulta `/api/crew` en modo de solo lectura.

Si un nodo deja de transmitir durante cinco segundos, esa ficha cambia automáticamente a simulación para que la demostración continúe. Esto se indica claramente en la interfaz como `ESP32` o `SIM`.

## Inicio rápido

1. Instala las dependencias una sola vez:

   ```powershell
   .\scripts\setup-local.ps1
   ```

2. Inicia backend y frontend:

   ```powershell
   .\scripts\start-local.ps1
   ```

3. Abre `http://localhost:5173`.

Sin el ESP32, el backend genera telemetría simulada. Cuando recibe datos reales en `POST /api/telemetry`, el panel cambia automáticamente a modo hardware.

Consulta [firmware/README.md](firmware/README.md) para el cableado, las librerías de Arduino IDE y la carga del programa.

> Este prototipo es educativo y de demostración. No es un dispositivo médico ni debe usarse para diagnóstico.

