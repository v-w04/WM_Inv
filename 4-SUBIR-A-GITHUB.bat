@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Subir a GitHub

echo.
echo  =======================================================
echo    SUBIENDO A GITHUB
echo  =======================================================
echo.

REM ================= SEGURO ANTI-CREDENCIALES =================
REM El repo es publico y git guarda el historial para siempre.
REM Si alguien puso una credencial real en un .gs, hay que
REM detenerlo ANTES del commit, no despues.

echo  [0/5] Revisando que no haya credenciales en el codigo...
set FUGA=0

findstr /C:"PON_TU_CLIENT_ID_AQUI" apps-script\Auth.gs >nul 2>&1
if errorlevel 1 (
    echo        ALERTA: CLIENT_ID en Auth.gs ya no es el placeholder
    set FUGA=1
)
findstr /C:"PON_TU_CLIENT_SECRET_AQUI" apps-script\Auth.gs >nul 2>&1
if errorlevel 1 (
    echo        ALERTA: CLIENT_SECRET en Auth.gs ya no es el placeholder
    set FUGA=1
)
findstr /C:"PON_TU_PASSWORD_AQUI" apps-script\Auth.gs >nul 2>&1
if errorlevel 1 (
    echo        ALERTA: PASSWORD en Auth.gs ya no es el placeholder
    set FUGA=1
)

if "!FUGA!"=="1" goto FUGADETECTADA
echo        Limpio.
echo.

REM ================= GIT =================
set "GIT=git"
where git >nul 2>&1
if not errorlevel 1 goto GOTGIT

for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
)
if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"
if "!GIT!"=="git" goto NOGIT

:GOTGIT
echo  [1/5] Estado del repositorio
"!GIT!" status --short
if errorlevel 1 goto NOTREPO
echo.

for /f %%C in ('"!GIT!" status --porcelain 2^>nul ^| find /c /v ""') do set CAMBIOS=%%C
if "!CAMBIOS!"=="0" (
    echo  No hay cambios que subir. Todo esta al dia.
    echo.
    pause
    exit /b 0
)

echo  [2/5] Archivos con cambios: !CAMBIOS!
echo.
set "MSG="
set /p "MSG=  Mensaje del commit [Enter para uno automatico]: "
if "!MSG!"=="" set "MSG=Actualiza dashboard de inventario Walmart"
echo.

echo  [3/5] Agregando archivos
"!GIT!" add -A
if errorlevel 1 goto FAIL

echo  [4/5] Creando commit
"!GIT!" commit -m "!MSG!" -m "Co-Authored-By: Claude Opus 5 ^<noreply@anthropic.com^>"
if errorlevel 1 goto FAIL

echo  [5/5] Subiendo a origin
"!GIT!" push origin main
if errorlevel 1 goto PUSHFAIL

echo.
echo  =======================================================
echo    SUBIDO A GITHUB
echo  =======================================================
echo.
echo  Repo:      https://github.com/v-w04/WM_Inv
echo  Dashboard: https://v-w04.github.io/WM_Inv/
echo.
echo  GitHub Pages tarda 1-2 minutos en publicar.
echo.
pause
exit /b 0

:FUGADETECTADA
echo.
echo  =======================================================
echo    DETENIDO - POSIBLE CREDENCIAL EN EL CODIGO
echo  =======================================================
echo.
echo  Alguno de los placeholders de Auth.gs fue reemplazado.
echo  Si ahi quedo una credencial real y la subes, va a quedar
echo  en el historial publico de git PARA SIEMPRE.
echo.
echo  QUE HACER:
echo    1. Abre apps-script\Auth.gs
echo    2. Regresa los valores a sus placeholders:
echo         PON_TU_CLIENT_ID_AQUI
echo         PON_TU_CLIENT_SECRET_AQUI
echo         PON_TU_PASSWORD_AQUI
echo    3. Vuelve a correr este archivo
echo.
echo  Tus credenciales YA estan guardadas en PropertiesService,
echo  no necesitas dejarlas en el codigo para que funcione.
echo.
pause
exit /b 1

:NOGIT
echo  ERROR: No encuentro git.
echo  Instalalo de https://git-scm.com/download/win o usa GitHub Desktop.
echo.
pause
exit /b 1

:NOTREPO
echo  ERROR: Esta carpeta no es un repositorio de git.
echo  Abre GitHub Desktop y agregala como repositorio.
echo.
pause
exit /b 1

:PUSHFAIL
echo.
echo  ERROR: fallo el push.
echo.
echo  - "Authentication failed"
echo      Abre GitHub Desktop una vez para renovar la sesion
echo  - "rejected - non-fast-forward"
echo      Alguien subio cambios. Corre 0-ACTUALIZAR.bat primero
echo  - "src refspec main does not match any"
echo      Tu rama quiza se llama master. Avisame y lo ajusto
echo.
pause
exit /b 1

:FAIL
echo.
echo  ERROR: revisa el mensaje de arriba.
echo.
pause
exit /b 1
