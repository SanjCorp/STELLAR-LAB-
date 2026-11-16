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
status: dict = {"supabase": "disabled", "last_error": None, "checkins": "disabled"}

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


def _request(table: str, params: dict, body: dict | None = None, prefer: str = "return=representation") -> list[dict]:
    """GET (sin body) o POST (con body) a la API REST de Supabase."""
    base_url, key = _config()
    url = f"{base_url}/rest/v1/{table}?{urlencode(params)}"
    # Las claves nuevas (sb_secret_...) van solo en el encabezado `apikey`.
    headers = {"apikey": key, "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers.update({"Content-Type": "application/json", "Prefer": prefer})
    request = Request(url, data=data, headers=headers, method="POST" if body is not None else "GET")
    with urlopen(request, timeout=4) as response:
        return json.loads(response.read().decode("utf-8") or "[]")


def _get(params: dict) -> list[dict]:
    return _request("telemetry", params)


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

    params = {"select": "*", "received_at": f"gte.{_iso(now - window_s)}", "order": "id.desc", "limit": 1000}
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
    for row in reversed(rows):  # se piden las más nuevas primero; aquí quedan de antigua a nueva
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


def insert_telemetry(row: dict) -> bool:
    """Inserta una fila en `telemetry` (la usa el modo sensor del celular). False si falla."""
    if not configured():
        return False
    try:
        _request("telemetry", {}, row, prefer="return=minimal")
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        status.update(supabase="error", last_error=f"insert {getattr(exc, 'code', type(exc).__name__)}")
        return False
    _cache.clear()  # que la siguiente lectura ya vea la fila nueva
    return True


# --------------------------------------------------------------------------- #
# Chequeos diarios (tabla public.checkins). Solo el backend la usa, con la
# clave secreta; el ESP32 no la toca. Si la tabla no existe, devuelve None y
# main.py guarda en memoria como respaldo.
# --------------------------------------------------------------------------- #
def _checkins_error(exc: Exception) -> None:
    if isinstance(exc, HTTPError) and exc.code == 404:
        status["checkins"] = "missing_table"
    else:
        status["checkins"] = f"error: {getattr(exc, 'code', type(exc).__name__)}"


def insert_checkin(row: dict) -> dict | None:
    if not configured():
        status["checkins"] = "disabled"
        return None
    try:
        saved = _request("checkins", {"select": "*"}, row)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        _checkins_error(exc)
        return None
    status["checkins"] = "ok"
    return saved[0] if saved else row


def list_checkins(astronaut_id: str, since_ts: float) -> list[dict] | None:
    if not configured():
        status["checkins"] = "disabled"
        return None
    params = {"select": "*", "astronaut_id": f"eq.{astronaut_id}", "created_at": f"gte.{_iso(since_ts)}",
              "order": "created_at.desc", "limit": 200}
    try:
        rows = _request("checkins", params)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        _checkins_error(exc)
        return None
    status["checkins"] = "ok"
    return rows
