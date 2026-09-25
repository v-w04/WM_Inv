@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Subir a GitHub

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
echo   SUBIR A GITHUB                     solo el frontend
echo   %AZUL%----------------------------------------------------%FIN%
echo.

REM ================= SEGURO ANTI-CREDENCIALES =================
REM El repo es publico y git guarda el historial para siempre.
echo   %AZUL%[1/4]%FIN%  Credenciales en el codigo . . . . .
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

set "GIT=git"
where git >nul 2>&1
if not errorlevel 1 goto GOTGIT

for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
)
if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"
if "!GIT!"=="git" goto NOGIT

:GOTGIT
REM Candado huerfano de un git que murio a medias.
del /f /q ".git\index.lock" ".git\HEAD.lock" ".git\config.lock" >nul 2>&1
del /f /q ".git\objects\maintenance.lock" >nul 2>&1
del /f /q ".git\refs\heads\*.lock" >nul 2>&1

echo   %AZUL%[2/4]%FIN%  Estado del repositorio . . . . . .
"!GIT!" status --short >nul 2>&1
if errorlevel 1 goto NOTREPO

REM diff-index devuelve 0 si NO hay cambios en archivos rastreados.
REM Arbol limpio NO quiere decir "nada que subir": puede haber
REM commits hechos y sin push. Si el bat se va ahi, la version se
REM queda atorada en esta compu.
set CAMBIOS=1
"!GIT!" diff-index --quiet HEAD -- 2>nul
if not errorlevel 1 (
    "!GIT!" ls-files --others --exclude-standard >"%TEMP%\wm_n4.txt" 2>nul
    for %%F in ("%TEMP%\wm_n4.txt") do if %%~zF EQU 0 set CAMBIOS=0
    del "%TEMP%\wm_n4.txt" >nul 2>&1
)
set PENDIENTES=0
"!GIT!" rev-list --count @{u}..HEAD > "%TEMP%\wm_p4.txt" 2>nul
if exist "%TEMP%\wm_p4.txt" set /p PENDIENTES=<"%TEMP%\wm_p4.txt"
del "%TEMP%\wm_p4.txt" >nul 2>&1
if not defined PENDIENTES set PENDIENTES=0
if "!CAMBIOS!"=="0" (
    if "!PENDIENTES!"=="0" goto SINCAMBIOS
    "!GIT!" push -q origin main
    if errorlevel 1 goto PUSHFAIL
    goto VERIFICA
)
echo.
echo.
"!GIT!" status --short
echo.

echo   %AZUL%[3/4]%FIN%  Commit
echo.
set "MSG="
set /p "MSG=   Mensaje [Enter = automatico]: "
if "!MSG!"=="" set "MSG=Actualiza dashboard de inventario Walmart"
echo.
"!GIT!" add -A
if errorlevel 1 goto FAIL
"!GIT!" commit -q -m "!MSG!" -m "Co-Authored-By: Claude Opus 5 ^<noreply@anthropic.com^>"
if errorlevel 1 goto FAIL
echo.

echo   %AZUL%[4/4]%FIN%  Subiendo a origin . . . . . . . . .
echo.
"!GIT!" push -q origin main
if errorlevel 1 goto PUSHFAIL

:VERIFICA
REM El verde se apoya en la realidad: HEAD local contra HEAD remoto.
set LOCAL=
set REMOTO=
"!GIT!" rev-parse HEAD > "%TEMP%\wm_l4.txt" 2>nul
if exist "%TEMP%\wm_l4.txt" set /p LOCAL=<"%TEMP%\wm_l4.txt"
del "%TEMP%\wm_l4.txt" >nul 2>&1
"!GIT!" ls-remote origin main > "%TEMP%\wm_r4.txt" 2>nul
if exist "%TEMP%\wm_r4.txt" set /p REMOTO=<"%TEMP%\wm_r4.txt"
del "%TEMP%\wm_r4.txt" >nul 2>&1
if not defined LOCAL goto NOCUADRA
if not defined REMOTO goto NOCUADRA
if /i not "!LOCAL:~0,10!"=="!REMOTO:~0,10!" goto NOCUADRA
echo          subido y verificado
goto SIGUE
:SINCAMBIOS
echo          sin cambios
:SIGUE

echo.
echo   %AZUL%----------------------------------------------------%FIN%
echo.
echo %VERDE%  GitHub al dia.%FIN%
echo.
echo.
call :LOGO
exit /b 0

:FUGADETECTADA
echo          ALERTA
echo.
echo   %AZUL%----------------------------------------------------%FIN%
echo.
echo   %ROJO%x  DETENIDO - POSIBLE CREDENCIAL EN Auth.gs%FIN%
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

:NOGIT
echo   %ROJO%x  NO ENCUENTRO GIT%FIN%
echo.
echo      Instalalo de git-scm.com/download/win
echo      o usa GitHub Desktop.
echo.
pause
exit /b 1

:NOTREPO
echo          NO es un repositorio
echo.
echo   %ROJO%x  Esta carpeta no es un repo de git.%FIN%
echo      Abre GitHub Desktop y agregala.
echo.
pause
exit /b 1

:PUSHFAIL
echo.
echo   %AZUL%----------------------------------------------------%FIN%
echo.
echo   %ROJO%x  FALLO EL PUSH%FIN%
echo.
echo      "Authentication failed"
echo         abre GitHub Desktop una vez para renovar sesion
echo      "rejected - non-fast-forward"
echo         alguien subio cambios: corre 0-ACTUALIZAR.bat
echo      "src refspec main does not match any"
echo         tu rama quiza se llama master - avisame
echo.
pause
exit /b 1

:FAIL
echo.
echo   %ROJO%x  Revisa el mensaje de arriba.%FIN%
echo.
pause
exit /b 1

:NOCUADRA
echo.
echo   %ROJO%x  NO PUDE CONFIRMAR QUE SUBIO%FIN%
echo      Revisalo en GitHub Desktop antes de seguir.
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
