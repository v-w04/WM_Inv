@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Subir a Apps Script

REM ---- Color de marca ----
REM CMD de Windows 10+ entiende color de 24 bits, pero necesita el
REM caracter ESC y no hay forma de escribirlo literal en un .bat sin
REM romper el ASCII puro. Este truco lo saca de la variable de prompt.
REM Si falla, AZUL y FIN quedan vacios y todo sale en texto normal:
REM nunca se imprimen codigos sueltos en pantalla.
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

echo.
echo   SUBIR A APPS SCRIPT                 solo el backend
echo   %AZUL%----------------------------------------------------%FIN%
echo.

if not exist ".clasp.json" goto NOCONFIG
findstr /C:"PON_AQUI" .clasp.json >nul 2>&1
if not errorlevel 1 goto NOSCRIPTID

set N=0
for %%F in (apps-script\*.gs) do set /a N+=1
echo   Archivos a subir . . . . . . . . . . . . !N! .gs
echo.
for %%F in (apps-script\*.gs) do echo     %%~nxF
echo     appsscript.json
echo.
echo   %AZUL%----------------------------------------------------%FIN%
echo.

call clasp push --force
if errorlevel 1 goto PUSHFAIL

echo.
echo   %AZUL%----------------------------------------------------%FIN%
echo.

REM No sirve un recordatorio que te obligue a investigar si aplica.
REM El dashboard (la URL /exec) corre la version PUBLICADA, no el
REM ultimo codigo subido. Los triggers y el menu del Sheet si corren
REM el ultimo codigo. Asi que solo hay que publicar cuando cambia
REM algo que ejecuta el Web App:
REM   WebAPI.gs  Auth.gs  Sync.gs  Api.gs  Config.gs
set "GIT=git"
where git >nul 2>&1
if errorlevel 1 goto NOSEQUE

set "PUBLICAR="
"!GIT!" status --porcelain > "%TEMP%\wm_c2.txt" 2>nul
if not exist "%TEMP%\wm_c2.txt" goto NOSEQUE
findstr /I /C:"apps-script/WebAPI.gs" "%TEMP%\wm_c2.txt" >nul 2>&1 && set "PUBLICAR=1"
findstr /I /C:"apps-script/Auth.gs"   "%TEMP%\wm_c2.txt" >nul 2>&1 && set "PUBLICAR=1"
findstr /I /C:"apps-script/Sync.gs"   "%TEMP%\wm_c2.txt" >nul 2>&1 && set "PUBLICAR=1"
findstr /I /C:"apps-script/Api.gs"    "%TEMP%\wm_c2.txt" >nul 2>&1 && set "PUBLICAR=1"
findstr /I /C:"apps-script/Config.gs" "%TEMP%\wm_c2.txt" >nul 2>&1 && set "PUBLICAR=1"
del "%TEMP%\wm_c2.txt" >nul 2>&1

if defined PUBLICAR goto SIPUBLICAR
echo %VERDE%  Codigo actualizado. No hace falta publicar version:%FIN%
echo %VERDE%  no cambiaste nada que use el dashboard.%FIN%
echo.
call :LOGO
exit /b 0

:SIPUBLICAR
echo   %ROJO%!  FALTA PUBLICAR VERSION%FIN%
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
call :LOGO
exit /b 0

:NOSEQUE
echo   Codigo actualizado.
echo.
echo   No pude revisar que archivos cambiaron ^(no hay git^).
echo   Regla: solo hay que publicar version si tocaste
echo   WebAPI.gs, Auth.gs, Sync.gs, Api.gs o Config.gs.
echo.
call :LOGO
exit /b 0

:NOCONFIG
echo   %ROJO%x  NO ENCUENTRO .clasp.json%FIN%
echo.
echo      Corre primero 1-INSTALAR-CLASP.bat
echo.
pause
exit /b 1

:NOSCRIPTID
echo   %ROJO%x  FALTA EL SCRIPT ID EN .clasp.json%FIN%
echo.
echo      Abrelo con el Bloc de notas y reemplaza
echo      PON_AQUI_TU_SCRIPT_ID con el ID de tu proyecto.
echo      Sale de la URL del editor, entre /projects/ y /edit
echo.
pause
exit /b 1

:PUSHFAIL
echo.
echo   %AZUL%----------------------------------------------------%FIN%
echo.
echo   %ROJO%x  FALLO EL PUSH%FIN%
echo.
echo      "User has not enabled the Apps Script API"
echo         script.google.com/home/usersettings
echo         prende "Google Apps Script API"
echo.
echo      "Invalid credentials" o "not logged in"
echo         corre 1-INSTALAR-CLASP.bat
echo.
echo      "Cannot read properties of undefined ^(access_token^)"
echo      o "invalid_grant" - caduco tu sesion de clasp:
echo         del "%%USERPROFILE%%\.clasprc.json"
echo         1-INSTALAR-CLASP.bat
echo         entra con la cuenta victor.walmart.04
echo.
pause
exit /b 1

:LOGO
REM --- Logo animado ---
REM Va ANTES del pause: se dibuja solo, al terminar el trabajo.
REM La tecla queda libre para cerrar la ventana.
REM Solo en salidas exitosas.
REM Si falta node o el .js, no pasa nada: se salta en silencio.
where node >nul 2>&1
if errorlevel 1 goto SINLOGO
if not exist "%~dp0logo-animado.js" goto SINLOGO
REM SIN cls: el logo se dibuja DEBAJO del reporte, no encima.
REM Argumentos: movimiento color segundos alto-en-filas
REM   segundos 0 = gira hasta que se presione una tecla.
REM   El propio .js imprime el aviso y espera la tecla, por eso
REM   aqui ya NO hay pause: haria falta presionar dos veces.
node "%~dp0logo-animado.js" giro marca 0 12
goto :eof

:SINLOGO
REM Sin node o sin el .js, el pause de siempre.
pause
goto :eof
