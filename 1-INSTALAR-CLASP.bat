@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Instalar clasp

echo.
echo   INSTALAR CLASP                 una sola vez por PC
echo   ----------------------------------------------------
echo.

echo   [1/3]  Node.js . . . . . . . . . . . . . .
where node >nul 2>&1
if errorlevel 1 goto NONODE
for /f "tokens=*" %%V in ('node --version') do echo          %%V
echo.

echo   [2/3]  Instalando clasp . . . . . . . . . .
echo.
call npm install -g @google/clasp
if errorlevel 1 goto NPMFAIL
echo.
echo          instalado
echo.

echo   [3/3]  Autorizando tu cuenta de Google . .
echo.
echo          Se abrira tu navegador. Entra con la MISMA
echo          cuenta donde vive el Apps Script.
echo.
pause
call clasp login
echo.

echo   ----------------------------------------------------
echo.

REM Antes aqui salia SIEMPRE "pon tu scriptId en .clasp.json",
REM incluso cuando el archivo ya lo tenia. En una reinstalacion
REM (por ejemplo cuando caduca el token) eso manda a buscar un
REM problema que no existe. Ahora solo avisa si de verdad falta.
if not exist ".clasp.json" goto SINID
findstr /C:"PON_AQUI" .clasp.json >nul 2>&1
if not errorlevel 1 goto SINID

echo   .clasp.json    ya trae el scriptId
goto APIAVISO

:SINID
echo   !  FALTA EL SCRIPT ID
echo.
echo      Ponlo en .clasp.json. Sale de la URL del editor
echo      de Apps Script, entre  /projects/  y  /edit
echo.

:APIAVISO
echo   Apps Script API   solo la primera vez en esta PC
echo                     script.google.com/home/usersettings
echo                     prende "Google Apps Script API"
echo.
echo   ----------------------------------------------------
echo.
echo   Ya puedes usar 5-SUBIR-TODO.bat como siempre.
echo.
pause
call :LOGO
exit /b 0

:NONODE
echo          NO instalado
echo.
echo   ----------------------------------------------------
echo.
echo   x  FALTA NODE.JS
echo.
echo      Bajalo de https://nodejs.org
echo      Elige la version LTS y dale siguiente-siguiente.
echo      Cuando termine, vuelve a correr este archivo.
echo.
pause
exit /b 1

:NPMFAIL
echo.
echo   ----------------------------------------------------
echo.
echo   x  FALLO LA INSTALACION DE CLASP
echo.
echo      Prueba asi: click derecho en este archivo y
echo      elige "Ejecutar como administrador".
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
REM SIN cls: el logo se dibuja DEBAJO del reporte, no encima.
REM Argumentos: movimiento color segundos alto-en-filas
REM El alto chico es lo que lo mantiene en su lugar; sin el,
REM ocupa la pantalla completa y tapa todo.
node "%~dp0logo-animado.js" giro marca 5 12
goto :eof
