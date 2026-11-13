"""Punto de entrada para Vercel: expone la app FastAPI de backend/app/main.py.

Vercel ejecuta este archivo como función de Python. vercel.json redirige todas
las rutas /api/* aquí, y FastAPI las atiende con sus rutas normales.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app  # noqa: E402,F401
