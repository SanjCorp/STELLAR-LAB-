from __future__ import annotations

import hashlib
import hmac
import os
import time
from collections import deque
from datetime import datetime, timezone
from math import floor, pi, sin
from typing import Literal

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import supabase_store

supabase_store.load_env_file()

AstronautId = Literal["bresnik", "parmitano", "douglas", "rubio"]
ASTRONAUTS: dict[str, dict[str, float]] = {
    "bresnik": {"heart": 71, "respiration": 15.4, "movement": 82, "phase": 0.0},
    "parmitano": {"heart": 68, "respiration": 14.8, "movement": 91, "phase": 1.2},
    "douglas": {"heart": 76, "respiration": 17.2, "movement": 74, "phase": 2.4},
    "rubio": {"heart": 70, "respiration": 15.9, "movement": 86, "phase": 3.6},
}

# Si un astronauta no envía datos reales en este tiempo, su ficha pasa a simulación.
LIVE_WINDOW_S = 5
MAX_HISTORY = 240
# Ventana de filas que se piden a Supabase para un astronauta (historial + margen).
ASTRONAUT_WINDOW_S = MAX_HISTORY + LIVE_WINDOW_S + 5

SESSION_COOKIE = "stellar_session"
SESSION_DAYS = 7
# Rutas de /api que no necesitan contraseña.
PUBLIC_API = {"/api/login", "/api/logout", "/api/session", "/api/health"}


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


class LoginIn(BaseModel):
    password: str


app = FastAPI(title="STELLAR Health API", version="0.4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paquetes recibidos por POST /api/telemetry (ruta local directa al backend).
# Solo vive en memoria: en Vercel no se comparte entre instancias, por eso allí
# el ESP32 debe enviar a Supabase.
local_packets: dict[str, deque[dict]] = {key: deque(maxlen=MAX_HISTORY + 20) for key in ASTRONAUTS}


# --------------------------------------------------------------------------- #
# Contraseña de acceso (opcional)
# --------------------------------------------------------------------------- #
def app_password() -> str:
    return os.environ.get("APP_PASSWORD", "")


def _signature(expires: int) -> str:
    return hmac.new(app_password().encode(), f"stellar-session:{expires}".encode(), hashlib.sha256).hexdigest()


def session_valid(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    expires_text, signature = token.split(".", 1)
    if not expires_text.isdigit() or int(expires_text) < time.time():
        return False
    return hmac.compare_digest(signature, _signature(int(expires_text)))


def is_authenticated(request: Request) -> bool:
    return not app_password() or session_valid(request.cookies.get(SESSION_COOKIE))


@app.middleware("http")
async def require_password(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api") and path not in PUBLIC_API and not is_authenticated(request):
        return JSONResponse({"detail": "Se requiere contraseña"}, status_code=401)
    return await call_next(request)


@app.get("/api/session")
def session(request: Request) -> dict:
    return {"required": bool(app_password()), "authenticated": is_authenticated(request)}


@app.post("/api/login")
def login(body: LoginIn, request: Request, response: Response) -> dict:
    password = app_password()
    if not password:
        return {"authenticated": True}
    if not hmac.compare_digest(body.password.encode(), password.encode()):
        time.sleep(1)  # frena intentos repetidos
        response.status_code = 401
        return {"authenticated": False, "detail": "Contraseña incorrecta"}
    expires = int(time.time()) + SESSION_DAYS * 86400
    https = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(
        SESSION_COOKIE,
        f"{expires}.{_signature(expires)}",
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        secure=https,
        samesite="lax",
        path="/",
    )
    return {"authenticated": True}


@app.post("/api/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"authenticated": False}


# --------------------------------------------------------------------------- #
# Datos: simulación calculada al momento + filas reales
# --------------------------------------------------------------------------- #
def _noise(t: float, seed: float, amplitude: float) -> float:
    """Ruido pseudoaleatorio pero fijo para cada instante (el gráfico no 'tiembla')."""
    x = sin(t * 12.9898 + seed * 78.233) * 43758.5453
    return (x - floor(x) - 0.5) * 2 * amplitude


def simulated_sample(astronaut_id: str, ts: float) -> dict:
    """Muestra simulada para el instante `ts` (segundos Unix). Siempre da lo mismo para el mismo ts."""
    config = ASTRONAUTS[astronaut_id]
    t = ts % 86400
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
        "received_at": datetime.fromtimestamp(ts, timezone.utc).isoformat(),
        "ecg_raw": int(1900 + 110 * beat + 720 * qrs + _noise(t, phase + 1, 18)),
        "leads_off": False,
        "heart_rate_bpm": round(config["heart"] + 2 * sin(t / 9 + phase), 1),
        "resp_raw": int(2050 + 520 * respiratory_wave + _noise(t, phase + 2, 12)),
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
        "steps": int(t / 9) + int(config["movement"]),
        "battery_pct": 86,
    }


def real_rows(astronaut_id: str | None, window_s: float) -> list[dict]:
    """Filas reales (Supabase + POST local) de los últimos `window_s` s, ordenadas por tiempo."""
    since = time.time() - window_s
    rows = [r for r in supabase_store.recent_rows(astronaut_id, window_s) if r["_ts"] >= since]
    for key, packets in local_packets.items():
        if astronaut_id in (None, key):
            rows.extend(p for p in packets if p["_ts"] >= since)
    rows.sort(key=lambda r: r["_ts"])
    return rows


def public(row: dict) -> dict:
    return {k: v for k, v in row.items() if not k.startswith("_")}


def current_sample(astronaut_id: str) -> dict:
    rows = real_rows(astronaut_id, ASTRONAUT_WINDOW_S)
    now = time.time()
    if rows and now - rows[-1]["_ts"] < LIVE_WINDOW_S:
        return public(rows[-1])
    return simulated_sample(astronaut_id, now)


def history(astronaut_id: str, limit: int) -> list[dict]:
    """Una muestra por segundo de los últimos `limit` segundos.

    En cada segundo se usa la última fila real si el hardware estaba 'vivo' en ese
    momento (llegó algo en los 5 s previos); si no, la simulación de ese segundo.
    """
    rows = real_rows(astronaut_id, ASTRONAUT_WINDOW_S)
    end = floor(time.time())
    items: list[dict] = []
    index = -1
    for second in range(end - limit + 1, end + 1):
        while index + 1 < len(rows) and rows[index + 1]["_ts"] < second + 1:
            index += 1
        if index >= 0 and second + 1 - rows[index]["_ts"] <= LIVE_WINDOW_S:
            items.append(public(rows[index]))
        else:
            items.append(simulated_sample(astronaut_id, second))
    return items


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


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@app.get("/api/health")
def health() -> dict:
    if supabase_store.configured():
        supabase_store.recent_rows(None, LIVE_WINDOW_S)  # comprueba la conexión
    return {
        "status": "ok",
        "service": "stellar-health-api",
        "crew_nodes": len(ASTRONAUTS),
        "password_required": bool(app_password()),
        **supabase_store.status,
    }


@app.get("/api/state")
def state(astronaut_id: AstronautId = "bresnik") -> dict:
    return current_sample(astronaut_id)


@app.get("/api/history")
def get_history(astronaut_id: AstronautId = "bresnik", limit: int = 120) -> dict:
    limit = max(1, min(limit, MAX_HISTORY))
    return {"astronaut_id": astronaut_id, "items": history(astronaut_id, limit)}


@app.get("/api/crew")
def get_crew() -> dict:
    live_rows = real_rows(None, LIVE_WINDOW_S)
    latest = {row["astronaut_id"]: row for row in live_rows}  # la última fila gana
    now = time.time()
    items = []
    for astronaut_id in ASTRONAUTS:
        row = latest.get(astronaut_id)
        sample = public(row) if row else simulated_sample(astronaut_id, now)
        items.append(crew_summary(sample))
    return {"items": items}


@app.post("/api/telemetry")
def telemetry(packet: TelemetryIn) -> dict:
    astronaut_id = packet.astronaut_id
    now = time.time()
    payload = packet.model_dump()
    payload.update(source="hardware", received_at=datetime.fromtimestamp(now, timezone.utc).isoformat(), _ts=now)
    local_packets[astronaut_id].append(payload)
    return {"accepted": True, "astronaut_id": astronaut_id, "samples": len(local_packets[astronaut_id])}
