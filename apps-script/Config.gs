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

  SHEET_MASTER:  'Inventario',      // catálogo + WFS (se reescribe completo)
  SHEET_REGULAR: 'Inv_Normal',      // inventario no-WFS (se llena por partes)
  SHEET_LOG:     'Sync_Log',

  // ------- PropertiesService keys -------
  PROP_CLIENT_ID:     'WM_CLIENT_ID',
  PROP_CLIENT_SECRET: 'WM_CLIENT_SECRET',
  PROP_DASH_PASSWORD: 'DASH_PASSWORD_HASH',
  PROP_INV_CURSOR:    'INV_CURSOR',        // posición del barrido de inv. normal
  PROP_WFS_ENDPOINT:  'WFS_ENDPOINT_MODE', // 'new' | 'legacy' — se autodetecta
  PROP_LAST_MAIN:     'LAST_MAIN_RUN',     // timestamp del último syncMain

  // ------- CacheService keys -------
  CACHE_TOKEN:         'wm_access_token',
  CACHE_INVENTORY:     'wm_inv_v2',
  CACHE_SESSION_PREF:  'sess_',
  CACHE_TTL_SECONDS:   21600,   // 6 h (máximo de CacheService)
  SESSION_TTL_SECONDS: 43200,   // sesión web = 12 h

  // ------- Triggers -------
  REFRESH_INTERVAL_MIN: 10,   // catálogo + WFS
  CHUNK_INTERVAL_MIN:   5,    // barrido de inventario normal

  // ------- Presupuestos de tiempo (Apps Script mata a los 6 min = 360s) -------
  BUDGET_MAIN_MS:  240000,   // 4 min para catálogo + WFS (medido: ~95 seg)
  BUDGET_CHUNK_MS: 180000,   // 3 min para el barrido — deja hueco para syncMain

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
