@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Subir a Apps Script

echo.
echo  =======================================================
echo    SUBIENDO CODIGO A APPS SCRIPT
echo  =======================================================
echo.

if not exist ".clasp.json" goto NOCONFIG

findstr /C:"PON_AQUI" .clasp.json >nul 2>&1
if not errorlevel 1 goto NOSCRIPTID

echo  Archivos a subir desde la carpeta apps-script:
echo.
dir /b apps-script\*.gs
dir /b apps-script\appsscript.json
echo.
echo  -------------------------------------------------------
echo.

call clasp push --force
if errorlevel 1 goto PUSHFAIL

echo.
echo  =======================================================
echo    CODIGO ACTUALIZADO EN APPS SCRIPT
echo  =======================================================
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
echo  No hace falta publicar version: no cambiaste codigo
echo  que use el dashboard. Ya puedes cerrar.
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
echo    Implementar
echo    Administrar implementaciones
echo    icono de lapiz
echo    Version: Nueva version
echo    Implementar
echo.
echo  Edita la que YA existe. No le des "Nueva implementacion".
echo.
pause
exit /b 0

:NOSEQUE
REM Sin git no hay forma de saber que cambio. Se dice tal cual,
REM en vez de soltar un recordatorio generico.
echo  No pude revisar que archivos cambiaron (no encuentro git).
echo.
echo  Regla: solo hay que publicar version si tocaste
echo  WebAPI.gs, Auth.gs, Sync.gs, Api.gs o Config.gs.
echo.
pause
exit /b 0

:NOCONFIG
echo  ERROR: No encuentro el archivo .clasp.json
echo.
echo  Corre primero 1-INSTALAR-CLASP.bat
echo.
pause
exit /b 1

:NOSCRIPTID
echo  FALTA: todavia no pusiste tu scriptId en .clasp.json
echo.
echo  Abre .clasp.json con el Bloc de notas.
echo  Reemplaza PON_AQUI_TU_SCRIPT_ID con el ID de tu proyecto.
echo.
echo  El ID sale de la URL del editor de Apps Script,
echo  entre /projects/ y /edit
echo.
pause
exit /b 1

:PUSHFAIL
echo.
echo  ERROR: fallo el push. Revisa el mensaje de arriba.
echo.
echo  Errores comunes:
echo.
echo  - "User has not enabled the Apps Script API"
echo    Ve a script.google.com/home/usersettings
echo    y prende el switch de Google Apps Script API
echo.
echo  - "Invalid credentials" o "not logged in"
echo    Vuelve a correr 1-INSTALAR-CLASP.bat
echo.
echo  - "Cannot read properties of undefined ^(access_token^)"
echo    o "invalid_grant": caduco tu sesion de clasp.
echo    Borra el token viejo y vuelve a entrar:
echo.
echo       del "%%USERPROFILE%%\.clasprc.json"
echo       1-INSTALAR-CLASP.bat
echo.
echo    Entra con la cuenta victor.walmart.04
echo.
echo  - "script not found" o "Requested entity was not found"
echo    Revisa que el scriptId en .clasp.json este correcto
echo.
pause
exit /b 1
