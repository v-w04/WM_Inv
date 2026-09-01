@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Subir todo - Apps Script + GitHub

echo.
echo  =======================================================
echo    SUBIR TODO
echo    Apps Script  +  GitHub
echo  =======================================================
echo.

REM ================= PARTE 1: APPS SCRIPT =================
echo  ###  PARTE 1 de 2 - APPS SCRIPT  ###
echo.

if not exist ".clasp.json" (
    echo  Saltando: no hay .clasp.json
    goto GITPART
)

call clasp push --force
if errorlevel 1 (
    echo.
    echo  ADVERTENCIA: fallo el push a Apps Script.
    echo  Continuo con GitHub de todos modos.
    echo.
    pause
) else (
    echo.
    echo  Apps Script actualizado.
)
echo.

REM ================= PARTE 2: GITHUB =================
:GITPART
echo  ###  PARTE 2 de 2 - GITHUB  ###
echo.

set "GIT=git"
where git >nul 2>&1
if not errorlevel 1 goto GOTGIT

for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
)
if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"

if "!GIT!"=="git" (
    echo  ERROR: no encuentro git. Usa GitHub Desktop para esta parte.
    echo.
    pause
    exit /b 1
)

:GOTGIT
for /f %%C in ('"!GIT!" status --porcelain 2^>nul ^| find /c /v ""') do set CAMBIOS=%%C
if "!CAMBIOS!"=="0" (
    echo  No hay cambios para GitHub.
    goto FIN
)

echo  Archivos con cambios: !CAMBIOS!
"!GIT!" status --short
echo.

set "MSG="
set /p "MSG=  Mensaje del commit [Enter para uno automatico]: "
if "!MSG!"=="" set "MSG=Actualiza dashboard de inventario Walmart"
echo.

"!GIT!" add -A
"!GIT!" commit -m "!MSG!" -m "Co-Authored-By: Claude Opus 5 ^<noreply@anthropic.com^>"
"!GIT!" push origin main
if errorlevel 1 (
    echo.
    echo  ERROR en el push a GitHub. Revisa el mensaje de arriba.
    echo  Si dice Authentication failed, abre GitHub Desktop una vez.
    echo.
    pause
    exit /b 1
)

:FIN
echo.
echo  =======================================================
echo    TODO LISTO
echo  =======================================================
echo.
echo  Apps Script: codigo actualizado
echo  GitHub:      https://github.com/v-w04/WM_Inv
echo  Dashboard:   https://v-w04.github.io/WM_Inv/
echo.
echo  RECORDATORIO: si cambiaste el backend y quieres que la
echo  URL del dashboard lo use, publica una version nueva:
echo  Implementar - Administrar implementaciones - lapiz -
echo  Version: Nueva version - Implementar
echo.
pause
