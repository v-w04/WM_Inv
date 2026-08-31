/**
 * ============================================================
 *  Api — Cliente HTTP de Walmart Global Marketplace API
 * ============================================================
 */

function wmHeaders_() {
  return {
    'WM_SEC.ACCESS_TOKEN':   getAccessToken(),
    'WM_QOS.CORRELATION_ID': Utilities.getUuid(),
    'WM_SVC.NAME':           WM_CONFIG.SERVICE_NAME,
    'WM_MARKET':             WM_CONFIG.MARKET,
    'WM_GLOBAL_VERSION':     WM_CONFIG.API_VERSION,
    'Accept':                'application/json',
    'Content-Type':          'application/json',
  };
}

function wmGet_(path, params) {
  const url = getBaseUrl() + path + toQs_(params);
  const opts = { method: 'get', headers: wmHeaders_(), muteHttpExceptions: true };
  let resp = UrlFetchApp.fetch(url, opts);
  if (resp.getResponseCode() === 401) {
    CacheService.getScriptCache().remove(WM_CONFIG.CACHE_TOKEN);
    opts.headers = wmHeaders_();
    resp = UrlFetchApp.fetch(url, opts);
  }
  const code = resp.getResponseCode();
  const body = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('GET ' + path + ' → HTTP ' + code + ': ' + body.substring(0, 500));
  }
  return JSON.parse(body || '{}');
}

function toQs_(params) {
  if (!params) return '';
  const parts = [];
  Object.keys(params).forEach(function(k){
    const v = params[k];
    if (v !== null && v !== undefined && v !== '') {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
  });
  return parts.length ? '?' + parts.join('&') : '';
}

/* ---- WFS Inventory (bulk) ---- */
function getAllWfsInventory() {
  const all = [];
  let offset = 0, total = null, pages = 0;
  const limit = 200, maxPages = 500;
  while (pages++ < maxPages) {
    const data = wmGet_('/v3/wfs/inventory', { offset, limit });
    const items = (data && data.payload && data.payload.inventory) || [];
    all.push.apply(all, items);
    if (total === null) total = Number((data && data.headers && data.headers.totalCount) || items.length) || items.length;
    offset += items.length;
    if (!items.length || offset >= total) break;
    Utilities.sleep(WM_CONFIG.PAGE_PACING_MS);
  }
  return all;
}

/* ---- Items (catalog) ---- */
function getAllItems() {
  const all = [];
  let nextCursor = null, pages = 0;
  const maxPages = 400;
  while (pages++ < maxPages) {
    const params = { limit: 50, includeDetails: 'true' };
    if (nextCursor) params.nextCursor = nextCursor;
    const data = wmGet_('/v3/items', params);
    const items = data.ItemResponse || data.items || [];
    all.push.apply(all, items);
    nextCursor = data.nextCursor;
    if (!nextCursor || !items.length) break;
    Utilities.sleep(WM_CONFIG.PAGE_PACING_MS);
  }
  return all;
}

/* ---- Orders (últimos N días) ---- */
function getRecentOrders(daysBack) {
  const startISO = new Date(Date.now() - (daysBack || 7) * 86400000).toISOString();
  const all = [];
  let cursor = null, pages = 0;
  const maxPages = 100;
  while (pages++ < maxPages) {
    const params = { createdStartDate: startISO, limit: 100 };
    if (cursor) params.cursor = cursor;
    const data = wmGet_('/v3/orders', params);
    const list = (data.list && data.list.elements && (data.list.elements.order || data.list.elements)) || data.orders || [];
    all.push.apply(all, list);
    cursor = (data.list && data.list.meta && data.list.meta.nextCursor) || data.nextCursor || null;
    if (!cursor || !list.length) break;
    Utilities.sleep(WM_CONFIG.PAGE_PACING_MS);
  }
  return all;
}
