@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Subir todo

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
echo   SUBIR TODO                    Apps Script + GitHub
echo   %AZUL%----------------------------------------------------%FIN%
echo.

REM ================= SEGURO ANTI-CREDENCIALES =================
REM El repo es publico y git guarda el historial para siempre.
REM Si quedo una credencial real en un .gs hay que detenerlo
REM ANTES del commit, no despues.
echo   %AZUL%[1/3]%FIN%  Credenciales en el codigo . . . . .
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
echo   %AZUL%[2/3]%FIN%  Apps Script . . . . . . . . . . . .
echo.
if not exist ".clasp.json" (
    echo          sin .clasp.json - saltado
    goto GITPART
)
if not exist "apps-script\appsscript.json" goto VACIA
call clasp push --force >nul 2>"%TEMP%\wm_clasp.txt"
if errorlevel 1 goto CLASPFAIL
echo.
echo          subido
echo.
goto GITPART

:VACIA
echo   %ROJO%x  apps-script VACIA - no se subio nada%FIN%
echo.
pause
exit /b 1

:CLASPFAIL
echo.
echo   %ROJO%^^!  FALLO EL PUSH A APPS SCRIPT%FIN%
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
echo   %AZUL%[3/3]%FIN%  GitHub . . . . . . . . . . . . . .

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
del /f /q ".git\index.lock" ".git\HEAD.lock" ".git\config.lock" >nul 2>&1
del /f /q ".git\objects\maintenance.lock" >nul 2>&1
del /f /q ".git\refs\heads\*.lock" >nul 2>&1

REM Arbol limpio NO quiere decir "nada que subir": puede haber
REM commits hechos y sin push. Si el bat se va ahi, la version se
REM queda atorada en esta compu.
set CAMBIOS=1
"!GIT!" diff-index --quiet HEAD -- 2>nul
if not errorlevel 1 (
    "!GIT!" ls-files --others --exclude-standard >"%TEMP%\wm_n5.txt" 2>nul
    for %%F in ("%TEMP%\wm_n5.txt") do if %%~zF EQU 0 set CAMBIOS=0
    del "%TEMP%\wm_n5.txt" >nul 2>&1
)
set PENDIENTES=0
"!GIT!" rev-list --count @{u}..HEAD > "%TEMP%\wm_p5.txt" 2>nul
if exist "%TEMP%\wm_p5.txt" set /p PENDIENTES=<"%TEMP%\wm_p5.txt"
del "%TEMP%\wm_p5.txt" >nul 2>&1
if not defined PENDIENTES set PENDIENTES=0
REM Hace falta publicar version si cambio alguno de los archivos que
REM ejecuta el Web App. Se revisan las DOS fuentes: lo que esta sin
REM commitear Y lo que ya esta commiteado pero sin subir. Si solo se
REM miraba lo primero, un commit pendiente pasaba en verde sin avisar.
"!GIT!" status --porcelain > "%TEMP%\wm_cambios.txt" 2>nul
"!GIT!" diff --name-only @{u}..HEAD >> "%TEMP%\wm_cambios.txt" 2>nul
set "PUBLICAR="
findstr /I /C:"apps-script/WebAPI.gs" "%TEMP%\wm_cambios.txt" >nul 2>&1 && set "PUBLICAR=1"
findstr /I /C:"apps-script/Auth.gs"   "%TEMP%\wm_cambios.txt" >nul 2>&1 && set "PUBLICAR=1"
findstr /I /C:"apps-script/Sync.gs"   "%TEMP%\wm_cambios.txt" >nul 2>&1 && set "PUBLICAR=1"
findstr /I /C:"apps-script/Api.gs"    "%TEMP%\wm_cambios.txt" >nul 2>&1 && set "PUBLICAR=1"
findstr /I /C:"apps-script/Config.gs" "%TEMP%\wm_cambios.txt" >nul 2>&1 && set "PUBLICAR=1"
del "%TEMP%\wm_cambios.txt" >nul 2>&1

if "!CAMBIOS!"=="0" (
    if "!PENDIENTES!"=="0" goto SINCAMBIOS
    "!GIT!" push -q origin main
    if errorlevel 1 goto PUSHFAIL
    goto VERIFICA
)
echo.
"!GIT!" status --short
echo.

set "MSG="
set /p "MSG=   Mensaje del commit [Enter = automatico]: "
if "!MSG!"=="" set "MSG=Actualiza dashboard de inventario Walmart"
echo.

"!GIT!" add -A
if errorlevel 1 goto FAILGIT
"!GIT!" commit -q -m "!MSG!" -m "Co-Authored-By: Claude Opus 5 ^<noreply@anthropic.com^>"
if errorlevel 1 goto FAILGIT
"!GIT!" push -q origin main
if errorlevel 1 goto PUSHFAIL

:VERIFICA
REM El verde se apoya en la realidad: HEAD local contra HEAD remoto.
set LOCAL=
set REMOTO=
"!GIT!" rev-parse HEAD > "%TEMP%\wm_l5.txt" 2>nul
if exist "%TEMP%\wm_l5.txt" set /p LOCAL=<"%TEMP%\wm_l5.txt"
del "%TEMP%\wm_l5.txt" >nul 2>&1
"!GIT!" ls-remote origin main > "%TEMP%\wm_r5.txt" 2>nul
if exist "%TEMP%\wm_r5.txt" set /p REMOTO=<"%TEMP%\wm_r5.txt"
del "%TEMP%\wm_r5.txt" >nul 2>&1
if not defined LOCAL goto NOCUADRA
if not defined REMOTO goto NOCUADRA
if /i not "!LOCAL:~0,10!"=="!REMOTO:~0,10!" goto NOCUADRA
echo          subido y verificado
goto SIGUE
:SINCAMBIOS
echo          sin cambios
:SIGUE
echo.


:FIN
echo.
echo   %AZUL%----------------------------------------------------%FIN%
echo.

if defined PUBLICAR goto SIPUBLICAR
echo %VERDE%  No hace falta publicar version.%FIN%
echo.
call :LOGO
exit /b 0

:SIPUBLICAR
echo   %ROJO%^^!  FALTA PUBLICAR VERSION%FIN%
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

:PUSHFAIL
echo.
echo   %AZUL%----------------------------------------------------%FIN%
echo.
echo   %ROJO%x  FALLO EL PUSH A GITHUB%FIN%
echo.
echo      "Authentication failed"
echo         abre GitHub Desktop una vez para renovar sesion
echo      "rejected - non-fast-forward"
echo         alguien subio cambios: corre 0-ACTUALIZAR.bat
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

:FAILGIT
echo.
echo   %ROJO%x  FALLO EL COMMIT%FIN%
echo      Abre GitHub Desktop y revisa el repositorio.
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
