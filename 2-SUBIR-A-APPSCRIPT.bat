@echo off
chcp 65001 >nul
cd /d "%~dp0"
color 0B
title Subir codigo a Apps Script

echo.
echo  ═══════════════════════════════════════════════════════
echo    SUBIENDO CODIGO A APPS SCRIPT
echo  ═══════════════════════════════════════════════════════
echo.

if not exist ".clasp.json" (
    color 0C
    echo  ❌ No encuentro el archivo .clasp.json
    echo.
    echo     Corre primero:  1-INSTALAR-CLASP.bat
    echo     Y asegurate de haber puesto tu scriptId ahi dentro.
    echo.
    pause
    exit /b 1
)

findstr /C:"PON_AQUI" .clasp.json >nul 2>&1
if not errorlevel 1 (
    color 0E
    echo  ⚠  Todavia no pusiste tu scriptId en .clasp.json
    echo.
    echo     Abrelo con el Bloc de notas y reemplaza PON_AQUI_TU_SCRIPT_ID
    echo     con el ID que sale en la URL de tu proyecto:
    echo.
    echo     script.google.com/home/projects/[ESTE_ES_EL_ID]/edit
    echo.
    pause
    exit /b 1
)

call clasp push --force

if errorlevel 1 (
    color 0C
    echo.
    echo  ❌ Algo fallo. Revisa el mensaje de arriba.
    echo.
    echo     Errores comunes:
    echo     · "User has not enabled the Apps Script API"
    echo        - Ve a script.google.com/home/usersettings y prende el switch
    echo     · "Invalid credentials" o "not logged in"
    echo        - Vuelve a correr 1-INSTALAR-CLASP.bat
    echo     · "script not found"
    echo        - Revisa que el scriptId en .clasp.json este bien
    echo.
    pause
    exit /b 1
)

color 0A
echo.
echo  ═══════════════════════════════════════════════════════
echo    ✅ CODIGO ACTUALIZADO EN APPS SCRIPT
echo  ═══════════════════════════════════════════════════════
echo.
echo    ⚠  IMPORTANTE - para que la URL del dashboard use
echo       el codigo nuevo, todavia falta publicar la version:
echo.
echo       En el editor de Apps Script:
echo       Implementar , Administrar implementaciones ,
echo       icono de lapiz , Version: "Nueva version" , Implementar
echo.
echo       (Si solo vas a correr funciones desde el editor,
echo        no necesitas hacer eso.)
echo.
pause
