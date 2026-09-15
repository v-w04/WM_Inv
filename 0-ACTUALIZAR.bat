@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Actualizar desde GitHub

echo.
echo   ACTUALIZAR                        bajar de GitHub
echo   ----------------------------------------------------
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

echo   [1/2]  Cambios locales sin subir . . . . .
"!GIT!" diff-index --quiet HEAD -- 2>nul
if errorlevel 1 goto HAYLOCALES
echo          ninguno
goto BAJAR

:HAYLOCALES
echo          SI hay
echo.
"!GIT!" status --short
echo.
echo   !  TIENES CAMBIOS SIN SUBIR
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

echo   [2/2]  Bajando de origin . . . . . . . . .
echo.
"!GIT!" pull origin main
if errorlevel 1 goto PULLFAIL

set "DESPUES="
"!GIT!" rev-parse HEAD > "%TEMP%\wm_despues.txt" 2>nul
if exist "%TEMP%\wm_despues.txt" set /p DESPUES=<"%TEMP%\wm_despues.txt"
del "%TEMP%\wm_despues.txt" >nul 2>&1

echo.
echo   ----------------------------------------------------
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
pause
exit /b 0

:PULLFAIL
echo.
echo   ----------------------------------------------------
echo.
echo   x  FALLO LA BAJADA
echo.
echo      Si dice "conflict" o "would be overwritten",
echo      editaste el mismo archivo en las dos computadoras.
echo      Abre GitHub Desktop: ahi se resuelve mas facil.
echo.
pause
exit /b 1
