/**
 * ============================================================
 *  WebAPI — Endpoint JSON para el frontend en GitHub Pages
 * ============================================================
 *
 *  Acciones: ping | login | logout | inventory | refresh
 *  Auth: password → session token → token en cada request.
 *
 *  Deploy: Web App, Execute as = Me, Access = Anyone.
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
      default:          return json_({ ok: false, error: 'unknown action: ' + action });
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
    return json_({ ok: false, error: 'invalid password' });
  }
  return json_({ ok: true, token: createSession_(), ttlSec: WM_CONFIG.SESSION_TTL_SECONDS });
}

function logoutAction_(p) {
  destroySession_(p.token);
  return json_({ ok: true });
}

/**
 * force=true  → jala fresco desde Walmart API
 * force=false → cache → sheet → (solo si ambos vacíos) Walmart API
 */
function inventoryAction_(force) {
  let rows, source, ts;

  if (force) {
    syncFullInventory();
    const loaded = loadRows_();
    rows = loaded.rows; source = 'walmart'; ts = loaded.ts || Date.now();
  } else {
    const loaded = loadRows_();
    if (loaded.source === 'empty') {
      syncFullInventory();
      const reloaded = loadRows_();
      rows = reloaded.rows; source = 'walmart'; ts = reloaded.ts || Date.now();
    } else {
      rows = loaded.rows; source = loaded.source; ts = loaded.ts;
    }
  }

  return json_({
    ok: true,
    rows: rows,
    count: rows.length,
    source: source,
    fetchedAt: ts ? new Date(ts).toISOString() : new Date().toISOString(),
    market: WM_CONFIG.MARKET,
    sandbox: WM_CONFIG.USE_SANDBOX,
    refreshMin: WM_CONFIG.REFRESH_INTERVAL_MIN,
  });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
