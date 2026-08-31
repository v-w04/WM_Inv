@echo off
cd /d "%~dp0"
title Subir a Apps Script

echo.
echo  =======================================================
echo    SUBIENDO CODIGO A APPS SCRIPT
echo  =======================================================
echo.

if not exist ".clasp.json" goto NOCONFIG

findstr /C:"PON_AQUI" .clasp.json >nul 2>&1
if not errorlevel 1 goto NOSCRIPTID

echo  Archivos a subir desde la carpeta apps-script:
echo.
dir /b apps-script\*.gs
dir /b apps-script\appsscript.json
echo.
echo  -------------------------------------------------------
echo.

call clasp push --force
if errorlevel 1 goto PUSHFAIL

echo.
echo  =======================================================
echo    CODIGO ACTUALIZADO EN APPS SCRIPT
echo  =======================================================
echo.
echo  Si solo vas a correr funciones desde el editor,
echo  ya puedes cerrar esta ventana.
echo.
echo  Si quieres que la URL del dashboard use el codigo nuevo,
echo  falta publicar la version. En el editor de Apps Script:
echo.
echo    Implementar
echo    Administrar implementaciones
echo    icono de lapiz
echo    Version: Nueva version
echo    Implementar
echo.
pause
exit /b 0

:NOCONFIG
echo  ERROR: No encuentro el archivo .clasp.json
echo.
echo  Corre primero 1-INSTALAR-CLASP.bat
echo.
pause
exit /b 1

:NOSCRIPTID
echo  FALTA: todavia no pusiste tu scriptId en .clasp.json
echo.
echo  Abre .clasp.json con el Bloc de notas.
echo  Reemplaza PON_AQUI_TU_SCRIPT_ID con el ID de tu proyecto.
echo.
echo  El ID sale de la URL del editor de Apps Script,
echo  entre /projects/ y /edit
echo.
pause
exit /b 1

:PUSHFAIL
echo.
echo  ERROR: fallo el push. Revisa el mensaje de arriba.
echo.
echo  Errores comunes:
echo.
echo  - "User has not enabled the Apps Script API"
echo    Ve a script.google.com/home/usersettings
echo    y prende el switch de Google Apps Script API
echo.
echo  - "Invalid credentials" o "not logged in"
echo    Vuelve a correr 1-INSTALAR-CLASP.bat
echo.
echo  - "script not found" o "Requested entity was not found"
echo    Revisa que el scriptId en .clasp.json este correcto
echo.
pause
exit /b 1
