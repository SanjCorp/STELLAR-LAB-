$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path "$root\backend\.venv\Scripts\python.exe")) {
  throw 'Faltan dependencias. Ejecuta primero .\scripts\setup-local.ps1'
}
if (-not (Test-Path "$root\frontend\node_modules")) {
  throw 'Faltan dependencias. Ejecuta primero .\scripts\setup-local.ps1'
}

Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoExit', '-Command', "Set-Location '$root\backend'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoExit', '-Command', "Set-Location '$root\frontend'; npm run dev -- --host 0.0.0.0"

Write-Host 'STELLAR Health iniciándose en http://localhost:5173'

