from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from math import pi, sin
from random import uniform
from time import monotonic
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

AstronautId = Literal["bresnik", "parmitano", "douglas", "rubio"]
ASTRONAUTS: dict[str, dict[str, float]] = {
    "bresnik": {"heart": 71, "respiration": 15.4, "movement": 82, "phase": 0.0},
    "parmitano": {"heart": 68, "respiration": 14.8, "movement": 91, "phase": 1.2},
    "douglas": {"heart": 76, "respiration": 17.2, "movement": 74, "phase": 2.4},
    "rubio": {"heart": 70, "respiration": 15.9, "movement": 86, "phase": 3.6},
}


class TelemetryIn(BaseModel):
    astronaut_id: AstronautId = "bresnik"
    device_id: str = "stellar-node-01"
    ecg_raw: int = Field(ge=0, le=4095)
    heart_rate_bpm: float | None = Field(default=None, ge=25, le=240)
    leads_off: bool = False
    resp_raw: int = Field(default=0, ge=0, le=4095)
    respiration_rate_bpm: float | None = Field(default=None, ge=0, le=60)
    ax: float = 0
    ay: float = 0
    az: float = 0
    gx: float = 0
    gy: float = 0
    gz: float = 0
    pos_x_m: float = 0
    pos_y_m: float = 0
    area_m2: float = Field(default=0, ge=0)
    steps: int = Field(default=0, ge=0)
    battery_pct: int = Field(default=100, ge=0, le=100)
    timestamp_ms: int | None = None


app = FastAPI(title="STELLAR Health API", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

histories: dict[str, deque[dict]] = {key: deque(maxlen=240) for key in ASTRONAUTS}
last_real_packets: dict[str, float] = {key: 0.0 for key in ASTRONAUTS}
last_real: dict[str, dict | None] = {key: None for key in ASTRONAUTS}
started = monotonic()


def simulated_sample(astronaut_id: str) -> dict:
    config = ASTRONAUTS[astronaut_id]
    t = monotonic() - started
    phase = config["phase"]
    beat = sin(2 * pi * (config["heart"] / 60) * t + phase)
    qrs = max(0.0, beat) ** 18
    respiratory_wave = sin(2 * pi * (config["respiration"] / 60) * t + phase)
    x = 1.25 * sin(t / 5.5 + phase)
    y = 0.85 * sin(t / 7.0 + 0.8 + phase)
    return {
        "astronaut_id": astronaut_id,
        "device_id": f"sim-{astronaut_id}",
        "source": "simulation",
        "received_at": datetime.now(timezone.utc).isoformat(),
        "ecg_raw": int(1900 + 110 * beat + 720 * qrs + uniform(-18, 18)),
        "leads_off": False,
        "heart_rate_bpm": round(config["heart"] + 2 * sin(t / 9 + phase), 1),
        "resp_raw": int(2050 + 520 * respiratory_wave + uniform(-12, 12)),
        "respiration_rate_bpm": round(config["respiration"] + 0.5 * sin(t / 18 + phase), 1),
        "ax": round(0.18 * sin(t * 2.2 + phase), 3),
        "ay": round(0.14 * sin(t * 1.8 + 1 + phase), 3),
        "az": round(9.81 + 0.12 * sin(t * 2.7 + phase), 3),
        "gx": round(8 * sin(t * 1.2 + phase), 2),
        "gy": round(5 * sin(t * 1.4 + phase), 2),
        "gz": round(3 * sin(t + phase), 2),
        "pos_x_m": round(x, 2),
        "pos_y_m": round(y, 2),
        "area_m2": round(4 * 1.25 * 0.85, 2),
        "steps": int(t / 1.3) + int(config["movement"]),
        "battery_pct": 86,
    }


def current_sample(astronaut_id: str) -> dict:
    real = last_real[astronaut_id]
    if real and monotonic() - last_real_packets[astronaut_id] < 5:
        return real
    sample = simulated_sample(astronaut_id)
    histories[astronaut_id].append(sample)
    return sample


def crew_summary(sample: dict) -> dict:
    heart = sample.get("heart_rate_bpm")
    respiration = sample.get("respiration_rate_bpm")
    movement = min(100, max(0, int(sample.get("steps", 0) % 101)))
    if sample["source"] == "simulation":
        movement = int(ASTRONAUTS[sample["astronaut_id"]]["movement"])
    observe = bool((heart and not 45 <= heart <= 105) or (respiration and not 8 <= respiration <= 24) or sample.get("leads_off"))
    recovery = max(45, min(98, 94 - abs((heart or 72) - 72) - int(abs((respiration or 16) - 16) * 2)))
    return {
        "astronaut_id": sample["astronaut_id"],
        "source": sample["source"],
        "heart_rate_bpm": heart,
        "respiration_rate_bpm": respiration,
        "movement_score": movement,
        "recovery_score": recovery,
        "status": "Observe" if observe else "Stable",
        "received_at": sample["received_at"],
    }


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "stellar-health-api", "crew_nodes": len(ASTRONAUTS)}


@app.get("/api/state")
def state(astronaut_id: AstronautId = "bresnik") -> dict:
    return current_sample(astronaut_id)


@app.get("/api/history")
def get_history(astronaut_id: AstronautId = "bresnik", limit: int = 120) -> dict:
    current_sample(astronaut_id)
    return {"astronaut_id": astronaut_id, "items": list(histories[astronaut_id])[-max(1, min(limit, 240)): ]}


@app.get("/api/crew")
def get_crew() -> dict:
    return {"items": [crew_summary(current_sample(astronaut_id)) for astronaut_id in ASTRONAUTS]}


@app.post("/api/telemetry")
def telemetry(packet: TelemetryIn) -> dict:
    astronaut_id = packet.astronaut_id
    payload = packet.model_dump()
    payload.update(source="hardware", received_at=datetime.now(timezone.utc).isoformat())
    last_real_packets[astronaut_id] = monotonic()
    last_real[astronaut_id] = payload
    histories[astronaut_id].append(payload)
    return {"accepted": True, "astronaut_id": astronaut_id, "samples": len(histories[astronaut_id])}
