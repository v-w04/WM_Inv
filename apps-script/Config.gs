/**
 * ============================================================
 *  WM_Inv — Walmart Dashboard · Config
 *  Backend: Apps Script | Frontend: GitHub Pages
 * ============================================================
 *
 *  Calibrado con el diagnóstico del 31/08/2026 sobre la cuenta real:
 *    · /v3/wfs/inventory        → 401 (Program Eligibility no habilitado)
 *    · /v3/fulfillment/inventory → ✅ 200, 471 SKUs en WFS
 *    · /v3/inventories          → 400 MARKET_NOT_SUPPORTED (US only)
 *    · /v3/items                → ✅ 200, 3,271 items
 *    · /v3/inventory?sku=X      → ✅ 200 (uno por uno)
 */

const WM_CONFIG = {
  // ------- Versión -------
  // 1.0 · congelado el 14/09/2026 tras auditoría completa.
  // 1.1 · 17/09/2026 — triaje de SKUs sin publicar:
  //        · se escriben lifecycleStatus y motivoWalmart, que ya
  //          venían de /v3/items y se tiraban (cero llamadas extra)
  //        · hoja "Bloqueados" (de la usuaria) + "No_Publicados"
  //          (generada)
  //        · los SKUs marcados BLOQUEADO salen del barrido
  // Si tocas algo, sube el número y anota qué cambió.
  VERSION: '1.1',
  VERSION_FECHA: '2026-09-17',

  // ------- Walmart API -------
  BASE_URL:    'https://marketplace.walmartapis.com',
  SANDBOX_URL: 'https://sandbox.walmartapis.com',
  USE_SANDBOX: false,
  MARKET:       'mx',
  API_VERSION:  '3.1',
  SERVICE_NAME: 'ElectronicsMexico-Dashboard',

  // ------- Google Sheet -------
  // WALMART DASHBOARD
  // https://docs.google.com/spreadsheets/d/122_hEHeBaa6vYTABhdHdqnJqi_CXtpPB_g9N1d6Fr0Q/edit
  SHEET_ID: '122_hEHeBaa6vYTABhdHdqnJqi_CXtpPB_g9N1d6Fr0Q',

  /* Zona horaria del negocio. Las cuentas que ejecutan esto SIEMPRE
     son de CDMX, así que se fija aquí en vez de preguntarla.
     No se usa Session.getScriptTimeZone(): esa es la que Google puso
     al crear el proyecto (puede ser Los Ángeles o UTC sin que nadie
     se enterara), y de ella dependen las ventanas de hora. */
  ZONA: 'America/Mexico_City',

  SHEET_MASTER:  'Inventario',      // catálogo + WFS (se reescribe completo)
  SHEET_REGULAR: 'Inv_Normal',      // inventario no-WFS (se llena por partes)
  SHEET_LOG:     'Sync_Log',

  // Triaje de publicación. Dos dueños distintos, a propósito:
  //   BLOQUEADOS  la llena la usuaria. El script SOLO la lee.
  //   NOPUB       la genera el script. Se sobreescribe cada corrida.
  SHEET_BLOQUEADOS: 'Bloqueados',
  SHEET_NOPUB:      'No_Publicados',

  // ------- Bitácora -------
  // Crece ~144 filas al día (96 syncMain + 48 chunk).
  // 30 días ≈ 4,300 filas: suficiente para rastrear algo que se rompió
  // mientras nadie veía, y chico para la hoja.
  // No se poda en cada corrida (deleteRows es caro): solo cuando pasa
  // de LOG_MAX_FILAS, o sea como una vez cada 5 días.
  LOG_DIAS:      30,
  LOG_MAX_FILAS: 5000,

  // ------- PropertiesService keys -------
  PROP_CLIENT_ID:     'WM_CLIENT_ID',
  PROP_CLIENT_SECRET: 'WM_CLIENT_SECRET',
  PROP_DASH_PASSWORD: 'DASH_PASSWORD_HASH',
  PROP_INV_CURSOR:    'INV_CURSOR',        // posición del barrido de inv. normal
  PROP_WFS_ENDPOINT:  'WFS_ENDPOINT_MODE', // 'new' | 'legacy' — se autodetecta
  PROP_LAST_MAIN:     'LAST_MAIN_RUN',     // timestamp del último syncMain
  PROP_LAST_CATALOG:  'LAST_CATALOG_RUN',  // timestamp del último catálogo COMPLETO
  PROP_ITEMS_LIMIT:   'ITEMS_PAGE_LIMIT',  // tamaño de página que Walmart sí acepta
  PROP_MASTER_COUNT:  'LAST_MASTER_COUNT', // cuántos SKUs tenía la hoja la última vez
  PROP_WFS_COUNT:     'LAST_WFS_COUNT',    // cuántos SKUs en WFS la última vez
  PROP_CEDIDAS:       'CHUNK_CEDIDAS',     // corridas seguidas que el barrido cedió
  PROP_PW_ITER:       'PW_ITERACIONES',    // iteraciones calibradas para esta cuenta

  // ------- CacheService keys -------
  CACHE_TOKEN:         'wm_access_token',
  CACHE_INVENTORY:     'wm_inv_v2',
  CACHE_SESSION_PREF:  'sess_',
  CACHE_LOGIN_FAILS:   'login_fails',
  CACHE_LOGIN_LAST:    'login_last_fail',
  CACHE_TTL_SECONDS:   21600,   // 6 h (máximo de CacheService)
  SESSION_TTL_SECONDS: 43200,   // sesión web = 12 h

  // ------- Seguridad del password del dashboard -------
  //
  // El dashboard vive en una URL pública: el password ES la puerta.
  // Un SHA-256 pelón se rompe con tablas precalculadas en segundos.
  // Por eso: sal aleatoria por password + estirado de clave (miles de
  // iteraciones) para que cada intento le cueste caro al atacante.
  //
  // Las iteraciones NO están fijas: se calibran contra la velocidad real
  // de esta cuenta para que un login tarde ~PW_TARGET_MS. Así el freno
  // sigue siendo el mismo aunque Google cambie de hardware.
  PW_TARGET_MS:    400,      // cuánto queremos que cueste UN intento
  PW_ITER_MIN:     10000,    // piso, aunque la máquina salga lentísima
  PW_ITER_MAX:     250000,   // techo, para no colgar el login

  // Freno anti fuerza bruta. No es bloqueo permanente a propósito:
  // sin IP del cliente, un bloqueo duro lo puede disparar cualquiera
  // desde fuera y dejar a la dueña afuera de su propio dashboard.
  // En vez de eso, la espera crece y la ventana expira sola.
  LOGIN_MAX_FAILS:   15,     // tras esto, se rechaza sin siquiera calcular
  LOGIN_WINDOW_SEC:  900,    // 15 min desde el último fallo

  // ------- Triggers -------
  // Calibrado contra la CUOTA DIARIA de UrlFetch (20,000 en cuentas Gmail).
  //
  // ⚠️ ESOS 20,000 SON POR CUENTA DE GOOGLE, NO POR PROYECTO.
  //    Todos los Apps Script que corran bajo la misma cuenta (cotizador,
  //    cambio de precios, MELI-ODOO, Site Sheet…) comen de la MISMA bolsa.
  //    Por eso el presupuesto propio de aquí es bastante más bajo que 20,000:
  //    hay que dejarle aire a los demás proyectos.
  //
  // Presupuesto de este proyecto (calibrado 08/09/2026):
  //
  //   syncMain "ligero"  (solo WFS)     72/día × ~5  llamadas =    360
  //   syncMain "completo" (WFS+catálogo) 24/día × ~22 llamadas =    528
  //   syncRegularChunk                   48/día × 200 SKUs     =  9,600
  //                                                    TOTAL   = 10,488
  //
  // Antes: 96 corridas/día re-paginando el catálogo entero a 50 por página
  // (67 páginas) = 6,816 llamadas solo para releer un catálogo que no cambia.
  REFRESH_INTERVAL_MIN: 15,   // WFS (el stock sí se mueve con cada venta)
  CHUNK_INTERVAL_MIN:   30,   // barrido de inventario normal
  CATALOG_REFRESH_MIN:  60,   // catálogo completo desde la API (lo demás se relee de la hoja)

  // ------- Presupuesto de llamadas HTTP -------
  DAILY_FETCH_BUDGET:  14000,  // tope propio; deja ~6,000 a los otros proyectos
  MAX_SKUS_POR_CHUNK:  200,    // techo por corrida, además del límite de tiempo
  ITEMS_PAGE_LIMIT:    200,    // se intenta esto en /v3/items; si Walmart lo recorta, se ajusta solo
  PROP_FETCH_COUNT:    'FETCH_COUNT',
  PROP_FETCH_DATE:     'FETCH_DATE',

  // ------- Presupuestos de tiempo (Apps Script mata a los 6 min = 360s) -------
  BUDGET_MAIN_MS:  240000,   // 4 min para catálogo + WFS
  // 240 s, no 270: el barrido deja de pedir SKUs a los 4 min y le quedan
  // 2 min para escribir. Con 270 la corrida mas lenta llego a 329 s y el
  // limite duro de Apps Script son 360. En una corrida normal (~170 s) esto
  // no cambia nada: solo frena antes las lentas. No gasta mas llamadas ni
  // altera el dato, y la vuelta completa sigue en ~8.5 h.
  BUDGET_CHUNK_MS: 240000,

  // ------- Pacing (rate limit: 300 TPM) -------
  PAGE_PACING_MS: 220,   // entre páginas de catálogo/WFS
  SKU_PACING_MS:  180,   // entre llamadas por SKU

  // ------- Reintentos -------
  MAX_RETRIES:      3,
  RETRY_BASE_MS:    800,   // backoff exponencial: 800ms, 1.6s, 3.2s

  // Si el dataset excede esto no se cachea; se sirve desde el Sheet.
  MAX_CACHE_BYTES: 900 * 1024,
};

function getBaseUrl() {
  return WM_CONFIG.USE_SANDBOX ? WM_CONFIG.SANDBOX_URL : WM_CONFIG.BASE_URL;
}

/**
 * Abre el spreadsheet por ID.
 * NUNCA getActiveSpreadsheet() — regresa null en triggers y web apps standalone.
 */
function getSpreadsheet_() {
  if (!WM_CONFIG.SHEET_ID || WM_CONFIG.SHEET_ID.indexOf('PON_AQUI') >= 0) {
    throw new Error('Falta configurar SHEET_ID en Config.gs');
  }
  return SpreadsheetApp.openById(WM_CONFIG.SHEET_ID);
}

/** Obtiene (o crea) una pestaña por nombre */
function getSheet_(name) {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}
