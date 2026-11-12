$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Push-Location "$root\backend"
if (-not (Test-Path '.venv')) {
  $python = if ($env:STELLAR_PYTHON) { $env:STELLAR_PYTHON } else { 'python' }
  & $python -m venv .venv
}
& '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
Pop-Location

Push-Location "$root\frontend"
npm install
Pop-Location

Write-Host 'STELLAR listo. Ejecuta .\scripts\start-local.ps1'

