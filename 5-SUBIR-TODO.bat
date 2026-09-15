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

REM ================= SEGURO ANTI-CREDENCIALES =================
echo  Revisando que no haya credenciales en el codigo...
set FUGA=0
findstr /C:"PON_TU_CLIENT_ID_AQUI" apps-script\Auth.gs >nul 2>&1
if errorlevel 1 set FUGA=1
findstr /C:"PON_TU_CLIENT_SECRET_AQUI" apps-script\Auth.gs >nul 2>&1
if errorlevel 1 set FUGA=1
findstr /C:"PON_TU_PASSWORD_AQUI" apps-script\Auth.gs >nul 2>&1
if errorlevel 1 set FUGA=1

if "!FUGA!"=="1" (
    echo.
    echo  =======================================================
    echo    DETENIDO - POSIBLE CREDENCIAL EN Auth.gs
    echo  =======================================================
    echo.
    echo  Un placeholder fue reemplazado. Si ahi quedo una
    echo  credencial real y la subes, queda en el historial
    echo  publico de git PARA SIEMPRE.
    echo.
    echo  Regresa los valores a sus placeholders en Auth.gs
    echo  y vuelve a correr esto. Tus credenciales ya estan
    echo  en PropertiesService, no hacen falta en el codigo.
    echo.
    pause
    exit /b 1
)
echo  Limpio.
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
    echo.
    echo  Si el error de arriba menciona "access_token" o
    echo  "invalid_grant", caduco tu sesion de clasp. Se arregla:
    echo.
    echo     1^) Deja que esto termine con GitHub
    echo     2^) Corre  1-INSTALAR-CLASP.bat
    echo        ^(entra con la cuenta victor.walmart.04^)
    echo     3^) Corre  2-SUBIR-A-APPSCRIPT.bat
    echo.
    echo  Tus archivos NO se perdieron. GitHub sigue adelante.
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
REM Candado huerfano: si un git anterior murio a medias (o lo dejo abierto
REM otra herramienta), queda .git\index.lock y TODO git se niega a correr
REM con "Another git process seems to be running". Se limpia solo.
if exist ".git\index.lock" (
    echo  Limpiando candado de git que quedo colgado...
    del /f /q ".git\index.lock" >nul 2>&1
)

REM Contar con "for /f" + pipe se rompe cuando la ruta de git trae espacios
REM (el git de GitHub Desktop). Mejor preguntarle a git directamente:
REM diff-index devuelve 0 si NO hay cambios.
"!GIT!" diff-index --quiet HEAD -- 2>nul
if not errorlevel 1 (
    "!GIT!" ls-files --others --exclude-standard >"%TEMP%\wm_nuevos.txt" 2>nul
    for %%F in ("%TEMP%\wm_nuevos.txt") do if %%~zF EQU 0 (
        del "%TEMP%\wm_nuevos.txt" >nul 2>&1
        echo  No hay cambios para GitHub.
        goto FIN
    )
    del "%TEMP%\wm_nuevos.txt" >nul 2>&1
)

echo  Archivos con cambios:
"!GIT!" status --short
echo.

REM Guardamos QUE cambio, para decidir despues si hace falta
REM publicar version. El dashboard (la URL /exec) corre la version
REM PUBLICADA, no el ultimo codigo subido. Los triggers y el menu
REM del Sheet si corren el ultimo codigo, por eso a ellos no les
REM afecta. Solo estos archivos los ejecuta el Web App:
REM   WebAPI.gs  Auth.gs  Sync.gs  Api.gs  Config.gs
"!GIT!" status --porcelain > "%TEMP%\wm_cambios.txt" 2>nul
set "PUBLICAR="
findstr /I /C:"apps-script/WebAPI.gs" "%TEMP%\wm_cambios.txt" >nul 2>&1 && set "PUBLICAR=1"
findstr /I /C:"apps-script/Auth.gs"   "%TEMP%\wm_cambios.txt" >nul 2>&1 && set "PUBLICAR=1"
findstr /I /C:"apps-script/Sync.gs"   "%TEMP%\wm_cambios.txt" >nul 2>&1 && set "PUBLICAR=1"
findstr /I /C:"apps-script/Api.gs"    "%TEMP%\wm_cambios.txt" >nul 2>&1 && set "PUBLICAR=1"
findstr /I /C:"apps-script/Config.gs" "%TEMP%\wm_cambios.txt" >nul 2>&1 && set "PUBLICAR=1"
del "%TEMP%\wm_cambios.txt" >nul 2>&1

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
if defined PUBLICAR goto SIPUBLICAR
echo  No hace falta publicar version: no cambiaste codigo
echo  que use el dashboard.
echo.
pause
exit /b 0

:SIPUBLICAR
echo  -------------------------------------------------------
echo    FALTA UN PASO: PUBLICAR VERSION
echo  -------------------------------------------------------
echo.
echo  Cambiaste codigo que SI usa el dashboard. Mientras no
echo  publiques, la URL sigue sirviendo el codigo viejo.
echo.
echo  En el editor de Apps Script:
echo     Implementar
echo     Administrar implementaciones
echo     icono de lapiz
echo     Version: Nueva version
echo     Implementar
echo.
echo  Edita la que YA existe. No le des "Nueva implementacion":
echo  eso genera otra URL y deja la tuya huerfana.
echo.
pause
