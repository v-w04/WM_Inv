/**
 * ============================================================
 *  WebAPI — Endpoint JSON para el frontend en GitHub Pages
 * ============================================================
 *
 *  Acciones: ping | login | logout | inventory | refresh | progress
 *  Auth: password → session token → token en cada request.
 *
 *  Deploy: Web App · Ejecutar como: Yo · Acceso: Cualquier persona
 *  (La seguridad la da el password + session token, no el ACL.)
 */

function doGet(e)  { return handleRequest_(e); }

function doPost(e) {
  if (e && e.postData && e.postData.type && e.postData.type.indexOf('json') >= 0) {
    try {
      const body = JSON.parse(e.postData.contents || '{}');
      e.parameter = Object.assign({}, e.parameter || {}, body);
    } catch (_) {}
  }
  return handleRequest_(e);
}

function handleRequest_(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || 'ping';
  try {
    switch (action) {
      case 'ping':      return json_({ ok: true, ts: Date.now() });
      case 'login':     return loginAction_(p);
      case 'logout':    return logoutAction_(p);
      case 'inventory': return authed_(p, function(){ return inventoryAction_(false); });
      case 'refresh':   return authed_(p, function(){ return inventoryAction_(true);  });
      case 'progress':  return authed_(p, function(){ return progressAction_();       });
      default:          return json_({ ok: false, error: 'acción desconocida: ' + action });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function authed_(p, fn) {
  if (!validateSession_(p.token)) return json_({ ok: false, error: 'unauthorized' });
  return fn();
}

/* ---- Acciones ---- */
function loginAction_(p) {
  if (!verifyPassword_(p.password)) {
    Utilities.sleep(1500);   // freno anti brute-force
    return json_({ ok: false, error: 'Contraseña incorrecta' });
  }
  return json_({ ok: true, token: createSession_(), ttlSec: WM_CONFIG.SESSION_TTL_SECONDS });
}

function logoutAction_(p) {
  destroySession_(p.token);
  return json_({ ok: true });
}

/**
 * force=true → corre syncMain (catálogo + WFS, ~90 seg) antes de devolver
 * force=false → cache → Sheet → (solo si está vacío) syncMain
 */
function inventoryAction_(force) {
  if (force) {
    invalidateCache_();
    syncMain();
  }

  let data = loadRows_();

  if (!data.rows.length && !force) {
    syncMain();
    data = loadRows_();
  }

  return json_({
    ok: true,
    rows: data.rows,
    count: data.rows.length,
    fetchedAt: data.ts ? new Date(data.ts).toISOString() : new Date().toISOString(),
    progress: data.progress,
    market: WM_CONFIG.MARKET,
    wfsMode: PropertiesService.getScriptProperties().getProperty(WM_CONFIG.PROP_WFS_ENDPOINT) || 'legacy',
    chunkMin: WM_CONFIG.CHUNK_INTERVAL_MIN,
  });
}

/** Estado del barrido de inventario normal, sin traer todas las filas */
function progressAction_() {
  const cursor = getInvCursor_();
  let total = 0;
  try {
    total = Math.max(0, getSheet_(WM_CONFIG.SHEET_REGULAR).getLastRow() - 1);
  } catch (e) {}
  return json_({
    ok: true,
    cursor: cursor,
    total: total,
    pct: total ? Math.round((cursor / total) * 100) : 0,
    chunkMin: WM_CONFIG.CHUNK_INTERVAL_MIN,
  });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
