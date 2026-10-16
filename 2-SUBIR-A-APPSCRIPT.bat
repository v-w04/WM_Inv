@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
call _config.bat
title Subir a Apps Script

REM ---- Color de marca ----
set "ESC="
for /f %%E in ('echo prompt $E ^| cmd') do set "ESC=%%E"
set "AZUL="
set "VERDE="
set "ROJO="
set "FIN="
if defined ESC set "AZUL=%ESC%[38;2;31;148;249m"
if defined ESC set "VERDE=%ESC%[38;2;63;185;80m"
if defined ESC set "ROJO=%ESC%[38;2;248;81;73m"
if defined ESC set "FIN=%ESC%[0m"

REM Un git que murio a media operacion deja candados y TODO git se niega.
REM No basta index.lock: HEAD.lock tumba el commit y deja pasar el resto
REM del bat como si nada.
del /f /q ".git\index.lock" ".git\HEAD.lock" ".git\config.lock" >nul 2>&1
del /f /q ".git\objects\maintenance.lock" >nul 2>&1
del /f /q ".git\refs\heads\*.lock" >nul 2>&1

echo.
echo   SUBIR A APPS SCRIPT              solo el backend
echo   %AZUL%----------------------------------------------------%FIN%
echo.

echo   %AZUL%[1/2]%FIN%  Apps Script . . . . . . . . . . . .
if not exist ".clasp.json" goto NOCONFIG
findstr /C:"PON_AQUI" .clasp.json >nul 2>&1
if not errorlevel 1 goto NOSCRIPTID
REM clasp push --force con la carpeta vacia BORRA el proyecto.
if not exist "apps-script\appsscript.json" goto SINBACKEND
call :BUSCARGIT
if errorlevel 1 set "PUBLICAR=?"
if not "!PUBLICAR!"=="?" call :REVISARVERSION
call clasp push --force >nul 2>"%TEMP%\wm_e.txt"
if errorlevel 1 goto CLASPFALLO
echo          ok

echo   %AZUL%[2/2]%FIN%  Columnas por posicion . . . . . . .
call :COLUMNAS

echo.
echo   %AZUL%----------------------------------------------------%FIN%
echo.
if "!PUBLICAR!"=="?" goto VER_NOSE
if defined PUBLICAR goto VER_SI
echo %VERDE%  Listo.%FIN%
goto VER_FIN

:VER_SI
echo   %ROJO%^^!  FALTA PUBLICAR VERSION%FIN%
goto VER_FIN

:VER_NOSE
echo   %ROJO%^^!  NO SE SI FALTA PUBLICAR VERSION%FIN%

:VER_FIN
echo.
call :LOGO
exit /b 0

:NOCONFIG
echo          falta
echo.
echo   %ROJO%x  NO ENCUENTRO .clasp.json%FIN%
echo      Corre 1-INSTALAR-CLASP.bat
echo.
pause
exit /b 1

:NOSCRIPTID
echo          falta
echo.
echo   %ROJO%x  FALTA EL SCRIPT ID EN .clasp.json%FIN%
echo      Reemplaza PON_AQUI_TU_SCRIPT_ID con el ID de la URL del editor.
echo.
pause
exit /b 1

:SINBACKEND
echo.
echo   %ROJO%x  apps-script VACIA - no se subio nada%FIN%
echo.
pause
exit /b 1

:CLASPFALLO
type "%TEMP%\wm_e.txt"
echo.
echo   %ROJO%x  FALLO EL PUSH A APPS SCRIPT%FIN%
echo      API apagada o sesion caducada: 1-INSTALAR-CLASP.bat
echo.
pause
exit /b 1

:COLUMNAS
REM Recordatorio, no bloquea: avisa si hay codigo NUEVO que lee columnas por posicion.
where node >nul 2>&1
if errorlevel 1 exit /b 0
if not exist "%~dp0_columnas.js" exit /b 0
node "%~dp0_columnas.js" >"%TEMP%\col_o.txt" 2>&1
if errorlevel 2 goto COLNOPUDE
if errorlevel 1 goto COLNUEVAS
exit /b 0
:COLNUEVAS
echo          %ROJO%^^!  columnas por posicion NUEVAS: leer por encabezado%FIN%
type "%TEMP%\col_o.txt"
exit /b 0
:COLNOPUDE
echo          %ROJO%^^!  no pude revisar columnas%FIN%
exit /b 0

:BUSCARGIT
set "GIT=git"
where git >nul 2>&1
if not errorlevel 1 exit /b 0
for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
)
if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"
if "!GIT!"=="git" exit /b 1
exit /b 0

REM Decide SOLA si hay que publicar version nueva del Web App. Son los
REM archivos que corre la URL del dashboard; el menu del Sheet y los
REM triggers no pasan por ahi. Va ANTES del commit: despues el status
REM ya no dice nada.
:REVISARVERSION
set "PUBLICAR="
set "TMPV=%TEMP%\wm_v.txt"
"!GIT!" status --porcelain > "!TMPV!" 2>nul
if not exist "!TMPV!" goto NOSEVERSION
"!GIT!" diff --name-only @{u}..HEAD >> "!TMPV!" 2>nul
for %%A in (WebAPI.gs Auth.gs Sync.gs Api.gs Config.gs) do (
    findstr /I /C:"apps-script/%%A" "!TMPV!" >nul 2>&1 && set "PUBLICAR=1"
)
del "!TMPV!" >nul 2>&1
exit /b 0

:NOSEVERSION
set "PUBLICAR=?"
exit /b 0

:LOGO
where node >nul 2>&1
if errorlevel 1 goto SINLOGO
if not exist "%~dp0logo-animado.js" goto SINLOGO
node "%~dp0logo-animado.js" giro marca 0 12
goto :eof

:SINLOGO
pause
goto :eof
