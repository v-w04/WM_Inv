@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Instalar clasp

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
echo   INSTALAR CLASP                 una sola vez por PC
echo   %AZUL%----------------------------------------------------%FIN%
echo.

echo   %AZUL%[1/3]%FIN%  Node.js . . . . . . . . . . . . . .
where node >nul 2>&1
if errorlevel 1 goto NONODE
for /f "tokens=*" %%V in ('node --version') do echo          %%V
echo.

echo   %AZUL%[2/3]%FIN%  Instalando clasp . . . . . . . . . .
call npm install -g @google/clasp >nul 2>"%TEMP%\wm_e.txt"
if errorlevel 1 goto NPMFAIL
echo          ok

echo   %AZUL%[3/3]%FIN%  Cuenta de Google . . . . . . . . . .
call clasp login
if errorlevel 1 goto LOGINFAIL
if not exist "%USERPROFILE%\.clasprc.json" goto LOGINFAIL
echo          ok

echo   %AZUL%----------------------------------------------------%FIN%
echo.

REM Antes aqui salia SIEMPRE "pon tu scriptId en .clasp.json",
REM incluso cuando el archivo ya lo tenia. En una reinstalacion
REM (por ejemplo cuando caduca el token) eso manda a buscar un
REM problema que no existe. Ahora solo avisa si de verdad falta.
if not exist ".clasp.json" goto SINID
findstr /C:"PON_AQUI" .clasp.json >nul 2>&1
if not errorlevel 1 goto SINID

echo %VERDE%  .clasp.json    ya trae el scriptId%FIN%
goto APIAVISO

:SINID
echo   %ROJO%^^!  FALTA EL SCRIPT ID%FIN%
echo.
echo      Ponlo en .clasp.json. Sale de la URL del editor
echo      de Apps Script, entre  /projects/  y  /edit
echo.

:APIAVISO
echo   Apps Script API: script.google.com/home/usersettings
echo.
echo   %AZUL%----------------------------------------------------%FIN%
echo.
echo %VERDE%  clasp listo.%FIN%
echo.
call :LOGO
exit /b 0

:NONODE
echo          NO instalado
echo.
echo   %ROJO%x  FALTA NODE.JS%FIN%
echo      Instala la version LTS de https://nodejs.org y vuelve a correr esto.
echo.
pause
exit /b 1

:NPMFAIL
type "%TEMP%\wm_e.txt"
echo.
echo   %ROJO%x  FALLO LA INSTALACION DE CLASP%FIN%
echo      Corre este archivo como administrador.
echo.
pause
exit /b 1

:LOGINFAIL
echo.
echo   %ROJO%x  NO SE AUTORIZO LA CUENTA DE GOOGLE%FIN%
echo      Vuelve a correr este archivo y entra con la cuenta del Apps Script.
echo.
pause
exit /b 1

:LOGO
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
