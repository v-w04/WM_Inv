@echo off
REM ============================================================
REM  Seguro anti-credenciales - lo llaman 3-, 4- y 5-
REM ============================================================
REM
REM  El repo puede ser publico y git guarda el historial PARA
REM  SIEMPRE. Una credencial subida no se quita borrandola en un
REM  commit posterior: hay que reescribir el historial y, aun asi,
REM  lo correcto es rotarla. Por eso se detiene ANTES del commit.
REM
REM  En este proyecto ninguna credencial deberia estar en un
REM  archivo: la cookie del sitio y el password del dashboard
REM  viven en PropertiesService. Si algo salta aqui, es que
REM  alguien pego un valor real "solo para probar".
REM
REM  Devuelve errorlevel 1 si encuentra algo sospechoso.
REM ============================================================

setlocal enabledelayedexpansion
set FUGA=0

REM ---- Archivos que nunca deben existir aqui ----
for %%F in (.env apps-script\Secrets.gs apps-script\Local.gs secretos.txt) do (
    if exist "%%F" (
        echo     ALERTA: existe el archivo %%F
        set FUGA=1
    )
)

REM ---- Auth.gs debe conservar sus placeholders (WM_Inv) ----
REM Las credenciales viven en PropertiesService. Si un placeholder ya no
REM esta, alguien pego un valor real en Auth.gs.
for %%P in (PON_TU_CLIENT_ID_AQUI PON_TU_CLIENT_SECRET_AQUI PON_TU_PASSWORD_AQUI) do (
    findstr /C:"%%P" apps-script\Auth.gs >nul 2>&1
    if errorlevel 1 (
        echo     ALERTA: Auth.gs ya no trae el placeholder %%P
        set FUGA=1
    )
)

REM ---- El .gitignore tiene que estar ----
if not exist ".gitignore" (
    echo     ALERTA: no hay .gitignore
    set FUGA=1
)

REM ---- Revision de patrones dentro del codigo ----
where powershell >nul 2>&1
if errorlevel 1 goto SINPOWERSHELL

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_seguro.ps1"
if errorlevel 1 set FUGA=1
goto FINAL

:SINPOWERSHELL
echo     AVISO: no hay PowerShell, revision de patrones omitida.
echo     Revisa a ojo que no haya credenciales antes de subir.

:FINAL
endlocal & exit /b %FUGA%
