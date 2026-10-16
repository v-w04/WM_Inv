@echo off
REM ============================================================
REM  Configuracion del proyecto - EDITA SOLO ESTE ARCHIVO
REM ============================================================
REM  Los demas .bat leen de aqui. Si cambias de repo o de usuario,
REM  se cambia en un solo lugar.
REM
REM  Aqui NO va ninguna credencial. Nada de cookies, passwords ni
REM  llaves: eso vive en PropertiesService de Apps Script y se
REM  captura desde el menu del Sheet.
REM ============================================================

set "PROYECTO=WM_Inv"
set "GH_USER=v-w04"
set "GH_REPO=WM_Inv"
set "GH_BRANCH=main"
set "MSG_DEFAULT=Actualiza dashboard de inventario Walmart"
