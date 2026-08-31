@echo off
cd /d "%~dp0"
title Verificar configuracion de clasp

echo.
echo  =======================================================
echo    VERIFICACION
echo  =======================================================
echo.

echo  [1] Node.js
where node >nul 2>&1
if errorlevel 1 (echo      NO instalado) else (node --version)
echo.

echo  [2] clasp
where clasp >nul 2>&1
if errorlevel 1 (echo      NO instalado) else (call clasp --version)
echo.

echo  [3] Sesion de Google
if exist "%USERPROFILE%\.clasprc.json" (
  echo      Sesion iniciada - credenciales encontradas
) else (
  if exist ".clasprc.json" (
    echo      Sesion iniciada - credenciales locales
  ) else (
    echo      NO has iniciado sesion - corre 1-INSTALAR-CLASP.bat
  )
)
echo.

echo  [4] Archivo .clasp.json
if exist ".clasp.json" (type .clasp.json) else (echo      NO existe)
echo.

echo  [5] Archivos en apps-script
if exist "apps-script" (dir /b apps-script) else (echo      NO existe la carpeta)
echo.

echo  =======================================================
echo.
echo  Si todo lo de arriba se ve bien,
echo  ya puedes correr 2-SUBIR-A-APPSCRIPT.bat
echo.
pause
