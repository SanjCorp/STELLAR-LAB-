"""Contexto de cada petición: idioma (es/en) y escenarios de demostración.

* Idioma: el frontend envía el encabezado `X-Stellar-Lang: es|en`. Los textos que arma el
  backend (alertas, línea base, reportes) usan `tr("texto en español", "English text")`.
* Escenarios de demo: se guardan en la cookie `stellar_demo` del navegador que hace la demo
  (no en la base de datos), así funcionan igual en local y en Vercel. SOLO modifican la
  SIMULACIÓN: las filas reales del ESP32 nunca se alteran.
"""

from __future__ import annotations

import time
from contextvars import ContextVar

LANG: ContextVar[str] = ContextVar("lang", default="es")
SCENARIOS: ContextVar[dict[str, tuple[str, float]]] = ContextVar("scenarios", default={})

DEMO_COOKIE = "stellar_demo"
SCENARIO_IDS = ("fatigue", "stress", "fever", "leads_off", "eva_far", "solar_storm")
SCENARIO_MAX_AGE_S = 2 * 3600  # un escenario olvidado se apaga solo a las 2 h
RAMP_S = 30  # el cambio aparece de forma gradual en 30 s


def tr(es: str, en: str) -> str:
    return en if LANG.get() == "en" else es


def parse_lang(value: str | None) -> str:
    return "en" if (value or "").lower().startswith("en") else "es"


def parse_scenarios(raw: str | None) -> dict[str, tuple[str, float]]:
    """Cookie: `bresnik:fever:1794700000|rubio:stress:1794700100`."""
    out: dict[str, tuple[str, float]] = {}
    now = time.time()
    for part in (raw or "").split("|"):
        bits = part.split(":")
        if len(bits) != 3 or bits[1] not in SCENARIO_IDS:
            continue
        try:
            started = float(bits[2])
        except ValueError:
            continue
        if 0 <= now - started <= SCENARIO_MAX_AGE_S:
            out[bits[0]] = (bits[1], started)
    return out


def dump_scenarios(items: dict[str, tuple[str, float]]) -> str:
    return "|".join(f"{a}:{s}:{int(t)}" for a, (s, t) in items.items())


def scenario(astronaut_id: str, ts: float | None = None) -> tuple[str | None, float, float]:
    """(escenario, inicio, intensidad 0..1) para ese astronauta en el instante ts."""
    item = SCENARIOS.get().get(astronaut_id)
    if not item:
        return None, 0.0, 0.0
    name, started = item
    ts = time.time() if ts is None else ts
    if ts < started:
        return name, started, 0.0
    return name, started, min(1.0, (ts - started) / RAMP_S)
