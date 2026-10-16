@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
call _config.bat
title Subir todo

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
echo   SUBIR TODO                  Apps Script y GitHub
echo   %AZUL%----------------------------------------------------%FIN%
echo.

echo   %AZUL%[1/4]%FIN%  Credenciales en el codigo . . . . .
call _seguro.bat
if errorlevel 1 goto FUGADETECTADA
echo          limpio
call :COLUMNAS

call :BUSCARGIT
if errorlevel 1 set "PUBLICAR=?"
if not "!PUBLICAR!"=="?" call :REVISARVERSION

echo   %AZUL%[2/4]%FIN%  Apps Script . . . . . . . . . . . .
if not exist ".clasp.json" goto SINCLASP
REM clasp push --force con la carpeta vacia BORRA el proyecto.
if not exist "apps-script\appsscript.json" goto SINBACKEND
call clasp push --force >nul 2>"%TEMP%\wm_e.txt"
if errorlevel 1 goto CLASPFALLO
echo          ok
goto GITPART

:SINCLASP
echo          saltado
goto GITPART

:GITPART

echo   %AZUL%[3/4]%FIN%  Cambios por subir . . . . . . . . .
if not exist ".git" goto NOTREPO
"!GIT!" remote get-url origin >nul 2>&1
if errorlevel 1 goto NOORIGIN

REM Contar sin meter un pipe dentro del for: el git de GitHub Desktop vive
REM en una ruta con espacios y cmd parte la orden.
set "TMPST=%TEMP%\wm_c.txt"
"!GIT!" status --porcelain > "!TMPST!" 2>nul
set CAMBIOS=0
for /f %%C in ('find /c /v "" ^< "!TMPST!"') do set CAMBIOS=%%C
del "!TMPST!" >nul 2>&1

REM Arbol limpio NO quiere decir que no falte nada por subir: puede haber
REM commits hechos y sin push.
set PENDIENTES=0
"!GIT!" rev-list --count @{u}..HEAD > "%TEMP%\wm_p.txt" 2>nul
if exist "%TEMP%\wm_p.txt" set /p PENDIENTES=<"%TEMP%\wm_p.txt"
del "%TEMP%\wm_p.txt" >nul 2>&1
if not defined PENDIENTES set PENDIENTES=0

set "HUBO="
if "!CAMBIOS!"=="0" goto SINCAMBIOS
echo          !CAMBIOS! archivo^(s^)
echo.
set "MSG=%MSG_DEFAULT%"
echo.

echo   %AZUL%[4/4]%FIN%  Commit y push . . . . . . . . . . .
"!GIT!" add -A
if errorlevel 1 goto FAIL
"!GIT!" commit -q -m "!MSG!"
if errorlevel 1 goto COMMITFAIL
"!GIT!" push -q origin %GH_BRANCH%
if errorlevel 1 goto PUSHFAIL
set "HUBO=1"
goto VERIFICA

:SINCAMBIOS
echo          ninguno
echo   %AZUL%[4/4]%FIN%  Commit y push . . . . . . . . . . .
if "!PENDIENTES!"=="0" goto VERIFICA
"!GIT!" push -q origin %GH_BRANCH%
if errorlevel 1 goto PUSHFAIL
set "HUBO=1"

REM El push devolviendo 0 no prueba que GitHub quedo igual que la carpeta.
REM Se compara el commit de aqui contra el que de verdad tiene origin.
:VERIFICA
set LOCAL=
set REMOTO=
"!GIT!" rev-parse HEAD > "%TEMP%\wm_l.txt" 2>nul
if exist "%TEMP%\wm_l.txt" set /p LOCAL=<"%TEMP%\wm_l.txt"
del "%TEMP%\wm_l.txt" >nul 2>&1
"!GIT!" ls-remote origin %GH_BRANCH% > "%TEMP%\wm_r.txt" 2>nul
if exist "%TEMP%\wm_r.txt" set /p REMOTO=<"%TEMP%\wm_r.txt"
del "%TEMP%\wm_r.txt" >nul 2>&1
if not defined LOCAL goto NOCUADRA
if not defined REMOTO goto NOCUADRA
if /i not "!LOCAL:~0,10!"=="!REMOTO:~0,10!" goto NOCUADRA
if defined HUBO echo          subido y verificado
if not defined HUBO echo          al dia y verificado

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

:NOCUADRA
echo          %ROJO%no cuadra con GitHub%FIN%
echo.
echo   %ROJO%x  NO PUDE CONFIRMAR QUE SUBIO%FIN%
echo      Abre GitHub Desktop y revisa si quedo el ultimo commit.
echo.
pause
exit /b 1

:FAIL
echo          fallo
echo.
echo   %ROJO%x  FALLO GIT%FIN%
echo      Abre GitHub Desktop: ahi se ve que paso.
echo.
pause
exit /b 1

:COMMITFAIL
echo          fallo
echo.
echo   %ROJO%x  NO SE HIZO EL COMMIT%FIN%
echo      Nada se subio. Abre GitHub Desktop y revisa.
echo.
pause
exit /b 1

:PUSHFAIL
echo          fallo
echo.
echo   %ROJO%x  FALLO EL PUSH%FIN%
echo      Sin internet o sin permiso. Si alguien subio antes: 0-ACTUALIZAR.bat
echo.
pause
exit /b 1

:NOGIT
echo          sin git
echo.
echo   %ROJO%x  NO ENCUENTRO GIT%FIN%
echo      Instala GitHub Desktop o git-scm.com/download/win
echo.
pause
exit /b 1

:NOTREPO
echo          no es repo
echo.
echo   %ROJO%x  ESTA CARPETA NO ES UN REPOSITORIO%FIN%
echo      GitHub Desktop ^> File ^> Add local repository
echo.
pause
exit /b 1

:NOORIGIN
echo          sin origin
echo.
echo   %ROJO%x  EL REPO NO APUNTA A GITHUB%FIN%
echo      GitHub Desktop ^> Publish repository, y llena _config.bat
echo.
pause
exit /b 1

:FUGADETECTADA
echo.
echo   %ROJO%x  DETENIDO - POSIBLE CREDENCIAL EN EL CODIGO%FIN%
echo      Quitala del archivo; si ya se subio antes, rotala.
echo.
pause
exit /b 1

:LOGO
where node >nul 2>&1
if errorlevel 1 goto SINLOGO
if not exist "%~dp0logo-animado.js" goto SINLOGO
node "%~dp0logo-animado.js" giro marca 0 12
goto :eof

:SINLOGO
pause
goto :eof
