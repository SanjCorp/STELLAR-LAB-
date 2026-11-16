# STELLAR Health

**Explainable health monitoring for astronauts on long-duration missions**

[Live application](https://stellar-health-ten.vercel.app) · [Presentation video](https://www.tiktok.com/t/ZPLwtt8tj/) · [Source code](https://github.com/SanjCorp/STELLAR-LAB-)

> Educational NASA Space Apps prototype. STELLAR Health is not a medical device and must not be used for diagnosis or operational flight decisions.

## Overview

STELLAR Health combines wearable electronics, firmware, cloud telemetry, transparent statistical analysis, and an astronaut-focused interface. It follows the challenge cycle:

1. **Collect** health, movement, position, environmental, and well-being data.
2. **Assess** each astronaut against their own baseline instead of relying only on general thresholds.
3. **Act** through explained alerts, recommended actions, exercise guidance, and concise crew reports.

The demonstration video shows the chest-mounted STELLAR Node transmitting real AD8232 and MPU6050 readings, the live application, an explained alert, and wrist mode. Temperature, blood pressure, and radiation remain simulated test inputs until dedicated sensors are selected and integrated.

## Collect, assess, and act

### 1. Collect

Each crew member can use a **STELLAR Node**, built around an ESP32:

- An **AD8232 ECG module** acquires the chest signal. Firmware estimates heart rate and derives a respiratory-rate approximation from the ECG itself, without an additional respiration sensor.
- An **MPU6050 accelerometer and gyroscope** measures movement and orientation from the foot-mounted node.
- The node estimates X, Y, Z, and distance from a calibrated zero point representing the spacecraft.
- A local ESP32 webpage provides manual simulation controls for temperature, blood pressure, and radiation.
- Telemetry is sent through Wi-Fi and HTTPS to Supabase.

The interface always identifies the source of each value: `ESP32`, `PHONE`, `MANUAL`, or `SIMULATION`.

### 2. Assess

The FastAPI backend performs transparent statistical analysis rather than using a diagnostic black box:

- A baseline starts after at least 30 valid readings and continues refining over a ten-minute reference window.
- The current state is the median of the most recent 15 seconds.
- Personal variation is estimated with the median absolute deviation.
- A robust z-score measures how far the current value is from that astronaut's normal range.
- General demonstration safety ranges remain active while the personal baseline is still calibrating.

This approach can detect changes that a single population-wide threshold could miss while keeping every result understandable and auditable.

### 3. Act

Every alert is explainable and includes:

- **What changed**, including the relevant values and duration.
- **Why it matters**, connected to a human-spaceflight hazard.
- **What to do next**, expressed as concrete steps.
- **Who should act**, using three escalation levels:
  - Level 1: self-care.
  - Level 2: notify the crew medical officer.
  - Level 3: consult flight surgeons on Earth.

The wrist interface vibrates when an alert rises to Level 2 or Level 3 on supported smartphones. Sound notifications are planned but are not implemented in the current prototype.

## Real data and automatic simulation

The backend considers an astronaut's hardware node active while a valid row has arrived within the previous **10 seconds**. When no node is connected, or a node stops transmitting, the server automatically generates controlled, variable pseudo-random data with the same schema as the hardware telemetry.

This fallback keeps dashboards, charts, alerts, exercise views, and Mission Control available for demonstrations and functional testing without pretending that simulated values are real measurements. Simulation is generated when the API responds and does not overwrite genuine rows in the telemetry database. As soon as a valid ESP32 row arrives, the interface automatically returns to hardware mode.

## Application views

- **Live dashboard:** heart rate, respiration, movement, status, alerts, and source identification.
- **Raw monitoring:** ECG and motion signals with signal-quality information.
- **EVA position:** Three.js view of the astronaut, spacecraft, trajectory, distance, and radiation environment.
- **Exercise coach:** guided routines, posture calibration, and automatic repetition counting.
- **Daily well-being check-in:** sleep, mood, stress, symptoms, temperature, and optional measurements.
- **Health analytics:** trends, baseline explanations, environmental hazards, and data provenance.
- **Crew Command:** read-only overview of the whole crew for the mission commander.
- **Mission Control:** concise crew and medical reports for teams on Earth.
- **Wrist mode:** high-contrast landscape interface with essential values, action-first alerts, vibration, and a compact position radar.

## Position sources and fallback

STELLAR Health supports three position sources:

1. **MPU6050:** acceleration is integrated from a calibrated zero point.
2. **Smartphone:** steps and compass heading provide a second dead-reckoning estimate.
3. **Simulation:** a test trajectory is used when neither physical source is available.

The application can switch sources when the selected source has no data or becomes unstable. Accelerometer-based position accumulates drift and is not an absolute navigation system. A flight implementation would require validated radio beacons, UWB, or another mission-approved positioning system.

## Radiation monitoring status

Radiation is one of the hazards represented by STELLAR Health, but the current project **does not include a physical dosimeter**. The team does not have sufficiently detailed information about the exact NASA instruments, protocols, and calibration procedures for this mission to reproduce an operational configuration.

Current radiation values are exclusively simulated:

- They can be entered manually with the ESP32 web control.
- They can be generated automatically as controlled pseudo-random test values.
- They are used to test charts, alert levels, visual effects, and recommended responses.

These values are not NASA measurements, astronaut exposure records, official limits, or medical dose assessments. Per-astronaut cumulative dose tracking is future work and will require a real sensor, documented calibration, validated exposure rules, and mission-specific integration.

## Architecture

```text
AD8232 + MPU6050 + manual test controls
                    │
                    ▼
              ESP32 / FreeRTOS
       ├─ local configuration webpage
       └─ HTTPS telemetry upload
                    │
                    ▼
        Supabase PostgreSQL telemetry
                    │
                    ▼
          Python / FastAPI backend
       ├─ source selection and simulation
       ├─ personal baseline analysis
       ├─ alerts and recommendations
       └─ crew and Mission Control reports
                    │
                    ▼
       React + TypeScript + Three.js UI
```

The ESP32 and the computer displaying the application may be on different networks because the main telemetry path uses Supabase. A local `POST /api/telemetry` endpoint remains available for development.

## Hardware and firmware

| Component | Current use |
|---|---|
| ESP32 DevKit / WROOM-32, 38 pins | node controller, Wi-Fi, local web server |
| AD8232 with electrodes | ECG acquisition, heart-rate estimate, ECG-derived respiration |
| MPU6050 | acceleration, gyroscope, posture, movement, estimated position |
| Smartphone | optional wrist display, vibration, steps, and compass-based position |
| Temperature and blood pressure | manual test values; dedicated sensors not yet connected |
| Radiation | manual and automatic simulation; physical dosimeter not yet connected |

Firmware details:

- C++ with Arduino and FreeRTOS.
- ECG sampled at **250 samples per second**.
- MPU6050 sampled at **50 samples per second**.
- ECG and motion run in dedicated tasks.
- One consolidated telemetry row is normally uploaded each second.
- HTTPS connection reuse reduces repeated connection overhead.
- The local ESP32 page can reset the movement origin and adjust manual values.

See [firmware/README.md](firmware/README.md) for wiring and [firmware/SUPABASE.md](firmware/SUPABASE.md) for the telemetry format.

## Technology stack

- **Firmware:** C++, Arduino, FreeRTOS, ArduinoJson.
- **Backend:** Python, FastAPI.
- **Database:** Supabase PostgreSQL.
- **Frontend:** React, TypeScript, Vite.
- **3D visualization:** Three.js.
- **Charts:** custom SVG components.
- **Deployment:** Vercel.
- **Collaboration and source control:** GitHub.

## Data security

- The ESP32 contains only a public, write-limited project key; it never contains the private backend key.
- Database reads are performed by the backend with a server-side secret.
- Credentials are stored in local `secrets.h` and `.env` files that are excluded from Git.
- The frontend never receives the server-side secret.
- Optional `APP_PASSWORD` protects access to the complete demonstration.
- Public database permissions must be restricted with appropriate Supabase row-level security policies.

The prototype currently uses `secureClient.setInsecure()`: traffic is encrypted, but the ESP32 does not validate the remote certificate. A production system must use certificate validation and mission-approved key management.

## Artemis III demonstration profiles

- **Randy Bresnik**, commander: personal view, Crew Command, and Mission Control.
- **Luca Parmitano**, pilot: personal health, EVA, exercise, and well-being.
- **Andre Douglas**, mission specialist: personal health, EVA, exercise, and well-being.
- **Frank Rubio**, mission specialist: personal health, EVA, exercise, and well-being.
- **NASA**, technical profile for Mission Control and system status.

These names are demonstration profiles used by the prototype; they should not be interpreted as an official NASA crew announcement. Profiles are local interface selections, not individual login accounts. A global team password can be configured separately.

## Why it matters

Long-duration crews must manage health with increasing autonomy, limited connectivity, communication delays, isolation, altered gravity, confined environments, and radiation risk. STELLAR Health explores how one integrated system can support:

- Earlier recognition of changes from an astronaut's personal normal.
- Clear, actionable explanations instead of unexplained warning lights.
- Exercise support intended to help maintain muscle and bone health.
- Regular mental well-being check-ins.
- Shared awareness for the astronaut, commander, and medical teams on Earth.
- Continued demonstrations when hardware is unavailable through clearly labeled simulation.

The same concept may also apply to remote research stations, hazardous workplaces, isolated expeditions, and home monitoring, subject to proper clinical and regulatory validation.

## Quick start on Windows

Requirements:

- [Python 3](https://www.python.org/downloads/)
- [Node.js LTS](https://nodejs.org/)

Download and extract the repository, then run:

```text
INICIAR PROGRAMA.bat
```

The launcher installs dependencies on first use, starts the backend and frontend, and opens `http://localhost:5173`.

Manual start:

```powershell
.\scripts\setup-local.ps1
.\scripts\start-local.ps1
```

The application works without hardware or Supabase by using simulation mode.

## Supabase and ESP32 setup

To receive hardware telemetry:

1. Copy `backend/.env.example` to `backend/.env`.
2. Add `SUPABASE_URL` and the backend-only `SUPABASE_SECRET_KEY`.
3. Apply the required migrations in `docs/sql`, including `006_radiacion.sql`.
4. Copy `esp32-code/stellar_node/secrets.example.h` to `esp32-code/stellar_node/secrets.h`.
5. Add Wi-Fi, the public insertion key, astronaut ID, and device ID.
6. Open `esp32-code/stellar_node/stellar_node.ino` and select **ESP32 Dev Module** in Arduino IDE.

Never commit `secrets.h`, `.env`, Wi-Fi credentials, or private database keys. Rotate any credential that has previously appeared in Git history.

## Repository structure

```text
backend/          FastAPI, analysis, simulation, alerts, and reports
frontend/         React, TypeScript, Three.js, and wrist interface
esp32-code/       primary ESP32 firmware and manual telemetry simulator
firmware/         wiring and telemetry documentation
docs/sql/         Supabase migrations
scripts/          local setup and startup
INICIAR PROGRAMA.bat
```

## Current limitations

- The AD8232 and ECG-derived respiration are prototype estimates, not clinical measurements.
- Temperature, blood pressure, and radiation are currently simulated test inputs.
- MPU6050 and phone position are dead-reckoning estimates and accumulate error.
- Complete offline alert processing is not yet implemented; the local ESP32 page remains available on the local network, but the full analysis pipeline requires the backend.
- Sound alerts, a physical radiation sensor, validated cumulative dose, and certified backup hardware remain future work.
- All thresholds and recommendations require expert validation before any real-world use.

## Links

- **Presentation video:** https://www.tiktok.com/t/ZPLwtt8tj/
- **Online application:** https://stellar-health-ten.vercel.app
- **Source code:** https://github.com/SanjCorp/STELLAR-LAB-
