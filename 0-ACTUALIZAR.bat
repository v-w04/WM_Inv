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

echo.
echo  [2/2] Bajando de origin...
"!GIT!" pull origin main
if errorlevel 1 goto PULLFAIL

echo.
echo  =======================================================
echo    ACTUALIZADO
echo  =======================================================
echo.
echo  Ya tienes la ultima version. Puedes empezar a trabajar.
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
