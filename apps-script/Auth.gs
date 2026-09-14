/**
 * ============================================================
 *  Auth — Credenciales Walmart + password del dashboard + sesiones
 * ============================================================
 */

/* ================ CREDENCIALES WALMART ================ */

/**
 * ⚠️ ESTE ARCHIVO SE SUBE A UN REPO PÚBLICO.
 *
 * Edita los valores, corre la función UNA vez, y REGRESA LOS PLACEHOLDERS.
 * Las credenciales quedan cifradas en PropertiesService — el código no las
 * necesita después.
 *
 * Si subes una credencial real, queda en el historial de git para siempre;
 * borrarla en un commit posterior NO la quita. Los .bat de subida traen un
 * seguro que revisa esto, pero la primera línea de defensa eres tú.
 */
function setupCredentialsInline() {
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

  if (!gastarFetch_()) {
    throw new Error('Presupuesto diario de llamadas agotado. Se reinicia mañana. ' +
                    'Corre verConsumo() para ver el detalle.');
  }

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
 * ⚠️ SOLO DESDE EL EDITOR DE APPS SCRIPT.
 *
 * Esto NO está en el menú del Sheet a propósito: ese menú lo ve cualquiera
 * con permiso de edición en la hoja, y cambiar la contraseña del dashboard
 * exige un permiso más alto. Correr una función desde el editor requiere
 * acceso al script, que es el nivel correcto.
 *
 * Edita PASSWORD, corre la función UNA vez, y regresa el placeholder.
 * Los .bat de subida se niegan a hacer commit si detectan que quedó un
 * valor real aquí.
 */
function setupDashboardPassword() {
  const PASSWORD = 'PON_TU_PASSWORD_AQUI';   // ← edita, corre, borra
  if (PASSWORD.startsWith('PON_')) {
    throw new Error('Edita la constante PASSWORD antes de correr.');
  }
  if (PASSWORD.length < 8) {
    throw new Error('Usa al menos 8 caracteres.');
  }

  const t0 = Date.now();
  const iter = calibrarIteraciones_(WM_CONFIG.PW_TARGET_MS);
  PropertiesService.getScriptProperties().setProperty(WM_CONFIG.PROP_PW_ITER, String(iter));

  const hash = hashV2_(PASSWORD, iter);
  PropertiesService.getScriptProperties().setProperty(WM_CONFIG.PROP_DASH_PASSWORD, hash);

  // Medimos un login real para reportar lo que de verdad va a costar
  const t1 = Date.now();
  verifyPassword_(PASSWORD);
  const msLogin = Date.now() - t1;

  Logger.log('✅ Password del dashboard guardado.');
  Logger.log('   Formato:     v2 (sal aleatoria + estirado de clave)');
  Logger.log('   Iteraciones: ' + iter.toLocaleString());
  Logger.log('   Un login tarda ~' + msLogin + ' ms.');
  Logger.log('');
  Logger.log('   Qué significa: un atacante con tu hash tendría que gastar');
  Logger.log('   esos ' + msLogin + ' ms POR CADA contraseña que quiera probar.');
  Logger.log('   Antes (SHA-256 pelón) probaba millones por segundo.');
  Logger.log('');
  Logger.log('⚠️ Regresa el placeholder PON_TU_PASSWORD_AQUI antes de subir.');
  Logger.log('   Total de la operación: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}

/**
 * Verifica el password. Acepta los dos formatos:
 *
 *   v2$<iteraciones>$<sal_b64>$<hash_b64>   ← el bueno
 *   <64 hex>                                ← el viejo, SHA-256 sin sal
 *
 * Si entra con el viejo y acierta, se REGRABA en v2 al vuelo. Así la
 * migración no le pide nada a nadie: el primer login después de subir
 * este código deja la contraseña blindada, con la misma contraseña.
 */
function verifyPassword_(pw) {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty(WM_CONFIG.PROP_DASH_PASSWORD);
  if (!stored) {
    throw new Error('No hay password configurado. Corre setupDashboardPassword() en el editor.');
  }
  pw = String(pw || '');

  // ── Formato viejo ──
  if (stored.indexOf('$') < 0) {
    if (!igualesEnTiempoConstante_(sha256_(pw), stored)) return false;
    try {
      props.setProperty(WM_CONFIG.PROP_DASH_PASSWORD, hashV2_(pw));
      Logger.log('🔒 Password migrado a v2 (sal + estirado) en este login.');
    } catch (e) {
      Logger.log('⚠ No se pudo migrar el password: ' + e.message);
    }
    return true;
  }

  // ── Formato v2 ──
  const partes = stored.split('$');
  if (partes.length !== 4 || partes[0] !== 'v2') {
    Logger.log('⚠ El password guardado tiene un formato que no reconozco.');
    return false;
  }
  const iter = Math.max(1, Number(partes[1]) || WM_CONFIG.PW_ITER_MIN);
  let salt;
  try { salt = Utilities.base64Decode(partes[2]); }
  catch (e) { Logger.log('⚠ Sal corrupta en el password guardado.'); return false; }

  const calculado = Utilities.base64Encode(derivar_(pw, salt, iter));
  return igualesEnTiempoConstante_(calculado, partes[3]);
}

/* ---------- Piezas del hash v2 ---------- */

/** Arma el string completo `v2$iter$sal$hash` con sal nueva */
function hashV2_(pw, iterOpcional) {
  const salt = saltNuevo_();
  const iter = iterOpcional || iteracionesCalibradas_();
  const h = derivar_(String(pw), salt, iter);
  return 'v2$' + iter + '$' + Utilities.base64Encode(salt) + '$' + Utilities.base64Encode(h);
}

/**
 * Estirado de clave: SHA-256 encadenado, metiendo la sal en CADA vuelta.
 *
 * Meter la sal siempre (y no solo al principio) evita que alguien
 * precalcule la cadena de iteraciones una vez y la reuse contra
 * muchas contraseñas.
 */
function derivar_(password, saltBytes, iteraciones) {
  const SHA = Utilities.DigestAlgorithm.SHA_256;
  let h = Utilities.computeDigest(SHA, unirBytes_(saltBytes, bytesDe_(password)));
  for (let i = 1; i < iteraciones; i++) {
    h = Utilities.computeDigest(SHA, unirBytes_(h, saltBytes));
  }
  return h;
}

/**
 * Mide cuántas iteraciones caben en msObjetivo en ESTA cuenta.
 *
 * Fijar un número a mano es una apuesta: en una máquina rápida queda corto
 * (poca protección) y en una lenta cuelga el login. Medir lo resuelve solo.
 */
function calibrarIteraciones_(msObjetivo) {
  const muestra = 2000;
  const salt = saltNuevo_();
  const t0 = Date.now();
  derivar_('calibracion-no-es-un-password', salt, muestra);
  const ms = Math.max(1, Date.now() - t0);

  let n = Math.round(muestra * (msObjetivo / ms));
  n = Math.max(WM_CONFIG.PW_ITER_MIN, Math.min(WM_CONFIG.PW_ITER_MAX, n));
  return n;
}

/** El valor calibrado, medido una sola vez y guardado */
function iteracionesCalibradas_() {
  const props = PropertiesService.getScriptProperties();
  const guardado = Number(props.getProperty(WM_CONFIG.PROP_PW_ITER) || 0);
  if (guardado >= WM_CONFIG.PW_ITER_MIN) return guardado;
  const n = calibrarIteraciones_(WM_CONFIG.PW_TARGET_MS);
  props.setProperty(WM_CONFIG.PROP_PW_ITER, String(n));
  return n;
}

/** 32 bytes de sal. getUuid() usa SecureRandom por debajo, sirve. */
function saltNuevo_() {
  const hex = Utilities.getUuid().replace(/-/g, '') +
              Utilities.getUuid().replace(/-/g, '');
  const out = [];
  for (let i = 0; i < 32; i++) {
    let b = parseInt(hex.substr(i * 2, 2), 16);
    if (b > 127) b -= 256;      // Apps Script maneja bytes con signo
    out.push(b);
  }
  return out;
}

function bytesDe_(str) {
  return Utilities.newBlob(String(str)).getBytes();   // UTF-8
}

function unirBytes_(a, b) {
  const out = [];
  for (let i = 0; i < a.length; i++) out.push(a[i]);
  for (let i = 0; i < b.length; i++) out.push(b[i]);
  return out;
}

/**
 * Comparación de tiempo constante.
 *
 * Un `===` normal corta en el primer carácter distinto. Midiendo cuánto
 * tarda en responder, un atacante puede ir adivinando el hash carácter
 * por carácter. Aquí siempre se recorre todo.
 */
function igualesEnTiempoConstante_(a, b) {
  a = String(a || '');
  b = String(b || '');
  let dif = a.length ^ b.length;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dif |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return dif === 0;
}

function sha256_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function(b){ b = (b < 0) ? b + 256 : b; return ('0' + b.toString(16)).slice(-2); }).join('');
}

/* ================ FRENO ANTI FUERZA BRUTA ================ */

function fallosLogin_() {
  const v = CacheService.getScriptCache().get(WM_CONFIG.CACHE_LOGIN_FAILS);
  return Number(v || 0);
}

function sumarFalloLogin_() {
  const c = CacheService.getScriptCache();
  const n = fallosLogin_() + 1;
  // put reinicia el TTL: la ventana cuenta desde el ÚLTIMO fallo,
  // que es lo que se quiere contra un ataque sostenido.
  c.put(WM_CONFIG.CACHE_LOGIN_FAILS, String(n), WM_CONFIG.LOGIN_WINDOW_SEC);
  c.put(WM_CONFIG.CACHE_LOGIN_LAST, String(Date.now()), WM_CONFIG.LOGIN_WINDOW_SEC);
  return n;
}

function limpiarFallosLogin_() {
  const c = CacheService.getScriptCache();
  c.remove(WM_CONFIG.CACHE_LOGIN_FAILS);
  c.remove(WM_CONFIG.CACHE_LOGIN_LAST);
}

/** La espera crece con los fallos. Milisegundos. */
function esperaPorFallos_(n) {
  if (n <= 2) return 800;
  if (n <= 5) return 2000;
  if (n <= 9) return 5000;
  return 9000;
}

/**
 * Estado del password y de los intentos. SOLO LECTURA.
 * No muestra el hash, la sal ni nada que sirva para entrar.
 */
function verEstadoPassword() {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty(WM_CONFIG.PROP_DASH_PASSWORD);
  const L = [];
  const p = function(s){ L.push(s); Logger.log(s); };

  p('── SEGURIDAD DEL DASHBOARD ──');
  p('');

  if (!stored) {
    p('❌ No hay password configurado.');
    p('   Corre setupDashboardPassword() desde el editor.');
    return L.join('\n');
  }

  if (stored.indexOf('$') < 0) {
    p('⚠️ Formato VIEJO (SHA-256 sin sal).');
    p('   Se migra solo en el próximo login correcto — no tienes que');
    p('   hacer nada, ni cambiar tu contraseña.');
  } else {
    const partes = stored.split('$');
    p('✅ Formato v2: sal aleatoria + estirado de clave');
    p('   Iteraciones: ' + Number(partes[1]).toLocaleString());
  }

  p('');
  const fallos = fallosLogin_();
  const ultimo = Number(CacheService.getScriptCache().get(WM_CONFIG.CACHE_LOGIN_LAST) || 0);

  if (!fallos) {
    p('Intentos fallidos recientes: ninguno.');
  } else {
    const mins = ultimo ? Math.round((Date.now() - ultimo) / 60000) : '?';
    p('Intentos fallidos en la ventana actual: ' + fallos +
      ' de ' + WM_CONFIG.LOGIN_MAX_FAILS);
    p('Último hace ' + mins + ' min.');
    if (fallos >= WM_CONFIG.LOGIN_MAX_FAILS) {
      p('');
      p('🛑 El login está frenado ahorita. Se libera solo a los ' +
        Math.ceil(WM_CONFIG.LOGIN_WINDOW_SEC / 60) + ' min del último intento.');
    } else if (fallos >= 5) {
      p('');
      p('⚠️ Si no fuiste tú, alguien está probando contraseñas.');
      p('   Cambia la contraseña desde el editor por si acaso.');
    }
  }

  p('');
  p('La ventana se limpia sola. No hay bloqueo permanente a propósito:');
  p('sin IP del cliente, un bloqueo duro lo dispararía cualquiera desde');
  p('fuera y te dejaría a TI sin poder entrar.');

  return L.join('\n');
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
