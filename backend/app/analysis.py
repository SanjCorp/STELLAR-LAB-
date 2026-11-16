"""Análisis explicable de STELLAR: línea base individual y signos vitales periódicos.

Línea base (punto 1 del plan)
-----------------------------
Para cada astronauta y cada señal (pulso, respiración):
  * "Tu normal" = MEDIANA de tus lecturas de los últimos 10 minutos, sin contar
    el último minuto (para que un cambio reciente no se esconda dentro de la base).
  * "Tu variación" = desviación robusta (1,4826 × MAD), con un mínimo fijo para
    no exagerar cambios diminutos cuando la señal es muy estable.
  * "Ahora" = mediana de los últimos 15 s (suaviza latidos sueltos).
  * z = (ahora − normal) / variación.  |z| < 2 normal · 2–3 observar · ≥ 3 alerta.
Solo se comparan lecturas de la misma fuente (ESP32 con ESP32, simulación con
simulación) y se descartan las que tienen electrodos sueltos.

Presión y temperatura (punto 2 del plan)
----------------------------------------
No hay sensor: se SIMULA una medición automática cada 30 min (siempre marcada
como "simulation"). Si el astronauta anota una medición a mano en su chequeo,
esa lectura "manual" aparece junto a las simuladas.

Es estadística simple y transparente. NO es un dispositivo médico.
"""

from __future__ import annotations

from math import cos, floor, pi, sin, sqrt
from statistics import median

from .ctx import tr

BASELINE_WINDOW_S = 600   # 10 minutos de referencia
EXCLUDE_RECENT_S = 60     # el último minuto no entra en la base
CURRENT_WINDOW_S = 15     # "ahora" = mediana de los últimos 15 s
MIN_SAMPLES = 30          # menos que esto: "calibrando"

SIGNALS = {
    "heart_rate_bpm": {"label": ("Pulso", "Heart rate"), "unit": ("lpm", "bpm"), "min_sd": 3.0},
    "respiration_rate_bpm": {"label": ("Respiración", "Breathing"), "unit": ("rpm", "br/min"), "min_sd": 1.0},
}
LEVEL_ORDER = {"calibrating": 0, "normal": 1, "unreliable": 2, "observe": 3, "alert": 4}

# Límites de SEGURIDAD generales (en reposo), independientes de la línea base personal.
# La base aprende "tu normal", pero si el sensor o la persona pasan mucho tiempo en valores
# anormales, la base también se vuelve anormal; estos límites evitan que eso esconda una alerta.
# Referencias generales: pulso en reposo 50–100 lpm; respiración 10–24 rpm.
SAFETY = {
    "heart_rate_bpm": {"observe": (50.0, 100.0), "alert": (40.0, 130.0)},
    "respiration_rate_bpm": {"observe": (10.0, 24.0), "alert": (8.0, 30.0)},
}


def _safety(key: str, value: float) -> tuple[str, str | None]:
    """(nivel, "high"/"low"/None) de un valor frente a los límites de seguridad."""
    obs_lo, obs_hi = SAFETY[key]["observe"]
    al_lo, al_hi = SAFETY[key]["alert"]
    if value > al_hi or value < al_lo:
        return "alert", "high" if value > al_hi else "low"
    if value > obs_hi or value < obs_lo:
        return "observe", "high" if value > obs_hi else "low"
    return "normal", None


def _apply_safety(result: dict, samples: list[dict], key: str, source: str, current: float | None, meta: dict) -> dict:
    """Si el valor actual sale de los límites de seguridad, sube el nivel y lo explica."""
    result.update(absolute=None, safe_low=SAFETY[key]["observe"][0], safe_high=SAFETY[key]["observe"][1])
    if current is None:
        return result
    level, side = _safety(key, current)
    if side is None:
        return result
    lo, hi = SAFETY[key]["observe"]
    seconds = 0  # segundos seguidos fuera del rango de seguridad, del mismo lado
    for s in reversed(samples):
        v = s.get(key)
        if s.get("source") != source or s.get("leads_off") or not isinstance(v, (int, float)):
            break
        if not ((side == "high" and v > hi) or (side == "low" and v < lo)):
            break
        seconds += 1
    unit, label = meta["unit"], meta["label"]
    since = tr(f" desde hace {duration_text(seconds)}", f" for {duration_text(seconds)}") if seconds >= 10 else ""
    note = tr(f"{label} {current:.0f} {unit}: fuera del rango de seguridad general ({lo:.0f}–{hi:.0f} {unit} en reposo){since}.",
              f"{label} {current:.0f} {unit}: outside the general safety range ({lo:.0f}–{hi:.0f} {unit} at rest){since}.")
    center = result.get("center")
    if center is not None and not (lo <= center <= hi):
        note += tr(f" Tu línea base ({center:.0f} {unit}) también es inusual: revisa el sensor.",
                   f" Your baseline ({center:.0f} {unit}) is also unusual: check the sensor.")
    worse = LEVEL_ORDER[level] > LEVEL_ORDER.get(result["level"], 0)
    result.update(absolute=side, safety_level=level,
                  level=level if worse else result["level"],
                  duration_s=max(result.get("duration_s") or 0, seconds),
                  current=round(current, 1),
                  message=note if result["level"] in ("normal", "calibrating") else f"{result['message']} {note}")
    return result


def duration_text(seconds: int) -> str:
    return f"{seconds} s" if seconds < 90 else f"{round(seconds / 60)} min"


def _valid_values(samples: list[dict], key: str, source: str) -> list[float]:
    return [
        float(s[key])
        for s in samples
        if s.get("source") == source and not s.get("leads_off") and isinstance(s.get(key), (int, float))
    ]


def signal_baseline(samples: list[dict], key: str) -> dict:
    """`samples`: una muestra por segundo, de la más antigua a la más nueva."""
    raw = SIGNALS[key]
    meta = {"label": tr(*raw["label"]), "unit": tr(*raw["unit"]), "min_sd": raw["min_sd"]}
    low_label = meta["label"].lower()
    result = {"label": meta["label"], "unit": meta["unit"], "level": "calibrating", "n": 0,
              "center": None, "sd": None, "low": None, "high": None, "current": None, "z": None,
              "delta": None, "message": tr(f"Calibrando tu línea base de {low_label}…", f"Calibrating your {low_label} baseline…")}
    if not samples:
        return result

    last = samples[-1]
    source = last.get("source", "simulation")
    recent = _valid_values(samples[-CURRENT_WINDOW_S:], key, source)
    reference = _valid_values(samples[:-EXCLUDE_RECENT_S], key, source)
    if len(reference) < MIN_SAMPLES:
        # Recién conectado: usamos todo menos los últimos 15 s mientras calibra.
        reference = _valid_values(samples[:-CURRENT_WINDOW_S], key, source)
    result["n"] = len(reference)

    if last.get("leads_off"):
        result.update(level="unreliable", message=tr("Lectura poco confiable: revisa los electrodos.", "Unreliable reading: check the electrodes."))
        return result
    if not reference and not recent:
        result["message"] = tr(f"Sin lectura confiable de {low_label} en este momento.", f"No reliable {low_label} reading right now.")
        return result
    if len(reference) < MIN_SAMPLES or not recent:
        result["message"] = tr(f"Calibrando tu línea base de {low_label} ({len(reference)}/{MIN_SAMPLES} lecturas).",
                               f"Calibrating your {low_label} baseline ({len(reference)}/{MIN_SAMPLES} readings).")
        # Aunque la base no esté lista, un valor fuera de los límites de seguridad sí se avisa.
        return _apply_safety(result, samples, key, source, median(recent) if recent else None, meta)

    center = median(reference)
    mad = median(abs(v - center) for v in reference)
    sd = max(meta["min_sd"], 1.4826 * mad)
    current = median(recent)
    z = (current - center) / sd
    delta = current - center
    level = "normal" if abs(z) < 2 else "observe" if abs(z) < 3 else "alert"
    # ¿Cuánto tiempo seguido lleva fuera de la banda normal? (para explicar "desde hace 2 min")
    duration_s = 0
    for s in reversed(samples):
        value = s.get(key)
        if s.get("source") != source or s.get("leads_off") or not isinstance(value, (int, float)):
            break
        if abs(value - center) < 2 * sd or (value - center) * delta < 0:
            break
        duration_s += 1
    if level == "normal":
        rng = f"{center - 2 * sd:.0f}–{center + 2 * sd:.0f} {meta['unit']}"
        message = tr(f"{meta['label']} dentro de tu rango normal ({rng}).", f"{meta['label']} within your normal range ({rng}).")
    else:
        since = tr(f" desde hace {duration_text(duration_s)}", f" for {duration_text(duration_s)}") if duration_s >= 10 else ""
        message = tr(f"{meta['label']} {abs(delta):.0f} {meta['unit']} {'sobre' if delta > 0 else 'bajo'} tu base ({center:.0f} {meta['unit']}){since}.",
                     f"{meta['label']} {abs(delta):.0f} {meta['unit']} {'above' if delta > 0 else 'below'} your baseline ({center:.0f} {meta['unit']}){since}.")
    result.update(level=level, center=round(center, 1), sd=round(sd, 2), low=round(center - 2 * sd, 1),
                  high=round(center + 2 * sd, 1), current=round(current, 1), z=round(z, 2),
                  delta=round(delta, 1), duration_s=duration_s, message=message)
    return _apply_safety(result, samples, key, source, current, meta)


def baseline(samples: list[dict]) -> dict:
    signals = {key: signal_baseline(samples, key) for key in SIGNALS}
    worst = max((s["level"] for s in signals.values()), key=LEVEL_ORDER.__getitem__)
    return {
        "source": samples[-1].get("source") if samples else None,
        "window_s": BASELINE_WINDOW_S,
        "method": tr("Mediana de tus últimos 10 min (sin el último minuto) ± 2 desviaciones robustas",
                     "Median of your last 10 min (excluding the last minute) ± 2 robust deviations"),
        "level": worst,
        "signals": signals,
    }


# --------------------------------------------------------------------------- #
# Presión arterial y temperatura simuladas (una medición cada 30 min)
# --------------------------------------------------------------------------- #
VITALS_INTERVAL_S = 30 * 60
VITALS_BASE = {
    "bresnik": {"sys": 118, "dia": 76, "temp": 36.6, "seed": 1.0},
    "parmitano": {"sys": 114, "dia": 73, "temp": 36.5, "seed": 2.0},
    "douglas": {"sys": 124, "dia": 80, "temp": 36.7, "seed": 3.0},
    "rubio": {"sys": 116, "dia": 75, "temp": 36.6, "seed": 4.0},
}


def _noise(slot: float, seed: float, amplitude: float) -> float:
    x = sin(slot * 12.9898 + seed * 78.233) * 43758.5453
    return (x - floor(x) - 0.5) * 2 * amplitude


def blood_pressure_label(sys: float, dia: float) -> str:
    if sys >= 140 or dia >= 90:
        return "alta"
    if sys >= 130 or dia >= 80:
        return "elevada"
    if sys < 90 or dia < 60:
        return "baja"
    return "normal"


def temperature_label(temp: float) -> str:
    if temp >= 38.0:
        return "fiebre"
    if temp >= 37.3:
        return "elevada"
    if temp < 35.5:
        return "baja"
    return "normal"


def simulated_vitals(astronaut_id: str, now: float, count: int = 12) -> list[dict]:
    base = VITALS_BASE[astronaut_id]
    last_slot = int(now // VITALS_INTERVAL_S)
    items = []
    for slot in range(last_slot - count + 1, last_slot + 1):
        sys_ = round(base["sys"] + 3 * sin(slot * 0.7 + base["seed"]) + _noise(slot, base["seed"], 3))
        dia = round(base["dia"] + 2 * sin(slot * 0.7 + base["seed"]) + _noise(slot, base["seed"] + 5, 2))
        temp = round(base["temp"] + 0.15 * sin(slot * 0.4 + base["seed"]) + _noise(slot, base["seed"] + 9, 0.1), 1)
        items.append(vitals_item(slot * VITALS_INTERVAL_S, "simulation", sys_, dia, temp))
    return items


def vitals_item(ts: float, source: str, sys_: float | None, dia: float | None, temp: float | None) -> dict:
    return {
        "ts": ts,
        "source": source,
        "systolic_mmhg": sys_,
        "diastolic_mmhg": dia,
        "temperature_c": temp,
        "bp_label": blood_pressure_label(sys_, dia) if sys_ is not None and dia is not None else None,
        "temp_label": temperature_label(temp) if temp is not None else None,
    }


# --------------------------------------------------------------------------- #
# Posición respecto a la estación (punto 0) para la vista 3D (punto 5 del plan)
# --------------------------------------------------------------------------- #
EVA_PERIOD_S = 600        # una salida simulada completa (ida y vuelta) cada 10 min
SAFE_DISTANCE_M = 15      # zona cercana
TETHER_LIMIT_M = 25       # largo del cable de seguridad (referencia de la demo)
CABIN_RANGE_M = 2         # dentro de la cápsula: a 2 m o menos del punto 0 (igual que el firmware)


def eva_position(phase: float, ts: float) -> tuple[float, float, float]:
    """Trayectoria SIMULADA de una caminata espacial (EVA): sale de la escotilla,
    se aleja hasta ~22 m y vuelve. Siempre da lo mismo para el mismo instante."""
    u = (ts % EVA_PERIOD_S) / EVA_PERIOD_S
    r = 0.4 + 21.6 * sin(pi * u) ** 2  # empieza dentro de la cápsula y sale por la escotilla
    angle = phase + 0.9 * sin(2 * pi * u)
    x = r * cos(angle)
    y = r * sin(angle)
    z = (2.5 * sin(4 * pi * u + phase) + 0.15 * r) * min(1.0, r / 4)
    return round(x, 2), round(y, 2), round(z, 2)


def in_cabin(x: float, y: float, z: float, outside_flag: bool | None = None) -> bool:
    """Dentro de la cápsula = a 2 m o menos del punto 0. Si el ESP32 ya lo calculó
    (`outside_safe_radius`), se usa su respuesta para que app y nodo digan lo mismo."""
    if outside_flag is not None:
        return not outside_flag
    return sqrt(x * x + y * y + z * z) <= CABIN_RANGE_M


def distance_zone(distance: float, inside: bool = False) -> str:
    if inside:
        return "cabina"
    if distance <= SAFE_DISTANCE_M:
        return "cerca"
    if distance <= TETHER_LIMIT_M:
        return "atencion"
    return "fuera"


def position_track(samples: list[dict], phase: float, demo: bool, sim_fn=None) -> dict:
    """Posición actual + estela. Usa la posición del ESP32 si la envía; si no (o en modo
    demo), la trayectoria simulada. Siempre dice de dónde sale el dato."""
    import time
    points = []
    end = floor(time.time())
    for i, s in enumerate(samples):
        real = s.get("source") in ("hardware", "phone") and s.get("pos_x_m") is not None and s.get("pos_y_m") is not None
        if real and not demo:
            x, y, z, src = float(s["pos_x_m"]), float(s["pos_y_m"]), float(s.get("pos_z_m") or 0), s["source"]
        else:
            ts = end - (len(samples) - 1 - i)  # un punto por segundo
            x, y, z = sim_fn(ts) if sim_fn else eva_position(phase, ts)
            src = "simulation"
        flag = s.get("outside_safe_radius") if src != "simulation" else None
        points.append({"x": x, "y": y, "z": z, "source": src, "outside": flag})
    last = points[-1] if points else {"x": 0, "y": 0, "z": 0, "source": "simulation"}
    distance = sqrt(last["x"] ** 2 + last["y"] ** 2 + last["z"] ** 2)
    speed = None
    if len(points) >= 6:
        a = points[-6]
        speed = sqrt((last["x"] - a["x"]) ** 2 + (last["y"] - a["y"]) ** 2 + (last["z"] - a["z"]) ** 2) / 5
    return {
        "source": last["source"],
        "x": last["x"], "y": last["y"], "z": last["z"],
        "distance_m": round(distance, 2),
        "speed_m_s": round(speed, 2) if speed is not None else None,
        "max_distance_m": round(max((sqrt(p["x"] ** 2 + p["y"] ** 2 + p["z"] ** 2) for p in points), default=0), 2),
        "zone": distance_zone(distance, in_cabin(last["x"], last["y"], last["z"], last.get("outside"))),
        "cabin_m": CABIN_RANGE_M,
        "safe_m": SAFE_DISTANCE_M,
        "tether_m": TETHER_LIMIT_M,
        "trail": [[p["x"], p["y"], p["z"]] for p in points],
    }
