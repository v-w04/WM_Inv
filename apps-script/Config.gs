/**
 * ============================================================
 *  WM_Inv — Walmart WFS Dashboard · Config
 *  Backend: Apps Script | Frontend: GitHub Pages
 * ============================================================
 */

const WM_CONFIG = {
  // ------- Walmart API -------
  BASE_URL:    'https://marketplace.walmartapis.com',
  SANDBOX_URL: 'https://sandbox.walmartapis.com',
  USE_SANDBOX: false,
  MARKET:       'mx',
  API_VERSION:  '3.1',
  SERVICE_NAME: 'ElectronicsMexico-Dashboard',

  // ------- Google Sheet de respaldo -------
  // ⬇⬇ PEGA AQUÍ EL ID DE TU SHEET ⬇⬇
  // De la URL: docs.google.com/spreadsheets/d/[ESTE_ES_EL_ID]/edit
  SHEET_ID: 'PON_AQUI_EL_ID_DE_TU_SHEET',

  SHEET_INVENTORY: 'Inventory_Cache',
  SHEET_LOG:       'Sync_Log',

  // ------- PropertiesService keys -------
  PROP_CLIENT_ID:     'WM_CLIENT_ID',
  PROP_CLIENT_SECRET: 'WM_CLIENT_SECRET',
  PROP_DASH_PASSWORD: 'DASH_PASSWORD_HASH',

  // ------- CacheService keys -------
  CACHE_TOKEN:         'wm_access_token',
  CACHE_INVENTORY:     'wm_inv_v1',
  CACHE_SESSION_PREF:  'sess_',
  CACHE_TTL_SECONDS:   21600,   // 6 horas (máximo que permite CacheService)
  SESSION_TTL_SECONDS: 43200,   // sesión web = 12 horas

  // ------- Auto-refresh servidor -------
  REFRESH_INTERVAL_MIN: 10,

  // ------- Comportamiento del sync -------
  FETCH_CATALOG_ITEMS: true,
  FETCH_ORDERS_DAYS:   0,
  PAGE_PACING_MS:      250,

  // Si el dataset excede esto, no se intenta cachear (se sirve desde Sheet).
  MAX_CACHE_BYTES: 900 * 1024,   // ~900KB en 10 chunks de 90KB
};

function getBaseUrl() {
  return WM_CONFIG.USE_SANDBOX ? WM_CONFIG.SANDBOX_URL : WM_CONFIG.BASE_URL;
}

/**
 * Abre el spreadsheet por ID (NUNCA getActiveSpreadsheet — truena en triggers
 * y en web apps standalone).
 */
function getSpreadsheet_() {
  if (!WM_CONFIG.SHEET_ID || WM_CONFIG.SHEET_ID.indexOf('PON_AQUI') >= 0) {
    throw new Error('Falta configurar SHEET_ID en Config.gs');
  }
  return SpreadsheetApp.openById(WM_CONFIG.SHEET_ID);
}
