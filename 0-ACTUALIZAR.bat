@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Actualizar desde GitHub

echo.
echo  =======================================================
echo    BAJANDO CAMBIOS DE GITHUB
echo  =======================================================
echo.
echo  Corre esto ANTES de empezar a trabajar, sobre todo si
echo  usaste otra computadora la ultima vez.
echo.

set "GIT=git"
where git >nul 2>&1
if not errorlevel 1 goto GOTGIT

for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
)
if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"

if "!GIT!"=="git" (
    echo  ERROR: no encuentro git. Usa GitHub Desktop y dale Fetch + Pull.
    echo.
    pause
    exit /b 1
)

:GOTGIT
REM Candado huerfano: si un git anterior murio a medias (o lo dejo abierto
REM otra herramienta), queda .git\index.lock y TODO git se niega a correr
REM con "Another git process seems to be running". Se limpia solo.
if exist ".git\index.lock" (
    echo  Limpiando candado de git que quedo colgado...
    del /f /q ".git\index.lock" >nul 2>&1
)

echo  [1/2] Revisando si tienes cambios sin subir...
"!GIT!" diff-index --quiet HEAD -- 2>nul
if errorlevel 1 (
    echo.
    echo  OJO: tienes cambios locales sin subir:
    echo.
    "!GIT!" status --short
    echo.
    echo  Si bajas ahora, git va a intentar mezclarlos.
    echo  Si prefieres subirlos primero, cierra esto y corre 5-SUBIR-TODO.bat
    echo.
    pause
)

REM Guardamos donde estabamos, para poder decir despues QUE bajo.
REM Se usa archivo temporal a proposito: "for /f" con pipe truena
REM cuando la ruta de git trae espacios (el git de GitHub Desktop).
set "ANTES="
"!GIT!" rev-parse HEAD > "%TEMP%\wm_antes.txt" 2>nul
if exist "%TEMP%\wm_antes.txt" set /p ANTES=<"%TEMP%\wm_antes.txt"
del "%TEMP%\wm_antes.txt" >nul 2>&1

echo.
echo  [2/2] Bajando de origin...
"!GIT!" pull origin main
if errorlevel 1 goto PULLFAIL

set "DESPUES="
"!GIT!" rev-parse HEAD > "%TEMP%\wm_despues.txt" 2>nul
if exist "%TEMP%\wm_despues.txt" set /p DESPUES=<"%TEMP%\wm_despues.txt"
del "%TEMP%\wm_despues.txt" >nul 2>&1

echo.
echo  =======================================================
echo    ACTUALIZADO
echo  =======================================================
echo.

if not defined ANTES   goto SINCOMPARAR
if not defined DESPUES goto SINCOMPARAR
if "!ANTES!"=="!DESPUES!" (
    echo  No habia nada nuevo. Ya estabas al dia.
    echo.
    goto FINOK
)

echo  Lo que bajo:
"!GIT!" log --oneline !ANTES!..!DESPUES!
echo.
echo  Archivos que cambiaron:
"!GIT!" diff --name-only !ANTES! !DESPUES!
echo.
echo  OJO: si arriba aparece algo de apps-script\ NO tienes que
echo  volver a subirlo. Ese codigo ya esta en Apps Script desde
echo  la otra computadora; esto solo puso tu copia local al dia.
echo.

:SINCOMPARAR
:FINOK
echo  Puedes empezar a trabajar.
echo.
pause
exit /b 0

:PULLFAIL
echo.
echo  ERROR al bajar los cambios.
echo.
echo  Si dice "conflict" o "would be overwritten":
echo  editaste el mismo archivo en las dos computadoras.
echo  Abre GitHub Desktop, ahi se resuelve mas facil.
echo.
pause
exit /b 1
