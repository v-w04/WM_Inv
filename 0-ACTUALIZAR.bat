@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Actualizar desde GitHub

REM ---- Color de marca ----
REM CMD de Windows 10+ entiende color de 24 bits, pero necesita el
REM caracter ESC y no hay forma de escribirlo literal en un .bat sin
REM romper el ASCII puro. Este truco lo saca de la variable de prompt.
REM Si falla, AZUL y FIN quedan vacios y todo sale en texto normal:
REM nunca se imprimen codigos sueltos en pantalla.
set "ESC="
for /f %%E in ('echo prompt $E ^| cmd') do set "ESC=%%E"
set "AZUL="
set "ROJO="
set "FIN="
if defined ESC set "AZUL=%ESC%[38;2;31;148;249m"
if defined ESC set "ROJO=%ESC%[38;2;248;81;73m"
if defined ESC set "FIN=%ESC%[0m"

echo.
echo   ACTUALIZAR                        bajar de GitHub
echo   %AZUL%----------------------------------------------------%FIN%
echo.
echo   Corre esto al llegar a una computadora, sobre todo si
echo   trabajaste en otra la ultima vez.
echo.

set "GIT=git"
where git >nul 2>&1
if not errorlevel 1 goto GOTGIT

for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
)
if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"

if "!GIT!"=="git" (
    echo   x  NO ENCUENTRO GIT
    echo      Abre GitHub Desktop y dale Fetch + Pull.
    echo.
    pause
    exit /b 1
)

:GOTGIT
REM Candado huerfano: si un git anterior murio a medias, queda
REM .git\index.lock y TODO git se niega a correr con
REM "Another git process seems to be running". Se limpia solo.
if exist ".git\index.lock" (
    del /f /q ".git\index.lock" >nul 2>&1
)

echo   %AZUL%[1/2]%FIN%  Cambios locales sin subir . . . . .
"!GIT!" diff-index --quiet HEAD -- 2>nul
if errorlevel 1 goto HAYLOCALES
echo          ninguno
goto BAJAR

:HAYLOCALES
echo          SI hay
echo.
"!GIT!" status --short
echo.
echo   %ROJO%!  TIENES CAMBIOS SIN SUBIR%FIN%
echo      Si bajas ahora, git va a intentar mezclarlos.
echo      Para subirlos primero: cierra esto y corre
echo      5-SUBIR-TODO.bat
echo.
pause
echo.

:BAJAR
REM Se guarda donde estabamos para poder decir despues QUE bajo.
REM Archivo temporal a proposito: "for /f" con pipe truena cuando
REM la ruta de git trae espacios (el git de GitHub Desktop).
set "ANTES="
"!GIT!" rev-parse HEAD > "%TEMP%\wm_antes.txt" 2>nul
if exist "%TEMP%\wm_antes.txt" set /p ANTES=<"%TEMP%\wm_antes.txt"
del "%TEMP%\wm_antes.txt" >nul 2>&1

echo   %AZUL%[2/2]%FIN%  Bajando de origin . . . . . . . . .
echo.
"!GIT!" pull origin main
if errorlevel 1 goto PULLFAIL

set "DESPUES="
"!GIT!" rev-parse HEAD > "%TEMP%\wm_despues.txt" 2>nul
if exist "%TEMP%\wm_despues.txt" set /p DESPUES=<"%TEMP%\wm_despues.txt"
del "%TEMP%\wm_despues.txt" >nul 2>&1

echo.
echo   %AZUL%----------------------------------------------------%FIN%
echo.

if not defined ANTES   goto FINOK
if not defined DESPUES goto FINOK
if "!ANTES!"=="!DESPUES!" (
    echo   Ya estabas al dia. No habia nada nuevo.
    echo.
    goto FINOK
)

echo   Commits que bajaron
echo.
"!GIT!" log --oneline !ANTES!..!DESPUES!
echo.
echo   Archivos que cambiaron
echo.
"!GIT!" diff --name-only !ANTES! !DESPUES!
echo.
echo   Si arriba aparece algo de apps-script\ NO tienes que
echo   volver a subirlo: ese codigo ya esta en Apps Script
echo   desde la otra computadora. Esto solo puso al dia tu
echo   copia local.
echo.

:FINOK
echo   Listo para trabajar.
echo.
call :LOGO
exit /b 0

:PULLFAIL
echo.
echo   %AZUL%----------------------------------------------------%FIN%
echo.
echo   %ROJO%x  FALLO LA BAJADA%FIN%
echo.
echo      Si dice "conflict" o "would be overwritten",
echo      editaste el mismo archivo en las dos computadoras.
echo      Abre GitHub Desktop: ahi se resuelve mas facil.
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
