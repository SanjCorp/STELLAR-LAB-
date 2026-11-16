# ESP32 code

This directory contains the two Arduino sketches used by the STELLAR Health prototype. They are intentionally kept in separate folders because each sketch defines its own `setup()` and `loop()` functions.

## Projects

- `stellar_node/`: primary ESP32 firmware for the AD8232 ECG, ECG-derived respiration, MPU6050 motion and orientation, local manual controls, and Supabase telemetry.
- `manual_telemetry_server/`: manual telemetry simulator with a local ESP32 web interface for functional testing.

## Configure locally

For the sketch that you want to compile:

1. Open its folder.
2. Copy `secrets.example.h` as `secrets.h` in the same folder.
3. Put your Wi-Fi name, Wi-Fi password, Supabase REST endpoint, and public publishable key in the local `secrets.h` file.
4. Open the `.ino` file in Arduino IDE.
5. Select **ESP32 Dev Module** and the correct serial port, then compile and upload.

The repository contains no real Wi-Fi credential, Supabase project URL, or API key. `secrets.h` is ignored by Git and must remain local. If a credential has previously been shared or committed, revoke or rotate it before using the firmware again.

## Arduino dependencies

- ESP32 board package by Espressif Systems
- ArduinoJson

`WiFi`, `HTTPClient`, `WiFiClientSecure`, `WebServer`, and `Wire` are included with the ESP32 board package.

## Prototype warning

This firmware is an educational prototype. ECG-derived heart and respiration values are estimates and must not be used for medical diagnosis or operational flight decisions.
