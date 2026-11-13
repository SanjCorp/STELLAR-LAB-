"""Consulta de telemetría en Supabase por petición (solo librería estándar).

Pensado para funcionar igual en local y en Vercel (funciones sin memoria entre
peticiones): no hay hilos en segundo plano; cada endpoint pide a Supabase las
filas recientes que necesita. Un caché de ~0,8 s evita repetir la misma consulta
cuando el panel pide /api/state y /api/history casi a la vez.

El ESP32 inserta filas con la clave PÚBLICA. Aquí se leen con la clave SECRETA
(que se salta RLS). Si faltan las variables de entorno, este módulo queda
desactivado y la app funciona solo con simulación.

Variables (en backend/.env en local, o en Vercel > Settings > Environment Variables):
    SUPABASE_URL=https://<proyecto>.supabase.co
    SUPABASE_SECRET_KEY=sb_secret_...
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
CACHE_SECONDS = 0.8

# Estado visible en /api/health
status: dict = {"supabase": "disabled", "last_error": None}

_cache: dict[tuple, tuple[float, list[dict]]] = {}


def load_env_file(path: Path = ENV_FILE) -> None:
    """Carga KEY=VALUE desde backend/.env sin pisar variables ya definidas."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _config() -> tuple[str, str]:
    return os.environ.get("SUPABASE_URL", "").rstrip("/"), os.environ.get("SUPABASE_SECRET_KEY", "")


def configured() -> bool:
    url, key = _config()
    return bool(url and key)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def parse_ts(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def _get(params: dict) -> list[dict]:
    base_url, key = _config()
    url = f"{base_url}/rest/v1/telemetry?{urlencode(params)}"
    # Las claves nuevas (sb_secret_...) van solo en el encabezado `apikey`.
    request = Request(url, headers={"apikey": key, "Accept": "application/json"})
    with urlopen(request, timeout=4) as response:
        return json.loads(response.read().decode("utf-8"))


def recent_rows(astronaut_id: str | None, window_s: float) -> list[dict]:
    """Filas recibidas en los últimos `window_s` segundos, de la más antigua a la más nueva.

    Cada fila trae `_ts` (segundos Unix de `received_at`) y `source="hardware"`.
    Si Supabase no está configurado o falla, devuelve [] (la app sigue con simulación).
    """
    if not configured():
        status.update(supabase="disabled", last_error=None)
        return []

    cache_key = (astronaut_id, window_s)
    cached = _cache.get(cache_key)
    now = time.time()
    if cached and now - cached[0] < CACHE_SECONDS:
        return cached[1]

    params = {"select": "*", "received_at": f"gte.{_iso(now - window_s)}", "order": "id.asc", "limit": 1000}
    if astronaut_id:
        params["astronaut_id"] = f"eq.{astronaut_id}"
    try:
        rows = _get(params)
    except HTTPError as exc:
        status.update(supabase="error", last_error=f"HTTP {exc.code}")
        return []
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        status.update(supabase="error", last_error=type(exc).__name__)
        return []

    clean: list[dict] = []
    for row in rows:
        row = dict(row)
        row.pop("id", None)
        row["source"] = "hardware"
        try:
            row["_ts"] = parse_ts(row["received_at"])
        except (KeyError, TypeError, ValueError):
            continue
        clean.append(row)

    status.update(supabase="ok", last_error=None)
    _cache[cache_key] = (now, clean)
    return clean
