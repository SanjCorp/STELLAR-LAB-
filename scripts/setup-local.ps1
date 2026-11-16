$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Push-Location "$root\backend"
if (-not (Test-Path '.venv')) {
  $python = if ($env:STELLAR_PYTHON) {
    $env:STELLAR_PYTHON
  } elseif (Get-Command py -ErrorAction SilentlyContinue) {
    'py'
  } elseif (Get-Command python -ErrorAction SilentlyContinue) {
    'python'
  } else {
    throw 'Python 3 no está instalado o no está disponible en PATH.'
  }
  & $python -m venv .venv
}
& '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
Pop-Location

Push-Location "$root\frontend"
npm install
Pop-Location

Write-Host 'STELLAR listo. Ejecuta .\scripts\start-local.ps1'

