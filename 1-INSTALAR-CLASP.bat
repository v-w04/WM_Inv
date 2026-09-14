@echo off
cd /d "%~dp0"
title Instalar clasp

echo.
echo  =======================================================
echo    INSTALACION DE CLASP - se hace UNA SOLA VEZ
echo  =======================================================
echo.

echo  [1/3] Revisando Node.js...
where node >nul 2>&1
if errorlevel 1 goto NONODE
node --version
echo.

echo  [2/3] Instalando clasp...
call npm install -g @google/clasp
if errorlevel 1 goto NPMFAIL
echo  clasp instalado.
echo.

echo  [3/3] Autorizando tu cuenta de Google...
echo.
echo  Se abrira tu navegador.
echo  Inicia sesion con la MISMA cuenta donde esta tu Apps Script.
echo.
pause
call clasp login
echo.

echo  =======================================================
echo    LISTO
echo  =======================================================
echo.
REM Antes aqui salia SIEMPRE "pon tu scriptId en .clasp.json",
REM incluso cuando el archivo ya lo tenia. En una reinstalacion
REM (por ejemplo cuando caduca el token de clasp) eso manda a
REM buscar un problema que no existe. Ahora solo avisa si falta.
if not exist ".clasp.json" goto SINID
findstr /C:"PON_AQUI" .clasp.json >nul 2>&1
if not errorlevel 1 goto SINID
goto CONID

:SINID
echo  FALTA UNA COSA:
echo.
echo  Pon tu scriptId en el archivo .clasp.json
echo  Lo sacas de la URL del editor de Apps Script,
echo  entre /projects/ y /edit
echo.
goto APIAVISO

:CONID
echo  Tu .clasp.json ya trae el scriptId. Nada que editar ahi.
echo.

:APIAVISO
echo  Si es la PRIMERA vez en esta computadora, activa tambien
echo  la Apps Script API:
echo.
echo     https://script.google.com/home/usersettings
echo     Prende el switch "Google Apps Script API"
echo.
echo  Si ya la tenias activa, ignora esto.
echo.
echo  Ya puedes usar 5-SUBIR-TODO.bat como siempre.
echo.
pause
exit /b 0

:NONODE
echo.
echo  ERROR: No tienes Node.js instalado.
echo.
echo  Descargalo de https://nodejs.org
echo  Elige la version LTS y dale siguiente-siguiente.
echo  Cuando termine, vuelve a correr este archivo.
echo.
pause
exit /b 1

:NPMFAIL
echo.
echo  ERROR: Fallo la instalacion de clasp.
echo.
echo  Intenta asi: click derecho en este archivo
echo  y elige "Ejecutar como administrador"
echo.
pause
exit /b 1
