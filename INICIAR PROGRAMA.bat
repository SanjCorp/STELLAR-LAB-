@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title STELLAR Health - Iniciador

echo.
echo ==================================================
echo              STELLAR HEALTH SYSTEM
echo ==================================================
echo.

where node >nul 2>&1
if errorlevel 1 goto :node_missing
where npm >nul 2>&1
if errorlevel 1 goto :node_missing

if exist "backend\.venv\Scripts\python.exe" goto :dependencies
where py >nul 2>&1
if not errorlevel 1 (
  set "STELLAR_PYTHON=py"
  goto :dependencies
)
where python >nul 2>&1
if errorlevel 1 goto :python_missing
set "STELLAR_PYTHON=python"

:dependencies
if exist "backend\.venv\Scripts\python.exe" if exist "frontend\node_modules" goto :start

echo Primera ejecucion: instalando dependencias...
echo Este proceso puede tardar varios minutos.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-local.ps1"
if errorlevel 1 goto :setup_error

:start
echo Iniciando servidor y aplicacion web...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1"
if errorlevel 1 goto :start_error

echo.
echo STELLAR esta iniciandose en http://localhost:5173
echo El navegador se abrira automaticamente.
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173"
exit /b 0

:node_missing
echo ERROR: Node.js no esta instalado.
echo Descargalo desde https://nodejs.org/ e intenta nuevamente.
goto :failure

:python_missing
echo ERROR: Python 3 no esta instalado.
echo Descargalo desde https://www.python.org/downloads/ e intenta nuevamente.
goto :failure

:setup_error
echo ERROR: No se pudieron instalar las dependencias.
goto :failure

:start_error
echo ERROR: No se pudo iniciar STELLAR.

:failure
echo.
pause
exit /b 1
