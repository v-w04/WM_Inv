@echo off
chcp 65001 >nul
cd /d "%~dp0"
color 0B
title Instalar clasp - solo una vez

echo.
echo  ═══════════════════════════════════════════════════════
echo    INSTALACION DE CLASP  (esto se hace UNA SOLA VEZ)
echo  ═══════════════════════════════════════════════════════
echo.

echo  [1/3] Revisando si tienes Node.js...
where node >nul 2>&1
if errorlevel 1 (
    color 0C
    echo.
    echo  ❌ No tienes Node.js instalado.
    echo.
    echo     Descargalo de:  https://nodejs.org
    echo     Elige la version "LTS" y dale siguiente-siguiente-siguiente.
    echo.
    echo     Cuando termine, vuelve a correr este archivo.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo       Node.js %%v encontrado.
echo.

echo  [2/3] Instalando clasp...
call npm install -g @google/clasp
if errorlevel 1 (
    color 0C
    echo.
    echo  ❌ Fallo la instalacion de clasp.
    echo     Intenta abrir esta ventana como Administrador:
    echo     click derecho en el archivo, "Ejecutar como administrador"
    echo.
    pause
    exit /b 1
)
echo       clasp instalado.
echo.

echo  [3/3] Autorizando tu cuenta de Google...
echo.
echo       Se va a abrir tu navegador.
echo       Inicia sesion con la MISMA cuenta donde esta tu Apps Script.
echo.
pause
call clasp login

echo.
echo  ═══════════════════════════════════════════════════════
echo    ✅ LISTO
echo  ═══════════════════════════════════════════════════════
echo.
echo    FALTAN 2 COSAS (una sola vez tambien):
echo.
echo    A) Activa la Apps Script API:
echo       https://script.google.com/home/usersettings
echo       Prende el switch "Google Apps Script API"
echo.
echo    B) Pon tu scriptId en el archivo .clasp.json
echo       Lo sacas de la URL de tu proyecto:
echo       script.google.com/home/projects/[ESTE_ES]/edit
echo.
echo    Ya con eso, usa  2-SUBIR-A-APPSCRIPT.bat  cada vez.
echo.
pause
