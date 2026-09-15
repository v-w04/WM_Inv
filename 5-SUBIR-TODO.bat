@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Subir todo

echo.
echo   SUBIR TODO                    Apps Script + GitHub
echo   ----------------------------------------------------
echo.

REM ================= SEGURO ANTI-CREDENCIALES =================
REM El repo es publico y git guarda el historial para siempre.
REM Si quedo una credencial real en un .gs hay que detenerlo
REM ANTES del commit, no despues.
echo   [1/3]  Credenciales en el codigo . . . . .
set FUGA=0
findstr /C:"PON_TU_CLIENT_ID_AQUI" apps-script\Auth.gs >nul 2>&1
if errorlevel 1 set FUGA=1
findstr /C:"PON_TU_CLIENT_SECRET_AQUI" apps-script\Auth.gs >nul 2>&1
if errorlevel 1 set FUGA=1
findstr /C:"PON_TU_PASSWORD_AQUI" apps-script\Auth.gs >nul 2>&1
if errorlevel 1 set FUGA=1
if "!FUGA!"=="1" goto FUGADETECTADA
echo          limpio
echo.

REM ================= PARTE 1: APPS SCRIPT =================
echo   [2/3]  Apps Script . . . . . . . . . . . .
echo.
if not exist ".clasp.json" (
    echo          sin .clasp.json - saltado
    goto GITPART
)
call clasp push --force
if errorlevel 1 goto CLASPFAIL
echo.
echo          subido
echo.
goto GITPART

:CLASPFAIL
echo.
echo   !  FALLO EL PUSH A APPS SCRIPT
echo.
echo      Si el error menciona "access_token" o "invalid_grant",
echo      caduco tu sesion de clasp:
echo.
echo        1^) deja que esto termine con GitHub
echo        2^) corre 1-INSTALAR-CLASP.bat
echo           ^(entra con victor.walmart.04^)
echo        3^) corre 2-SUBIR-A-APPSCRIPT.bat
echo.
echo      Tus archivos NO se perdieron.
echo.
pause
echo.

REM ================= PARTE 2: GITHUB =================
:GITPART
echo   [3/3]  GitHub . . . . . . . . . . . . . .

set "GIT=git"
where git >nul 2>&1
if not errorlevel 1 goto GOTGIT

for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
)
if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"

if "!GIT!"=="git" (
    echo          NO encuentro git
    echo.
    echo   x  Usa GitHub Desktop para esta parte.
    echo.
    pause
    exit /b 1
)

:GOTGIT
REM Candado huerfano de un git que murio a medias.
if exist ".git\index.lock" del /f /q ".git\index.lock" >nul 2>&1

"!GIT!" diff-index --quiet HEAD -- 2>nul
if not errorlevel 1 (
    "!GIT!" ls-files --others --exclude-standard >"%TEMP%\wm_nuevos.txt" 2>nul
    for %%F in ("%TEMP%\wm_nuevos.txt") do if %%~zF EQU 0 (
        del "%TEMP%\wm_nuevos.txt" >nul 2>&1
        echo          sin cambios
        goto FIN
    )
    del "%TEMP%\wm_nuevos.txt" >nul 2>&1
)
echo.
echo.
"!GIT!" status --short
echo.

REM Se guarda QUE cambio para decidir despues si hace falta
REM publicar version. El dashboard corre la version PUBLICADA;
REM los triggers y el menu corren el ultimo codigo. Solo estos
REM archivos los ejecuta el Web App:
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
set /p "MSG=   Mensaje del commit [Enter = automatico]: "
if "!MSG!"=="" set "MSG=Actualiza dashboard de inventario Walmart"
echo.

"!GIT!" add -A
"!GIT!" commit -m "!MSG!" -m "Co-Authored-By: Claude Opus 5 ^<noreply@anthropic.com^>"
"!GIT!" push origin main
if errorlevel 1 goto PUSHFAIL
echo.
echo          subido

:FIN
echo.
echo   ----------------------------------------------------
echo.
echo   Repo        github.com/v-w04/WM_Inv
echo   Dashboard   v-w04.github.io/WM_Inv/
echo.
echo   GitHub Pages tarda 1-2 min en publicar.
echo.

if defined PUBLICAR goto SIPUBLICAR
echo   No hace falta publicar version: no cambiaste codigo
echo   que use el dashboard.
echo.
pause
call :LOGO
exit /b 0

:SIPUBLICAR
echo   !  FALTA PUBLICAR VERSION
echo.
echo      Cambiaste codigo que SI usa el dashboard. Mientras
echo      no publiques, la URL sirve el codigo viejo.
echo.
echo      Implementar
echo      Administrar implementaciones
echo      icono de lapiz
echo      Version: Nueva version
echo      Implementar
echo.
echo      Edita la que YA existe. "Nueva implementacion"
echo      genera otra URL y deja la tuya huerfana.
echo.
pause
call :LOGO
exit /b 0

:FUGADETECTADA
echo          ALERTA
echo.
echo   ----------------------------------------------------
echo.
echo   x  DETENIDO - POSIBLE CREDENCIAL EN Auth.gs
echo.
echo      Un placeholder fue reemplazado. Si ahi quedo una
echo      credencial real y la subes, queda en el historial
echo      publico de git PARA SIEMPRE.
echo.
echo      Regresa los valores a sus placeholders:
echo        PON_TU_CLIENT_ID_AQUI
echo        PON_TU_CLIENT_SECRET_AQUI
echo        PON_TU_PASSWORD_AQUI
echo.
echo      Tus credenciales YA estan en PropertiesService.
echo      No hacen falta en el codigo.
echo.
pause
exit /b 1

:PUSHFAIL
echo.
echo   ----------------------------------------------------
echo.
echo   x  FALLO EL PUSH A GITHUB
echo.
echo      "Authentication failed"
echo         abre GitHub Desktop una vez para renovar sesion
echo      "rejected - non-fast-forward"
echo         alguien subio cambios: corre 0-ACTUALIZAR.bat
echo.
pause
exit /b 1

:LOGO
REM --- Logo animado ---
REM Va DESPUES del pause a proposito: el logo hace cls, y si corriera
REM antes borraria el reporte que la usuaria acaba de leer (incluido
REM el aviso de publicar version). Solo en salidas exitosas.
REM Si falta node o el .js, no pasa nada: se salta en silencio.
where node >nul 2>&1
if errorlevel 1 goto :eof
if not exist "%~dp0logo-animado.js" goto :eof
cls
node "%~dp0logo-animado.js" giro marca 18
goto :eof
