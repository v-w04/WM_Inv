/**
 * ============================================================
 *  Auth — Credenciales Walmart + password del dashboard + sesiones
 * ============================================================
 */

/* ================ CREDENCIALES WALMART ================ */

function setupCredentialsInline() {
  // ⚠️ Edita estos valores UNA sola vez, corre esta función, y luego
  //    déjalos como estaban (placeholders). Ya quedan cifrados en PropertiesService.
  const CLIENT_ID     = 'PON_TU_CLIENT_ID_AQUI';
  const CLIENT_SECRET = 'PON_TU_CLIENT_SECRET_AQUI';
  if (CLIENT_ID.startsWith('PON_') || CLIENT_SECRET.startsWith('PON_')) {
    throw new Error('Edita los placeholders CLIENT_ID / CLIENT_SECRET antes de correr esta función.');
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty(WM_CONFIG.PROP_CLIENT_ID, String(CLIENT_ID).trim());
  props.setProperty(WM_CONFIG.PROP_CLIENT_SECRET, String(CLIENT_SECRET).trim());
  CacheService.getScriptCache().remove(WM_CONFIG.CACHE_TOKEN);
  Logger.log('✅ Credenciales Walmart guardadas. Corre testAuth() para verificar.');
}

function getCredentials_() {
  const props = PropertiesService.getScriptProperties();
  const clientId     = props.getProperty(WM_CONFIG.PROP_CLIENT_ID);
  const clientSecret = props.getProperty(WM_CONFIG.PROP_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    throw new Error('Credenciales no configuradas. Corre setupCredentialsInline() primero.');
  }
  return { clientId, clientSecret };
}

function getAccessToken() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(WM_CONFIG.CACHE_TOKEN);
  if (cached) return cached;

  const { clientId, clientSecret } = getCredentials_();
  const basic = Utilities.base64Encode(clientId + ':' + clientSecret);
  const url = getBaseUrl() + '/v3/token';

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'Authorization':        'Basic ' + basic,
      'WM_QOS.CORRELATION_ID': Utilities.getUuid(),
      'WM_SVC.NAME':           WM_CONFIG.SERVICE_NAME,
      'WM_MARKET':             WM_CONFIG.MARKET,
      'Content-Type':          'application/x-www-form-urlencoded',
      'Accept':                'application/json',
    },
    payload: 'grant_type=client_credentials',
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Token error ' + resp.getResponseCode() + ': ' + resp.getContentText());
  }
  const data = JSON.parse(resp.getContentText());
  const token = data.access_token;
  const ttl = Math.max(60, (Number(data.expires_in) || 900) - 60);
  cache.put(WM_CONFIG.CACHE_TOKEN, token, ttl);
  return token;
}

function testAuth() {
  try {
    const t = getAccessToken();
    Logger.log('✅ Token OK: ' + t.substring(0, 24) + '...  |  ' + getBaseUrl() + '  |  ' + WM_CONFIG.MARKET);
    return true;
  } catch (e) { Logger.log('❌ ' + e.message); return false; }
}

/* ================ PASSWORD DEL DASHBOARD ================ */

/**
 * Ejecuta UNA vez. Edita la constante PASSWORD abajo con la que quieres,
 * córrela, y luego bórrala del código. Queda hasheada en PropertiesService.
 */
function setupDashboardPassword() {
  const PASSWORD = 'PON_TU_PASSWORD_AQUI';   // ← edita, corre, borra
  if (PASSWORD.startsWith('PON_')) {
    throw new Error('Edita la constante PASSWORD antes de correr.');
  }
  if (PASSWORD.length < 8) {
    throw new Error('Usa al menos 8 caracteres.');
  }
  const hash = sha256_(PASSWORD);
  PropertiesService.getScriptProperties().setProperty(WM_CONFIG.PROP_DASH_PASSWORD, hash);
  Logger.log('✅ Password del dashboard guardado (hash SHA-256).');
}

function verifyPassword_(pw) {
  const stored = PropertiesService.getScriptProperties().getProperty(WM_CONFIG.PROP_DASH_PASSWORD);
  if (!stored) throw new Error('No hay password configurado. Corre setupDashboardPassword() en el editor.');
  return sha256_(String(pw || '')) === stored;
}

function sha256_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function(b){ b = (b < 0) ? b + 256 : b; return ('0' + b.toString(16)).slice(-2); }).join('');
}

/* ================ SESIONES (para el frontend) ================ */

function createSession_() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const key = WM_CONFIG.CACHE_SESSION_PREF + token;
  CacheService.getScriptCache().put(key, String(Date.now()), WM_CONFIG.SESSION_TTL_SECONDS);
  return token;
}

function validateSession_(token) {
  if (!token) return false;
  const key = WM_CONFIG.CACHE_SESSION_PREF + token;
  return CacheService.getScriptCache().get(key) !== null;
}

function destroySession_(token) {
  if (!token) return;
  CacheService.getScriptCache().remove(WM_CONFIG.CACHE_SESSION_PREF + token);
}
