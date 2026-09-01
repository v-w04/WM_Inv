@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Subir a GitHub

echo.
echo  =======================================================
echo    SUBIENDO A GITHUB
echo  =======================================================
echo.

REM ---- Buscar git: primero en el PATH, luego el de GitHub Desktop ----
set "GIT=git"
where git >nul 2>&1
if not errorlevel 1 goto GOTGIT

echo  git no esta en el PATH, buscando el de GitHub Desktop...
for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
)
if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"

if "!GIT!"=="git" goto NOGIT
echo  Encontrado: !GIT!
echo.

:GOTGIT
echo  [1/4] Estado del repositorio
"!GIT!" status --short
if errorlevel 1 goto NOTREPO
echo.

REM ---- Ver si hay algo que subir ----
for /f %%C in ('"!GIT!" status --porcelain 2^>nul ^| find /c /v ""') do set CAMBIOS=%%C
if "!CAMBIOS!"=="0" (
    echo  No hay cambios que subir. Todo esta al dia.
    echo.
    pause
    exit /b 0
)
echo  Archivos con cambios: !CAMBIOS!
echo.

REM ---- Mensaje del commit ----
set "MSG="
set /p "MSG=  Mensaje del commit [Enter para uno automatico]: "
if "!MSG!"=="" set "MSG=Actualiza dashboard de inventario Walmart"
echo.

echo  [2/4] Agregando archivos
"!GIT!" add -A
if errorlevel 1 goto FAIL
echo.

echo  [3/4] Creando commit
"!GIT!" commit -m "!MSG!" -m "Co-Authored-By: Claude Opus 5 ^<noreply@anthropic.com^>"
if errorlevel 1 goto FAIL
echo.

echo  [4/4] Subiendo a origin
"!GIT!" push origin main
if errorlevel 1 goto PUSHFAIL

echo.
echo  =======================================================
echo    SUBIDO A GITHUB
echo  =======================================================
echo.
echo  Repo:      https://github.com/v-w04/WM_Inv
echo  Dashboard: https://v-w04.github.io/WM_Inv/
echo.
echo  GitHub Pages tarda 1-2 minutos en publicar el cambio.
echo.
pause
exit /b 0

:NOGIT
echo.
echo  ERROR: No encuentro git en tu sistema.
echo.
echo  Opcion A: instala Git desde https://git-scm.com/download/win
echo  Opcion B: usa GitHub Desktop como siempre
echo.
pause
exit /b 1

:NOTREPO
echo.
echo  ERROR: Esta carpeta no es un repositorio de git.
echo.
echo  Abre GitHub Desktop y agrega esta carpeta como repositorio.
echo.
pause
exit /b 1

:PUSHFAIL
echo.
echo  ERROR: fallo el push.
echo.
echo  Errores comunes:
echo.
echo  - "Authentication failed"
echo    Abre GitHub Desktop una vez para renovar tu sesion
echo.
echo  - "rejected - non-fast-forward"
echo    Alguien mas subio cambios. En GitHub Desktop
echo    dale Fetch origin y luego Pull, y vuelve a intentar
echo.
echo  - "src refspec main does not match any"
echo    Tu rama principal quiza se llama master.
echo    Avisame y ajusto el archivo.
echo.
pause
exit /b 1

:FAIL
echo.
echo  ERROR: revisa el mensaje de arriba.
echo.
pause
exit /b 1
