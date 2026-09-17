@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Verificar entorno

echo.
echo   VERIFICAR                      estado de esta PC
echo   ----------------------------------------------------
echo.

set FALTA=0

echo   [1/5]  Node.js . . . . . . . . . . . . . .
where node >nul 2>&1
if errorlevel 1 (
    echo          NO instalado
    set FALTA=1
) else (
    for /f "tokens=*" %%V in ('node --version') do echo          %%V
)
echo.

echo   [2/5]  clasp . . . . . . . . . . . . . . .
where clasp >nul 2>&1
if errorlevel 1 (
    echo          NO instalado
    set FALTA=1
) else (
    for /f "tokens=*" %%V in ('clasp --version') do echo          %%V
)
echo.

echo   [3/5]  Sesion de Google . . . . . . . . . .
if exist "%USERPROFILE%\.clasprc.json" (
    echo          iniciada
) else (
    if exist ".clasprc.json" (
        echo          iniciada ^(token local^)
    ) else (
        echo          NO iniciada
        set FALTA=1
    )
)
echo.

echo   [4/5]  .clasp.json . . . . . . . . . . . .
if not exist ".clasp.json" (
    echo          NO existe
    set FALTA=1
    goto PASO5
)
findstr /C:"PON_AQUI" .clasp.json >nul 2>&1
if not errorlevel 1 (
    echo          existe, pero le falta el scriptId
    set FALTA=1
) else (
    echo          con scriptId
)

:PASO5
echo.
echo   [5/5]  Archivos en apps-script . . . . . .
if not exist "apps-script" (
    echo          NO existe la carpeta
    set FALTA=1
    goto RESUMEN
)
set N=0
for %%F in (apps-script\*.gs) do set /a N+=1
echo          !N! archivos .gs
echo.
for %%F in (apps-script\*.gs) do echo            %%~nxF

:RESUMEN
echo.
echo   ----------------------------------------------------
echo.
if "!FALTA!"=="1" (
    echo   !  FALTA ALGO
    echo.
    echo      Revisa arriba que dice "NO". Casi todo se
    echo      arregla corriendo 1-INSTALAR-CLASP.bat
) else (
    echo   Todo en orden. Puedes usar 5-SUBIR-TODO.bat
)
echo.
pause
call :LOGO
exit /b 0

:LOGO
REM --- Logo animado ---
REM Va DESPUES del pause a proposito: el logo hace cls, y si corriera
REM antes borraria el reporte que la usuaria acaba de leer (incluido
REM el aviso de publicar version). Solo en salidas exitosas.
REM Si falta node o el .js, no pasa nada: se salta en silencio.
where node >nul 2>&1
if errorlevel 1 goto :eof
if not exist "%~dp0logo-animado.js" goto :eof
cls
REM El tercer argumento son SEGUNDOS. Sin el, la animacion
REM corre para siempre y deja la ventana colgada.
node "%~dp0logo-animado.js" giro marca 5
goto :eof
