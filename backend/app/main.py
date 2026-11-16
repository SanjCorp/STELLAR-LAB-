from __future__ import annotations

import hashlib
import hmac
import os
import time
from collections import deque
from datetime import datetime, timezone
from math import floor, pi, sin, sqrt
from typing import Literal

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import alerts, analysis, ctx, supabase_store

supabase_store.load_env_file()

AstronautId = Literal["bresnik", "parmitano", "douglas", "rubio"]
ASTRONAUTS: dict[str, dict[str, float]] = {
    "bresnik": {"heart": 71, "respiration": 15.4, "movement": 82, "phase": 0.0},
    "parmitano": {"heart": 68, "respiration": 14.8, "movement": 91, "phase": 1.2},
    "douglas": {"heart": 76, "respiration": 17.2, "movement": 74, "phase": 2.4},
    "rubio": {"heart": 70, "respiration": 15.9, "movement": 86, "phase": 3.6},
}

# Si un astronauta no envía datos reales en este tiempo, su ficha pasa a simulación.
# (10 s: el ESP32 hoy envía cada ~4 s; con 5 s el panel parpadeaba entre ESP32 y SIM.)
LIVE_WINDOW_S = 10
MAX_HISTORY = 240
# Ventana de filas que se piden a Supabase para un astronauta (línea base de 10 min + margen).
ASTRONAUT_WINDOW_S = analysis.BASELINE_WINDOW_S + LIVE_WINDOW_S + 5

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
    pos_z_m: float | None = None
    # Calculados por el ESP32 (firmware v2.0): distancia al punto 0 y si salió del radio de 2 m.
    distance_from_origin_m: float | None = Field(default=None, ge=0)
    movement_detected: bool | None = None
    outside_safe_radius: bool | None = None
    # Temperatura y presión que el ESP32 envía (hoy las fija Ricardo desde la página local del ESP32).
    temperature_c: float | None = Field(default=None, ge=30, le=45)
    blood_pressure_systolic_mmhg: float | None = Field(default=None, ge=60, le=250)
    blood_pressure_diastolic_mmhg: float | None = Field(default=None, ge=30, le=150)
    area_m2: float = Field(default=0, ge=0)
    steps: int = Field(default=0, ge=0)
    battery_pct: int = Field(default=100, ge=0, le=100)
    # Tasa de dosis de radiación en la nave (µSv/h). Columna radiation_dose_rate_usvh de Supabase.
    radiation_dose_rate_usvh: float | None = Field(default=None, ge=0)
    timestamp_ms: int | None = None


class PhoneIn(BaseModel):
    """Posición calculada en el celular con pasos + brújula (metros desde el punto 0)."""
    astronaut_id: AstronautId
    x_m: float = Field(ge=-500, le=500)
    y_m: float = Field(ge=-500, le=500)
    steps: int = Field(default=0, ge=0)
    battery_pct: int | None = Field(default=None, ge=0, le=100)
    timestamp_ms: int | None = None


class DemoIn(BaseModel):
    """Activa (o quita, con scenario=None) un escenario de demo. Sin astronauta = quitar todos."""
    astronaut_id: AstronautId | None = None
    scenario: Literal["fatigue", "stress", "fever", "leads_off", "eva_far", "solar_storm"] | None = None


class LoginIn(BaseModel):
    password: str


class CheckinIn(BaseModel):
    """Chequeo diario manual. Todos los campos son opcionales salvo el astronauta."""
    astronaut_id: AstronautId
    sleep_hours: float | None = Field(default=None, ge=0, le=24)
    mood: int | None = Field(default=None, ge=1, le=5)
    stress: int | None = Field(default=None, ge=1, le=5)
    glucose_mg_dl: float | None = Field(default=None, ge=20, le=600)
    systolic_mmhg: float | None = Field(default=None, ge=60, le=250)
    diastolic_mmhg: float | None = Field(default=None, ge=30, le=150)
    temperature_c: float | None = Field(default=None, ge=30, le=45)
    notes: str | None = Field(default=None, max_length=500)


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
local_packets: dict[str, deque[dict]] = {key: deque(maxlen=analysis.BASELINE_WINDOW_S + 30) for key in ASTRONAUTS}
# Respaldo de chequeos si la tabla `checkins` de Supabase no existe o falla.
local_checkins: dict[str, deque[dict]] = {key: deque(maxlen=200) for key in ASTRONAUTS}


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
    # Idioma de los textos del backend y escenarios de demo de este navegador.
    ctx.LANG.set(ctx.parse_lang(request.headers.get("x-stellar-lang")))
    ctx.SCENARIOS.set(ctx.parse_scenarios(request.cookies.get(ctx.DEMO_COOKIE)))
    if path.startswith("/api") and path not in PUBLIC_API and not is_authenticated(request):
        return JSONResponse({"detail": ctx.tr("Se requiere contraseña", "Password required")}, status_code=401)
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


# Escenarios de demo: cuánto sube cada señal SIMULADA con el escenario al 100 %.
# (El cambio aparece poco a poco en 30 s; nunca toca las filas reales del ESP32.)
SCENARIO_EFFECTS = {
    "fatigue": {"heart": 18, "respiration": 0.6},
    "stress": {"heart": 30, "respiration": 9},
    "fever": {"heart": 28, "respiration": 2},
    "eva_far": {"heart": 6, "respiration": 1},
    "leads_off": {"heart": 0, "respiration": 0},
    "solar_storm": {"heart": 0, "respiration": 0},  # solo sube la radiación simulada de la nave
}
# Chequeo "virtual" que acompaña a algunos escenarios (como si el astronauta lo hubiera llenado).
SCENARIO_CHECKINS = {
    "fatigue": {"sleep_hours": 4.5, "mood": 3, "stress": 2},
    "stress": {"sleep_hours": 5.5, "mood": 2, "stress": 5},
}
EVA_FAR_RADIUS_M = 29.0


def sim_position(astronaut_id: str, ts: float) -> tuple[float, float, float]:
    """Trayectoria EVA simulada; con el escenario `eva_far` se aleja hasta ~29 m."""
    x, y, z = analysis.eva_position(ASTRONAUTS[astronaut_id]["phase"], ts)
    name, _, k = ctx.scenario(astronaut_id, ts)
    if name == "eva_far" and k > 0:
        r = sqrt(x * x + y * y + z * z) or 1.0
        scale = 1 + k * (EVA_FAR_RADIUS_M / r - 1)
        x, y, z = round(x * scale, 2), round(y * scale, 2), round(z * scale, 2)
    return x, y, z


def simulated_sample(astronaut_id: str, ts: float) -> dict:
    """Muestra simulada para el instante `ts` (segundos Unix). Siempre da lo mismo para el mismo ts."""
    sample = _base_simulated_sample(astronaut_id, ts)
    name, _, k = ctx.scenario(astronaut_id, ts)
    if not name or k <= 0:
        return sample
    effect = SCENARIO_EFFECTS[name]
    sample["scenario"] = name
    sample["heart_rate_bpm"] = round(sample["heart_rate_bpm"] + k * effect["heart"], 1)
    sample["respiration_rate_bpm"] = round(sample["respiration_rate_bpm"] + k * effect["respiration"], 1)
    if name == "leads_off":
        # Electrodo suelto: el AD8232 marca LO y la señal queda plana y sin pulso calculable.
        sample.update(leads_off=True, heart_rate_bpm=None, respiration_rate_bpm=None,
                      ecg_raw=int(4000 + _noise(ts % 86400, 7, 40)))
    return sample


def _base_simulated_sample(astronaut_id: str, ts: float) -> dict:
    config = ASTRONAUTS[astronaut_id]
    t = ts % 86400
    phase = config["phase"]
    beat = sin(2 * pi * (config["heart"] / 60) * t + phase)
    qrs = max(0.0, beat) ** 18
    respiratory_wave = sin(2 * pi * (config["respiration"] / 60) * t + phase)
    x, y, z = sim_position(astronaut_id, ts)
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
        "pos_z_m": round(z, 2),
        "area_m2": round(4 * 1.25 * 0.85, 2),
        "steps": int(t / 9) + int(config["movement"]),
        "battery_pct": 86,
    }


# Filas del modo sensor del celular: van a la misma tabla con device_id "phone-<astronauta>".
# Solo aportan POSICIÓN: nunca cuentan como "hardware vivo" para pulso, respiración ni vitales.
PHONE_PREFIX = "phone-"


def is_phone(row: dict) -> bool:
    return str(row.get("device_id") or "").startswith(PHONE_PREFIX)


# Filas SOLO de radiación (p. ej. inserciones manuales con device_id "rad-nave"): no son el ESP32
# del astronauta, así que no cuentan para pulso, respiración ni posición.
RADIATION_PREFIX = "rad-"


def is_radiation_only(row: dict) -> bool:
    return str(row.get("device_id") or "").startswith(RADIATION_PREFIX)


def real_rows(astronaut_id: str | None, window_s: float, kind: str = "node") -> list[dict]:
    """Filas reales (Supabase + POST local) de los últimos `window_s` s, ordenadas por tiempo.

    kind="node": solo el ESP32 (lo normal) · "phone": solo el celular · "all": todas.
    """
    since = time.time() - window_s
    rows = [r for r in supabase_store.recent_rows(astronaut_id, window_s) if r["_ts"] >= since]
    for key, packets in local_packets.items():
        if astronaut_id in (None, key):
            rows.extend(p for p in packets if p["_ts"] >= since)
    if kind == "node":
        rows = [r for r in rows if not is_phone(r) and not is_radiation_only(r)]
    elif kind == "phone":
        rows = [r for r in rows if is_phone(r)]
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


def timeline(astronaut_id: str, limit: int) -> list[dict]:
    """Una muestra por segundo de los últimos `limit` segundos.

    En cada segundo se usa la última fila real si el hardware estaba 'vivo' en ese
    momento (llegó algo en los LIVE_WINDOW_S previos); si no, la simulación de ese segundo.
    """
    rows = real_rows(astronaut_id, ASTRONAUT_WINDOW_S)
    end = floor(time.time())
    return [public(row) if row else simulated_sample(astronaut_id, end - limit + 1 + i)
            for i, row in enumerate(live_per_second(rows, limit))]


def live_per_second(rows: list[dict], limit: int) -> list[dict | None]:
    """Para cada uno de los últimos `limit` segundos: la última fila 'viva' en ese momento, o None."""
    end = floor(time.time())
    items: list[dict | None] = []
    index = -1
    for second in range(end - limit + 1, end + 1):
        while index + 1 < len(rows) and rows[index + 1]["_ts"] < second + 1:
            index += 1
        live = index >= 0 and second + 1 - rows[index]["_ts"] <= LIVE_WINDOW_S
        items.append(rows[index] if live else None)
    return items


def safe_baseline(samples: list[dict]) -> dict:
    """La línea base nunca debe tumbar la API: si algo falla, queda 'calibrando'."""
    try:
        return analysis.baseline(samples)
    except Exception:  # noqa: BLE001
        return {"source": None, "window_s": analysis.BASELINE_WINDOW_S, "level": "calibrating", "signals": {}}


def crew_summary(sample: dict, base: dict) -> dict:
    heart = sample.get("heart_rate_bpm")
    respiration = sample.get("respiration_rate_bpm")
    movement = min(100, max(0, int((sample.get("steps") or 0) % 101)))
    if sample["source"] == "simulation":
        movement = int(ASTRONAUTS[sample["astronaut_id"]]["movement"])
    signals = list(base.get("signals", {}).values())
    observe = base.get("level") in ("observe", "alert", "unreliable")
    z_total = sum(abs(s["z"]) for s in signals if s.get("z") is not None)
    recovery = max(45, min(98, round(96 - 8 * z_total)))
    return {
        "astronaut_id": sample["astronaut_id"],
        "source": sample["source"],
        "heart_rate_bpm": heart,
        "respiration_rate_bpm": respiration,
        "movement_score": movement,
        "recovery_score": recovery,
        "status": "Observe" if observe else "Stable",
        "level": base.get("level"),
        "reasons": [s["message"] for s in signals if s.get("level") in ("observe", "alert", "unreliable")],
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
        "live_window_s": LIVE_WINDOW_S,
        **supabase_store.status,
    }


@app.get("/api/state")
def state(astronaut_id: AstronautId = "bresnik") -> dict:
    return current_sample(astronaut_id)


@app.get("/api/history")
def get_history(astronaut_id: AstronautId = "bresnik", limit: int = 120) -> dict:
    limit = max(1, min(limit, MAX_HISTORY))
    samples = timeline(astronaut_id, analysis.BASELINE_WINDOW_S)
    return {"astronaut_id": astronaut_id, "items": samples[-limit:], "baseline": safe_baseline(samples)}


@app.get("/api/baseline")
def get_baseline(astronaut_id: AstronautId = "bresnik") -> dict:
    return safe_baseline(timeline(astronaut_id, analysis.BASELINE_WINDOW_S))


@app.get("/api/crew")
def get_crew() -> dict:
    items = []
    for astronaut_id in ASTRONAUTS:
        samples = timeline(astronaut_id, analysis.BASELINE_WINDOW_S)
        items.append(crew_summary(samples[-1], safe_baseline(samples)))
    return {"items": items}


# --------------------------------------------------------------------------- #
# Chequeo diario manual y signos vitales periódicos
# --------------------------------------------------------------------------- #
def checkins_for(astronaut_id: str, days: float) -> tuple[list[dict], str]:
    """Chequeos de los últimos `days` días (más nuevo primero) y dónde están guardados."""
    since = time.time() - days * 86400
    rows = supabase_store.list_checkins(astronaut_id, since)
    if rows is not None:
        return rows, "supabase"
    local = [r for r in local_checkins[astronaut_id] if supabase_store.parse_ts(r["created_at"]) >= since]
    return sorted(local, key=lambda r: r["created_at"], reverse=True), "memory"


@app.post("/api/checkin")
def post_checkin(body: CheckinIn) -> dict:
    row = body.model_dump()
    if body.notes is not None:
        row["notes"] = body.notes.strip() or None
    saved = supabase_store.insert_checkin(row)
    if saved is not None:
        return {"saved": True, "storage": "supabase", "item": saved}
    row["created_at"] = datetime.now(timezone.utc).isoformat()
    local_checkins[body.astronaut_id].append(row)
    return {"saved": True, "storage": "memory", "item": row}


@app.get("/api/checkins")
def get_checkins(astronaut_id: AstronautId = "bresnik", days: float = 7) -> dict:
    items, storage = checkins_for(astronaut_id, max(0.1, min(days, 60)))
    return {"astronaut_id": astronaut_id, "storage": storage, "items": items}


@app.get("/api/vitals")
def get_vitals(astronaut_id: AstronautId = "bresnik") -> dict:
    """Presión y temperatura: del ESP32 si las envía; si no, simuladas cada 30 min. Más lo anotado a mano."""
    simulated = current_sample(astronaut_id)["source"] == "simulation"
    return vitals_for(astronaut_id, checkins_for(astronaut_id, 1)[0], simulated)


def vitals_for(astronaut_id: str, manual: list[dict], simulated: bool = True) -> dict:
    now = time.time()
    items = analysis.simulated_vitals(astronaut_id, now)
    since = items[0]["ts"]
    name, started, k = ctx.scenario(astronaut_id, now)
    if simulated and name == "fever" and k > 0:
        # Escenario fiebre: la medición automática de control marca la temperatura alta.
        base = analysis.VITALS_BASE[astronaut_id]
        items.append(analysis.vitals_item(max(started, now - 5), "simulation", base["sys"] + round(6 * k),
                                          base["dia"] + round(3 * k), round(base["temp"] + 2.0 * k, 1)))
    for row in manual:
        if row.get("systolic_mmhg") is None and row.get("temperature_c") is None:
            continue
        ts = supabase_store.parse_ts(row["created_at"])
        if ts >= since:
            items.append(analysis.vitals_item(ts, "manual", row.get("systolic_mmhg"), row.get("diastolic_mmhg"), row.get("temperature_c")))
    items.extend(hardware_vitals(astronaut_id))
    items.sort(key=lambda r: r["ts"])
    latest_bp = next((r for r in reversed(items) if r["systolic_mmhg"] is not None), None)
    latest_temp = next((r for r in reversed(items) if r["temperature_c"] is not None), None)
    return {
        "astronaut_id": astronaut_id,
        "interval_min": analysis.VITALS_INTERVAL_S // 60,
        "next_ts": (int(now // analysis.VITALS_INTERVAL_S) + 1) * analysis.VITALS_INTERVAL_S,
        "latest_bp": latest_bp,
        "latest_temp": latest_temp,
        "items": items,
    }


HARDWARE_VITALS_STEP_S = 60  # en el gráfico, una lectura del ESP32 por minuto


def hardware_vitals(astronaut_id: str) -> list[dict]:
    """Temperatura y presión que llegaron del ESP32 en los últimos ~10 min (una por minuto + la última).

    Si el ESP32 deja de enviarlas, al pasar esa ventana se vuelve a la medición simulada.
    """
    rows = [r for r in real_rows(astronaut_id, ASTRONAUT_WINDOW_S)
            if r.get("temperature_c") is not None or r.get("blood_pressure_systolic_mmhg") is not None]
    picked: dict[int, dict] = {}
    for row in rows:  # de la más antigua a la más nueva: queda la última de cada minuto
        picked[int(row["_ts"] // HARDWARE_VITALS_STEP_S)] = row
    out = []
    for row in picked.values():
        sys_, dia = row.get("blood_pressure_systolic_mmhg"), row.get("blood_pressure_diastolic_mmhg")
        temp = row.get("temperature_c")
        out.append(analysis.vitals_item(row["_ts"], "hardware",
                                        round(float(sys_)) if sys_ is not None else None,
                                        round(float(dia)) if dia is not None else None,
                                        round(float(temp), 1) if temp is not None else None))
    return out


# --------------------------------------------------------------------------- #
# Alertas (nivel 1/2/3) y reportes para los médicos en Tierra
# --------------------------------------------------------------------------- #
def assess(astronaut_id: str) -> dict:
    """Junta todo lo de un astronauta: línea base, vitales, chequeos, alertas y reporte."""
    samples = timeline(astronaut_id, analysis.BASELINE_WINDOW_S)
    base = safe_baseline(samples)
    checkins, _ = checkins_for(astronaut_id, 1)
    simulated = samples[-1].get("source") == "simulation"
    name, started, _ = ctx.scenario(astronaut_id)
    if simulated and name in SCENARIO_CHECKINS:
        virtual = {"astronaut_id": astronaut_id, "created_at": datetime.fromtimestamp(started, timezone.utc).isoformat(),
                   "source": "demo", **SCENARIO_CHECKINS[name]}
        checkins = [virtual, *checkins]
    vitals = vitals_for(astronaut_id, checkins, simulated)
    try:
        items = alerts.evaluate(base, samples[-1], vitals, checkins)
    except Exception:  # noqa: BLE001  (una regla rota no debe tumbar el panel)
        items = []
    report = alerts.build_report(astronaut_id, base, samples[-1], vitals, checkins, items, samples)
    return {"alerts": items, "report": report, "sample": samples[-1]}


@app.get("/api/alerts")
def get_alerts(astronaut_id: AstronautId = "bresnik") -> dict:
    items = assess(astronaut_id)["alerts"]
    return {"astronaut_id": astronaut_id, "max_level": max((a["level"] for a in items), default=0), "items": items}


@app.get("/api/report")
def get_report(astronaut_id: AstronautId = "bresnik") -> dict:
    return assess(astronaut_id)["report"]


@app.get("/api/mission-report")
def get_mission_report() -> dict:
    return {"generated_ts": time.time(), "items": [assess(a)["report"] for a in ASTRONAUTS]}


@app.post("/api/telemetry")
def telemetry(packet: TelemetryIn) -> dict:
    astronaut_id = packet.astronaut_id
    now = time.time()
    payload = packet.model_dump()
    payload.update(source="hardware", received_at=datetime.fromtimestamp(now, timezone.utc).isoformat(), _ts=now)
    local_packets[astronaut_id].append(payload)
    return {"accepted": True, "astronaut_id": astronaut_id, "samples": len(local_packets[astronaut_id])}


# Más lejos que esto, la posición del MPU6050 se da por "desbocada" (deriva de la integración)
# y se usa la otra fuente. El cable de seguridad de referencia mide 25 m.
MPU_MAX_DISTANCE_M = 40.0
POSITION_ORDER = {"mpu": ("mpu", "phone"), "phone": ("phone", "mpu"), "sim": ()}


def _mpu_status(row: dict | None) -> str:
    if row is None:
        return "no_data"
    if row.get("pos_x_m") is None or row.get("pos_y_m") is None:
        return "no_position"
    distance = sqrt(float(row["pos_x_m"]) ** 2 + float(row["pos_y_m"]) ** 2 + float(row.get("pos_z_m") or 0) ** 2)
    return "unreliable" if distance > MPU_MAX_DISTANCE_M else "ok"


@app.get("/api/position")
def get_position(astronaut_id: AstronautId = "bresnik", limit: int = 120, demo: bool = False,
                 prefer: Literal["mpu", "phone", "sim"] = "mpu") -> dict:
    """Posición XYZ (m) respecto a la cápsula, distancia y estela para la vista 3D.

    Fuente: `prefer` elige la preferida (MPU6050 del ESP32 o celular). Si la preferida no
    tiene datos (o el MPU está desbocado), se usa la otra; si ninguna sirve, la simulación.
    """
    limit = max(10, min(limit, MAX_HISTORY))
    if demo:
        prefer = "sim"
    window = limit + LIVE_WINDOW_S + 2
    return position_for(astronaut_id, limit, prefer, real_rows(astronaut_id, window, "all"))


@app.get("/api/crew-positions")
def get_crew_positions(prefer: Literal["mpu", "phone", "sim"] = "mpu", limit: int = 30) -> dict:
    """Posición de los 4 tripulantes a la vez (una sola consulta a Supabase) para la vista 3D."""
    limit = max(10, min(limit, MAX_HISTORY))
    rows = real_rows(None, limit + LIVE_WINDOW_S + 2, "all")
    items = []
    for astronaut_id in ASTRONAUTS:
        mine = [r for r in rows if r.get("astronaut_id") == astronaut_id]
        pos = position_for(astronaut_id, limit, prefer, mine)
        pos["trail"] = pos["trail"][-limit:]
        items.append(pos)
    return {"prefer": prefer, "items": items}


def position_for(astronaut_id: str, limit: int, prefer: str, rows: list[dict]) -> dict:
    """Elige, segundo a segundo, la fuente de posición (MPU / celular / simulación) de un astronauta."""
    mpu_rows = live_per_second([r for r in rows if not is_phone(r) and not is_radiation_only(r)], limit)
    phone_rows = live_per_second([r for r in rows if is_phone(r)], limit)
    samples = []
    for mpu, phone in zip(mpu_rows, phone_rows):
        chosen = {"source": "simulation"}
        for name in POSITION_ORDER[prefer]:
            if name == "mpu" and _mpu_status(mpu) == "ok":
                chosen = {**public(mpu), "source": "hardware"}
                break
            if name == "phone" and phone is not None:
                chosen = {**public(phone), "source": "phone"}
                break
        samples.append(chosen)
    track = analysis.position_track(samples, ASTRONAUTS[astronaut_id]["phase"], prefer == "sim",
                                    lambda ts: sim_position(astronaut_id, ts))
    status = {"mpu": _mpu_status(mpu_rows[-1]), "phone": "ok" if phone_rows[-1] is not None else "no_data"}
    used = {"hardware": "mpu", "phone": "phone"}.get(track["source"], "sim")
    return {"astronaut_id": astronaut_id, "demo": prefer == "sim", "prefer": prefer, "used": used,
            "fallback": used != prefer, "sensors": status, "steps": samples[-1].get("steps") if used == "phone" else None,
            **track}


@app.post("/api/phone-position")
def post_phone_position(body: PhoneIn) -> dict:
    """El celular (modo muñeca) envía su posición de pasos + brújula una vez por segundo."""
    now = time.time()
    distance = round(sqrt(body.x_m ** 2 + body.y_m ** 2), 2)
    row = {
        "astronaut_id": body.astronaut_id, "device_id": f"{PHONE_PREFIX}{body.astronaut_id}",
        # Sin ECG: el celular solo aporta posición (estas filas nunca se usan para signos vitales).
        "ecg_raw": 0, "leads_off": True, "resp_raw": 0,
        "pos_x_m": round(body.x_m, 2), "pos_y_m": round(body.y_m, 2), "pos_z_m": 0,
        "distance_from_origin_m": distance, "outside_safe_radius": distance > analysis.CABIN_RANGE_M,
        "steps": body.steps, "battery_pct": body.battery_pct if body.battery_pct is not None else 100,
        "timestamp_ms": body.timestamp_ms,
    }
    if supabase_store.insert_telemetry(row):
        return {"saved": True, "storage": "supabase"}
    local_packets[body.astronaut_id].append(
        {**row, "source": "hardware", "received_at": datetime.fromtimestamp(now, timezone.utc).isoformat(), "_ts": now})
    return {"saved": True, "storage": "memory"}


# --------------------------------------------------------------------------- #
# Escenarios de demostración (solo afectan a la SIMULACIÓN)
# --------------------------------------------------------------------------- #
def demo_state(items: dict[str, tuple[str, float]]) -> dict:
    now = time.time()
    out = []
    for astronaut_id, (name, started) in items.items():
        if astronaut_id not in ASTRONAUTS:
            continue
        live = current_sample(astronaut_id)["source"] == "hardware"
        out.append({"astronaut_id": astronaut_id, "scenario": name, "started": started,
                    "intensity": round(min(1.0, max(0.0, (now - started) / ctx.RAMP_S)), 2), "live_hardware": live})
    return {"items": out, "available": list(ctx.SCENARIO_IDS), "ramp_s": ctx.RAMP_S}


@app.get("/api/demo")
def get_demo() -> dict:
    return demo_state(ctx.SCENARIOS.get())


@app.post("/api/demo")
def post_demo(body: DemoIn, request: Request, response: Response) -> dict:
    items = dict(ctx.SCENARIOS.get())
    if body.astronaut_id is None:
        items = {}
    elif body.scenario is None:
        items.pop(body.astronaut_id, None)
    else:
        items[body.astronaut_id] = (body.scenario, time.time())
    https = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    if items:
        response.set_cookie(ctx.DEMO_COOKIE, ctx.dump_scenarios(items), max_age=ctx.SCENARIO_MAX_AGE_S,
                            httponly=True, secure=https, samesite="lax", path="/")
    else:
        response.delete_cookie(ctx.DEMO_COOKIE, path="/")
    ctx.SCENARIOS.set(items)
    return demo_state(items)


# --------------------------------------------------------------------------- #
# Radiación de la nave (vista EVA)
# --------------------------------------------------------------------------- #
# Una lectura (del ESP32 o insertada a mano en Supabase) sigue vigente RADIATION_LIVE_S;
# si no llega ninguna, se usa la radiación simulada.
RADIATION_LIVE_S = 120
RADIATION_HISTORY_S = 300
# Máximo permitido que definió el equipo (Ricardo): 0,017 mSv/h = 17 µSv/h; lo ideal es 0.
# Niveles relativos a ese máximo (simples y explicables):
#   < 50 % del máximo = nominal · 50–100 % = elevada · > máximo = alta · > 5× máximo = tormenta.
RADIATION_MAX_USVH = 17.0
RADIATION_LEVELS = (
    (RADIATION_MAX_USVH * 0.5, "nominal", 0, "Muy por debajo del máximo (17 µSv/h). Sin acción."),
    (RADIATION_MAX_USVH, "elevada", 1, "Cerca del máximo: limitar el tiempo de EVA y vigilar la tendencia."),
    (RADIATION_MAX_USVH * 5, "alta", 2, "Sobre el máximo permitido: terminar la EVA y volver a la cápsula."),
    (float("inf"), "tormenta", 3, "Más de 5 veces el máximo: toda la tripulación al refugio blindado de la nave."),
)
STORM_DOSE_RATE_USVH = 150.0


def radiation_level(rate: float) -> tuple[str, int, str]:
    for limit, name, level, action in RADIATION_LEVELS:
        if rate <= limit:
            return name, level, action
    return RADIATION_LEVELS[-1][1:]


def simulated_radiation(ts: float) -> float:
    """Radiación simulada de fondo (~3 µSv/h, lejos del máximo); el escenario `solar_storm` la sube en 30 s."""
    t = ts % 86400
    base = max(0.0, 3 + 0.8 * sin(t / 40) + _noise(t, 11, 0.3))
    k = max((ctx.scenario(a, ts)[2] for a in ASTRONAUTS if ctx.scenario(a, ts)[0] == "solar_storm"), default=0.0)
    return round(base + k * (STORM_DOSE_RATE_USVH - base), 2)


@app.get("/api/radiation")
def get_radiation() -> dict:
    """Tasa de dosis de radiación en la nave: última lectura real o simulación, con nivel y acción."""
    now = time.time()
    rows = [r for r in real_rows(None, RADIATION_HISTORY_S, "all") if r.get("radiation_dose_rate_usvh") is not None]
    live = bool(rows) and now - rows[-1]["_ts"] < RADIATION_LIVE_S
    if live:
        last = rows[-1]
        rate = float(last["radiation_dose_rate_usvh"])
        history = [[round(r["_ts"] - now, 1), float(r["radiation_dose_rate_usvh"])] for r in rows]
        source, device, age = "sensor", last.get("device_id"), round(now - last["_ts"], 1)
    else:
        rate = simulated_radiation(now)
        history = [[-float(s), simulated_radiation(now - s)] for s in range(RADIATION_HISTORY_S, -1, -5)]
        source, device, age = "simulation", None, 0.0
    name, level, action = radiation_level(rate)
    return {
        "dose_rate_usvh": rate, "level": level, "level_name": name, "action": action,
        "source": source, "device_id": device, "age_s": age, "live_window_s": RADIATION_LIVE_S,
        "thresholds_usvh": [limit for limit, *_ in RADIATION_LEVELS[:-1]], "max_usvh": RADIATION_MAX_USVH,
        "history": history,
    }
