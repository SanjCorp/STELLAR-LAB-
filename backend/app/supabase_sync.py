"""Lectura de telemetría desde Supabase (solo librería estándar).

El ESP32 inserta filas en la tabla `public.telemetry` usando la clave PÚBLICA.
Este módulo las lee con la clave SECRETA (que se salta RLS) y se las entrega al
backend mediante callbacks. Si faltan las variables de entorno, queda desactivado
y la app sigue funcionando solo con simulación.

Variables (en backend/.env, nunca en el repositorio):
    SUPABASE_URL=https://<proyecto>.supabase.co
    SUPABASE_SECRET_KEY=sb_secret_...
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
POLL_SECONDS = 1.0
BOOTSTRAP_ROWS = 240

# Estado visible en /api/health
status: dict = {"supabase": "disabled", "last_row_id": None, "rows_received": 0, "last_error": None}


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


def _get(base_url: str, key: str, params: dict) -> list[dict]:
    url = f"{base_url}/rest/v1/telemetry?{urlencode(params)}"
    # Las claves nuevas (sb_secret_...) van solo en el encabezado `apikey`.
    request = Request(url, headers={"apikey": key, "Accept": "application/json"})
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def _clean(row: dict) -> dict:
    row = dict(row)
    row.pop("id", None)
    row["source"] = "hardware"
    return row


def start(
    on_history: Callable[[str, dict], None],
    on_live: Callable[[str, dict], None],
) -> bool:
    """Arranca el hilo de lectura. Devuelve False si no hay configuración."""
    load_env_file()
    base_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY", "")
    if not base_url or not key:
        status["supabase"] = "disabled"
        return False

    status["supabase"] = "starting"

    def worker() -> None:
        last_id: int | None = None
        delay = POLL_SECONDS
        while True:
            try:
                if last_id is None:
                    # Arranque: cargar historial reciente (no se marca como "vivo").
                    rows = _get(base_url, key, {"select": "*", "order": "id.desc", "limit": BOOTSTRAP_ROWS})
                    for row in reversed(rows):
                        on_history(row["astronaut_id"], _clean(row))
                    last_id = rows[0]["id"] if rows else 0
                else:
                    rows = _get(
                        base_url,
                        key,
                        {"select": "*", "id": f"gt.{last_id}", "order": "id.asc", "limit": 500},
                    )
                    for row in rows:
                        on_live(row["astronaut_id"], _clean(row))
                        last_id = row["id"]
                        status["rows_received"] += 1
                status.update(supabase="ok", last_row_id=last_id, last_error=None)
                delay = POLL_SECONDS
            except HTTPError as exc:
                status.update(supabase="error", last_error=f"HTTP {exc.code}")
                delay = min(delay * 2, 30)
            except (URLError, TimeoutError, OSError, ValueError, KeyError) as exc:
                status.update(supabase="error", last_error=type(exc).__name__)
                delay = min(delay * 2, 30)
            time.sleep(delay)

    threading.Thread(target=worker, name="supabase-sync", daemon=True).start()
    return True
