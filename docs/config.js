/**
 * Configuración del frontend
 * ---------------------------------------------------------
 * URL del Apps Script Web App (deployment de WM_Inv Dashboard).
 *
 * Esta URL es pública — aparece en el código del repo — pero sin la
 * contraseña configurada en Apps Script no devuelve ningún dato.
 *
 * Si vuelves a hacer un deployment NUEVO (no una versión nueva del
 * mismo), la URL cambia y hay que actualizarla aquí.
 *
 * NOTA: se usa `var` a propósito, no `const`. Las declaraciones con
 * const/let en el nivel superior NO crean propiedad en `window`, y
 * app.js necesita poder leerla desde ahí.
 */
var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzCA1XumWbAlQRQGBF0ycLiCOKMus3QajkDa30-UrPGx4TN96LwC6NAB1zsd12WROzKsA/exec';

// Redundante pero explícito: garantiza el acceso vía window
window.APPS_SCRIPT_URL = APPS_SCRIPT_URL;
