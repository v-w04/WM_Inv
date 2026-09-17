/**
 * ============================================================
 *  KillerDeals — incentivos de precio de Walmart
 * ============================================================
 *
 *  Lo que en Seller Center se ve como "Killer Deals" (y como
 *  ofertas financiadas por Walmart) sale por API:
 *
 *      GET /v3/price/incentives
 *
 *  Está en la referencia del Global Marketplace y soporta los
 *  mercados us, ca, MX y cl. Los docs de MX Marketplace no lo
 *  mencionan — es de las cosas que la cuenta contesta aunque la
 *  documentación regional no las liste, igual que pasó con la API
 *  de Reportes.
 *
 *  ── Parámetros ─────────────────────────────────────────────
 *    limit            1..200 (default 25)
 *    offset           desde 0
 *    incentiveStatus  ELIGIBLE | ENROLLED     ← obligatorio
 *    incentiveType    WALMART_FUNDED | REDUCED_REFERRAL
 *    sortBy           ITEM_ID | PRODUCT_NAME | CURRENT_PRICE |
 *                     EXPIRATION_DATE | ENROLLMENT_DATE
 *    sortOrder        ASC | DESC
 *
 *  Los headers son los mismos que ya usa todo el proyecto
 *  (wmHeaders_ ya manda WM_MARKET=mx y WM_GLOBAL_VERSION=3.1).
 *
 *  ── Por qué la hoja se arma sola ───────────────────────────
 *
 *  La referencia describe los campos en prosa — "Item Id, Product
 *  Name, Target Price, Incentive Type…" — pero NO trae el JSON de
 *  ejemplo, así que los nombres exactos de las llaves no se saben
 *  de antemano.
 *
 *  Adivinarlos sería escribir una hoja con columnas vacías y no
 *  notarlo. En vez de eso, las columnas se sacan de las llaves que
 *  Walmart devuelve de verdad: las que nos interesan se acomodan
 *  primero y el resto se agrega al final. Así la hoja no puede
 *  salir incompleta por un nombre mal adivinado.
 *
 *  ── Costo ──────────────────────────────────────────────────
 *
 *  Páginas de 200. Dos estados (elegibles + inscritos). Con unos
 *  cientos de items son ~4-6 llamadas por refresco, con tope duro de
 *  KD_MAX_LLAMADAS.
 *
 *  Corre solo UNA vez al día, en la ventana de la mañana — ver el
 *  bloque de abajo. Para cualquier otra cosa está el botón del menú.
 */

/* ── Cuándo corre solo ──────────────────────────────────────────
   UNA vez al día, en la madrugada-mañana.

   Por qué esa hora y no "cada N horas": la cuota diaria de UrlFetch de
   Google se reinicia en la madrugada. A las 6 a.m. el contador está
   casi intacto, así que estas ~5 llamadas salen del presupuesto del
   día nuevo y no le quitan nada al inventario, que es el que trabaja
   todo el día. Con una cadencia de "cada 12 h" la segunda corrida caía
   a media tarde, justo cuando el barrido va a la mitad.

   Los incentivos casi no se mueven, así que una vez al día es de sobra.
   Para cualquier otra cosa está el botón del menú.                    */

/** Ventana en la que puede arrancar solo (hora local del script) */
const KD_HORA_INICIO = 6;
const KD_HORA_FIN    = 9;   // exclusivo: 6:00 a 8:59

/**
 * Si pasan más de estos días sin correr, se deja arrancar a cualquier
 * hora. Sin esto, unos triggers caídos durante la ventana significan
 * que la hoja no se actualiza NUNCA, y en silencio.
 */
const KD_DIAS_GRACIA = 2;

/**
 * Tope duro de llamadas por refresco. Dos estados × 25 páginas serían
 * 50 en el peor caso; con esto el costo está acotado pase lo que pase
 * y nunca se puede comer el presupuesto del inventario.
 */
const KD_MAX_LLAMADAS = 40;

/** Llave de PropertiesService con la FECHA del último refresco (yyyy-MM-dd) */
const KD_PROP_ULTIMO = 'KD_LAST_RUN';

/** Página máxima que acepta el endpoint */
const KD_LIMIT = 200;

/** Tope de páginas por estado, para que un cursor loco no cicle */
const KD_MAX_PAGINAS = 25;

/**
 * Las columnas que queremos al frente, en este orden. Se emparejan
 * contra las llaves reales sin distinguir mayúsculas ni guiones, así
 * que `targetPrice`, `target_price` y `TargetPrice` caen en la misma.
 * Lo que Walmart devuelva y no esté aquí se agrega al final.
 */
const KD_PREFERIDAS = [
  'sku', 'skuId', 'itemId', 'productName',
  'currentPrice', 'targetPrice', 'descuentoPct',
  'incentiveType', 'incentiveStatus', 'enrollmentType',
  'startDate', 'expirationDate', 'enrollmentDate',
  'inventoryCount', 'stockTotal', 'esWFS',
  'baseReferralFee', 'reducedReferralFee',
  'incentiveId', 'productUrl',
];

/* ============================================================
   DESCARGA
   ============================================================ */

/**
 * Baja todos los incentivos de un estado, paginando.
 *
 * @param {string} status  ELIGIBLE o ENROLLED
 * @param {number} deadline  epoch ms; si se pasa, corta y marca incompleto
 * @return {Array} arreglo de objetos crudos, con .completo
 */
function fetchIncentivos_(status, deadline, presupuesto) {
  const out = [];
  let offset = 0, paginas = 0, completo = true, total = null;

  while (paginas < KD_MAX_PAGINAS) {
    /* Tope compartido entre los dos estados. Es lo que garantiza que
       las ofertas nunca se coman el presupuesto del inventario, sin
       importar cuántas páginas devuelva Walmart. */
    if (presupuesto && presupuesto.restan <= 0) {
      Logger.log('  ⛔ Incentivos ' + status + ': se alcanzó el tope de ' +
                 KD_MAX_LLAMADAS + ' llamadas. Lista INCOMPLETA.');
      completo = false;
      break;
    }

    if (deadline && Date.now() > deadline) {
      Logger.log('  ⏱ Incentivos ' + status + ': se acabó el tiempo en la ' +
                 'página ' + (paginas + 1) + '. Lista INCOMPLETA.');
      completo = false;
      break;
    }

    const d = wmGet_('/v3/price/incentives', {
      incentiveStatus: status,
      limit:  KD_LIMIT,
      offset: offset,
    });
    paginas++;
    if (presupuesto) presupuesto.restan--;

    /* El nombre del arreglo no viene en los docs. Se prueban las formas
       que Walmart usa en sus otras respuestas antes de rendirse. */
    const arr = (d && (d.items || d.incentives || d.priceIncentives ||
                       d.elements || d.payload ||
                       (d.itemResponse && d.itemResponse.items))) ||
                (Array.isArray(d) ? d : []);

    if (!Array.isArray(arr) || !arr.length) {
      if (paginas === 1) {
        // Primera página vacía: puede ser que de verdad no haya nada,
        // o que el arreglo venga con otro nombre. Se deja rastro de la
        // forma real para no quedarse adivinando.
        Logger.log('  ℹ Incentivos ' + status + ': sin items. Llaves de la ' +
                   'respuesta: ' + (d ? Object.keys(d).join(', ') : '(nada)'));
      }
      break;
    }

    // El total puede venir con varios nombres; sirve para saber si acabamos
    if (total === null && d) {
      total = d.totalCount != null ? d.totalCount
            : (d.total != null ? d.total
            : (d.totalResults != null ? d.totalResults : null));
    }

    arr.forEach(function(it){ out.push(it); });
    offset += arr.length;

    if (arr.length < KD_LIMIT) break;              // página incompleta = fin
    if (total != null && offset >= total) break;
    Utilities.sleep(WM_CONFIG.PAGE_PACING_MS);
  }

  if (paginas >= KD_MAX_PAGINAS) completo = false;
  out.completo = completo;
  out.total = total;
  return out;
}

/* ============================================================
   NORMALIZACIÓN
   ============================================================ */

/** Para emparejar llaves sin pelearse con mayúsculas ni separadores */
function kdNorma_(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Aplana un objeto un nivel. Un precio puede venir como
 * {amount: 199, currency: 'MXN'}: se convierte en el número, porque
 * en una hoja de cálculo la moneda en su propia columna es ruido —
 * todo está en MXN.
 */
function kdAplanar_(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(function(k){
    const v = obj[k];
    if (v === null || v === undefined) { out[k] = ''; return; }

    if (Array.isArray(v)) {
      out[k] = v.length ? JSON.stringify(v).substring(0, 500) : '';
      return;
    }

    if (typeof v === 'object') {
      if (v.amount != null) { out[k] = Number(v.amount); return; }
      if (v.value  != null) { out[k] = v.value;          return; }
      Object.keys(v).forEach(function(k2){
        const v2 = v[k2];
        if (v2 !== null && v2 !== undefined && typeof v2 !== 'object') {
          out[k + '_' + k2] = v2;
        }
      });
      return;
    }

    out[k] = v;
  });
  return out;
}

/** Busca el valor de la primera llave que empate con alguno de los nombres */
function kdValor_(fila, nombres) {
  const mapa = {};
  Object.keys(fila).forEach(function(k){ mapa[kdNorma_(k)] = fila[k]; });
  for (let i = 0; i < nombres.length; i++) {
    const v = mapa[kdNorma_(nombres[i])];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

/**
 * Decide el orden de columnas: primero las de KD_PREFERIDAS que de
 * verdad existan, después todo lo demás alfabético.
 */
function kdColumnas_(filas) {
  const vistas = {};
  filas.forEach(function(f){
    Object.keys(f).forEach(function(k){ vistas[k] = true; });
  });

  const cols = [];
  const usadas = {};

  KD_PREFERIDAS.forEach(function(pref){
    const n = kdNorma_(pref);
    Object.keys(vistas).forEach(function(real){
      if (!usadas[real] && kdNorma_(real) === n) {
        cols.push(real);
        usadas[real] = true;
      }
    });
  });

  Object.keys(vistas).sort().forEach(function(real){
    if (!usadas[real]) cols.push(real);
  });

  return cols;
}

/* ============================================================
   SINCRONIZACIÓN
   ============================================================ */

/**
 * Baja los incentivos y escribe la hoja "Killer_Deals".
 *
 * @param {number=} deadline  epoch ms para cortar por tiempo
 * @return {Object} { escritos, elegibles, inscritos, completo, cols }
 */
function sincronizarKillerDeals(deadline) {
  const t0 = Date.now();
  const lim = deadline || (t0 + 120000);

  /* Un solo presupuesto para los dos estados: el tope es del refresco
     completo, no de cada mitad. */
  const presupuesto = { restan: KD_MAX_LLAMADAS };

  const elegibles = fetchIncentivos_('ELIGIBLE', lim, presupuesto);
  const inscritos = fetchIncentivos_('ENROLLED', lim, presupuesto);
  const gastadas  = KD_MAX_LLAMADAS - presupuesto.restan;

  /* Stock de la hoja "Inventario", para saber de qué ofertas SÍ se
     puede surtir. Una oferta sin inventario es un aviso, no una
     oportunidad. Cuesta cero llamadas: la hoja ya está escrita. */
  /* Se leen SOLO tres columnas, cada una por separado. Traer el
     rectángulo completo del master son ~108,000 celdas de un jalón y
     es lo que provoca "Se agotó el tiempo de espera del servicio Hojas
     de cálculo". Aquí el cruce es un lujo, así que si falla se sigue
     sin él: mejor la hoja sin stock que ninguna hoja.                 */
  const stock = {};
  try {
    const sh = getSpreadsheet_().getSheetByName(WM_CONFIG.SHEET_MASTER);
    const n = sh ? sh.getLastRow() - 1 : 0;
    if (n > 0) {
      const cab = pubConReintento_('encabezados del master', function(){
        return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      });
      const iSku = cab.indexOf('sku');
      const iTot = cab.indexOf('stockTotal');
      const iWfs = cab.indexOf('esWFS');

      if (iSku >= 0) {
        const col = function(j){
          if (j < 0) return null;
          return pubConReintento_('columna ' + cab[j], function(){
            return sh.getRange(2, j + 1, n, 1).getValues();
          });
        };
        const cSku = col(iSku), cTot = col(iTot), cWfs = col(iWfs);

        for (let i = 0; i < n; i++) {
          const s = String(cSku[i][0] || '').trim();
          if (s) stock[s] = {
            total: cTot ? cTot[i][0] : '',
            wfs:   cWfs ? cWfs[i][0] : '',
          };
        }
      }
    }
  } catch (e) {
    Logger.log('  ⚠ No pude leer el stock para cruzarlo: ' + e.message +
               '. La hoja se escribe sin stockTotal.');
  }

  const filas = [];

  const agregar = function(lista, etiqueta){
    lista.forEach(function(raw){
      const f = kdAplanar_(raw);

      // Si la respuesta no trae el estado, se pone el que pedimos:
      // sabemos con qué filtro vino.
      if (!kdValor_(f, ['incentiveStatus'])) f.incentiveStatus = etiqueta;

      const actual  = Number(kdValor_(f, ['currentPrice', 'price', 'currentPriceAmount'])) || 0;
      const objetivo = Number(kdValor_(f, ['targetPrice', 'targetPriceAmount'])) || 0;

      /* La columna que de verdad se lee: cuánto hay que bajar el precio.
         Un 8% se piensa distinto que un 40%. */
      f.descuentoPct = (actual > 0 && objetivo > 0)
        ? Math.round((1 - objetivo / actual) * 1000) / 10
        : '';

      const sku = String(kdValor_(f, ['sku', 'skuId', 'sellerSku'])).trim();
      const s = sku && stock[sku] ? stock[sku] : null;
      f.stockTotal = s ? s.total : '';
      f.esWFS      = s ? s.wfs   : '';

      filas.push(f);
    });
  };

  agregar(elegibles, 'ELIGIBLE');
  agregar(inscritos, 'ENROLLED');

  const completo = elegibles.completo !== false && inscritos.completo !== false;

  /* Reja: si la descarga vino incompleta y ya había una hoja escrita,
     no se sobreescribe. Media lista de ofertas se ve igual que una
     lista completa, y ahí se toman decisiones de precio. */
  const sh = getSheet_(WM_CONFIG.SHEET_KILLER);
  const habia = Math.max(0, sh.getLastRow() - 1);

  if (!completo && habia) {
    Logger.log('⏭ Killer Deals: la descarga vino incompleta (' + filas.length +
               ' contra ' + habia + ' que ya había). No se sobreescribe.');
    return { escritos: 0, skipped: true, reason: 'descarga incompleta',
             elegibles: elegibles.length, inscritos: inscritos.length };
  }

  const cols = filas.length ? kdColumnas_(filas) : KD_PREFERIDAS.slice(0, 8);

  const values = [cols].concat(filas.map(function(f){
    return cols.map(function(c){ return f[c] != null ? f[c] : ''; });
  }));

  // Se escribe encima y se limpia el sobrante: nunca hay hoja vacía.
  const filasAntes = sh.getLastRow();
  const colsAntes  = sh.getLastColumn();

  sh.getRange(1, 1, values.length, cols.length).setValues(values);

  if (filasAntes > values.length) {
    sh.getRange(values.length + 1, 1, filasAntes - values.length,
                Math.max(colsAntes, cols.length)).clearContent();
  }
  if (colsAntes > cols.length) {
    sh.getRange(1, cols.length + 1, Math.max(filasAntes, values.length),
                colsAntes - cols.length).clearContent();
  }

  // Se guarda la FECHA, no el timestamp: la regla es "una vez al día",
  // y comparar fechas es lo que dice si ya le tocó hoy.
  PropertiesService.getScriptProperties().setProperty(
    KD_PROP_ULTIMO,
    Utilities.formatDate(new Date(), kdZona_(), 'yyyy-MM-dd'));

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  Logger.log('✅ Killer Deals: ' + filas.length + ' incentivos (' +
             elegibles.length + ' elegibles, ' + inscritos.length +
             ' inscritos) en ' + elapsed + 's');

  return {
    escritos: filas.length,
    elegibles: elegibles.length,
    inscritos: inscritos.length,
    completo: completo,
    cols: cols,
    gastadas: gastadas,
    elapsedSec: elapsed,
  };
}

/**
 * ¿Toca refrescar las ofertas solas?
 *
 * Sí cuando: no ha corrido hoy Y estamos en la ventana de la mañana.
 * También sí, a cualquier hora, si ya lleva KD_DIAS_GRACIA sin correr.
 *
 * @return {boolean}
 */
/**
 * La zona horaria con la que se decide "las 6 a.m.".
 *
 * Fija en WM_CONFIG.ZONA (CDMX). Las cuentas que ejecutan esto siempre
 * son de CDMX, así que no hay nada que averiguar — y averiguarlo era
 * el riesgo: ni la zona del script ni la del Sheet están garantizadas,
 * y una mal puesta corre la ventana varias horas sin avisar.
 *
 * @return {string}
 */
function kdZona_() {
  return WM_CONFIG.ZONA;
}

function kdTocaRefrescar_() {
  const tz    = kdZona_();
  const ahora = new Date();
  const hoy   = Utilities.formatDate(ahora, tz, 'yyyy-MM-dd');
  const hora  = Number(Utilities.formatDate(ahora, tz, 'H'));

  const last = String(PropertiesService.getScriptProperties()
                        .getProperty(KD_PROP_ULTIMO) || '');

  if (last === hoy) return false;        // ya corrió hoy

  // Válvula de escape: si la ventana se perdió varios días seguidos
  // (triggers caídos de madrugada), se deja correr a cualquier hora.
  if (/^\d{4}-\d{2}-\d{2}$/.test(last)) {
    const dias = (ahora - new Date(last + 'T12:00:00Z')) / 86400000;
    if (dias >= KD_DIAS_GRACIA) {
      Logger.log('  ℹ Killer Deals: ' + dias.toFixed(0) + ' días sin correr. ' +
                 'Se ignora la ventana de la mañana.');
      return true;
    }
  }

  return hora >= KD_HORA_INICIO && hora < KD_HORA_FIN;
}

/* ============================================================
   ENTRADAS PÚBLICAS (menú)
   ============================================================ */

/**
 * Refresca la hoja a mano y devuelve el reporte en pantalla.
 * @return {string}
 */
function refrescarKillerDeals() {
  /* Mismo candado que el triaje: los triggers escriben el Sheet cada
     15 y cada 30 minutos, y dos procesos sobre la misma hoja hacen que
     el servicio de Hojas de cálculo se agote. */
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return 'AHORA NO SE PUEDE\n\n' +
           'Hay una sincronización corriendo en este momento.\n' +
           'Espérate unos 30 segundos y vuelve a darle.\n\n' +
           '(No es un error: es el candado que evita que dos\n' +
           'procesos escriban la misma hoja al mismo tiempo.)';
  }

  let r;
  try {
    r = sincronizarKillerDeals();
  } finally {
    lock.releaseLock();
  }

  const L = [];

  if (r.skipped) {
    L.push('NO SE ESCRIBIÓ LA HOJA');
    L.push('');
    L.push('Motivo: ' + r.reason);
    L.push('Llegaron ' + r.elegibles + ' elegibles y ' + r.inscritos + ' inscritos,');
    L.push('pero la lista vino cortada. Se conservó la hoja anterior:');
    L.push('media lista de ofertas se ve igual que una completa, y aquí');
    L.push('se toman decisiones de precio.');
    L.push('');
    L.push('Vuelve a correrlo en un rato.');
    return L.join('\n');
  }

  L.push('KILLER DEALS / INCENTIVOS DE PRECIO');
  L.push('');
  L.push('  ' + r.elegibles + '  elegibles   <- Walmart te los ofrece');
  L.push('  ' + r.inscritos + '  inscritos   <- ya los aceptaste');
  L.push('  ' + r.escritos + '  filas en la hoja "' + WM_CONFIG.SHEET_KILLER + '"');
  L.push('');

  if (!r.escritos) {
    L.push('La API contestó pero sin items. Puede ser que ahora mismo');
    L.push('no haya ofertas, o que la respuesta venga con otra forma.');
    L.push('Corre "Incentivos — ver respuesta cruda" para saber cuál de');
    L.push('las dos es.');
    return L.join('\n');
  }

  L.push('COLUMNAS QUE DEVOLVIÓ WALMART');
  L.push('');
  (r.cols || []).forEach(function(c){ L.push('  ' + c); });
  L.push('');
  L.push('La hoja se arma con las llaves reales de la respuesta, no con');
  L.push('una lista fija: si Walmart agrega un campo, aparece solo.');
  L.push('');
  L.push('Ordena por descuentoPct para ver dónde duele menos, y cruza');
  L.push('con stockTotal: una oferta sin inventario no es oportunidad.');
  L.push('');
  L.push('Listo en ' + r.elapsedSec + 's · ' + r.gastadas + ' llamadas.');
  L.push('');
  const tz = kdZona_();
  L.push('Corre solo UNA vez al día, entre las ' + KD_HORA_INICIO +
         ' y las ' + KD_HORA_FIN + ' a.m. de CDMX,');
  L.push('cuando la cuota del día está intacta. Este botón es para');
  L.push('cuando lo quieras ya.');
  L.push('');
  L.push('Ahora en CDMX son las ' +
         Utilities.formatDate(new Date(), tz, 'HH:mm') + '.');

  return L.join('\n');
}

/**
 * Una sola llamada, JSON crudo. Para ver los nombres reales de los
 * campos cuando algo no cuadra.
 * @return {string}
 */
function diagnosticarIncentivos() {
  const p = nuevoLog_();

  p('══════════════════════════════════════════════════════');
  p('  GET /v3/price/incentives — RESPUESTA CRUDA');
  p('══════════════════════════════════════════════════════');
  p('');
  p('  Mercado: ' + WM_CONFIG.MARKET + '   Versión: ' + WM_CONFIG.API_VERSION);
  p('');

  ['ELIGIBLE', 'ENROLLED'].forEach(function(st){
    p('── incentiveStatus=' + st + ' ──');
    const r = probe_('/v3/price/incentives', { incentiveStatus: st, limit: 3 });
    p('   HTTP ' + r.code);

    if (r.ok) {
      if (r.data) p('   llaves de primer nivel: ' + Object.keys(r.data).join(', '));
      p('');
      p('   JSON (primeros 2500 caracteres):');
      p(String(r.body).substring(0, 2500));
    } else {
      p('');
      p('   ' + String(r.body).substring(0, 600));
      p('');
      if (String(r.code) === '400') {
        p('   Un 400 aquí suele ser un parámetro que este mercado no');
        p('   acepta. El endpoint existe.');
      } else if (String(r.code) === '401' || String(r.code) === '403') {
        p('   401/403 = el endpoint existe pero esta cuenta no tiene');
        p('   el permiso. Se pide a tu contacto de Walmart, igual que');
        p('   el WFS avanzado.');
      } else if (String(r.code) === '404') {
        p('   404 = la ruta no existe en este mercado, aunque la');
        p('   referencia global diga que mx está soportado.');
      }
    }
    p('');
    Utilities.sleep(400);
  });

  p('── QUÉ SIGUE ──');
  p('');
  p('  Si arriba hay un 200 con items, corre');
  p('  "Refrescar Killer Deals" y la hoja se llena sola.');

  return p.texto();
}

/* ============================================================
   DIAGNÓSTICO — tipos de reporte de la cuenta
   ============================================================ */

/** Tipos de reporte que ya conocemos, para no reportarlos como hallazgo */
const KD_TIPOS_CONOCIDOS = ['ITEM_MX', 'INVENTORY_MX', 'ITEM', 'INVENTORY'];

/** Palabras que delatan un reporte de ofertas / promociones / precios */
const KD_PALABRAS = [
  'PROMO', 'DEAL', 'PRICE', 'PRICING', 'GROWTH', 'OPPORTUNIT',
  'RECOMMEND', 'COMPET', 'BUYBOX', 'BUY_BOX', 'CAMPAIGN', 'INCENTIVE',
];

/**
 * Recorre TODAS las solicitudes de reporte de la cuenta y saca el
 * inventario de tipos que existen de verdad.
 *
 * La cuenta tiene ~458 solicitudes y solo 219 son ITEM_MX /
 * INVENTORY_MX: hay 239 de tipos que nunca miramos. Cuesta ~5-10
 * llamadas y no descarga ningún reporte.
 *
 * @return {string}
 */
function diagnosticarTiposDeReporte() {
  const p = nuevoLog_();

  p('══════════════════════════════════════════════════════');
  p('  ¿QUÉ TIPOS DE REPORTE TIENE ESTA CUENTA?');
  p('══════════════════════════════════════════════════════');
  p('');

  const tipos = {}, ejemplo = {};
  let cursor = null, paginas = 0, total = 0;
  const MAX = 10;

  while (paginas < MAX) {
    const params = { limit: 100 };
    if (cursor) params.nextCursor = cursor;

    const r = probe_('/v3/reports/reportRequests', params);
    paginas++;

    if (!r.ok) {
      p('❌ Página ' + paginas + ': HTTP ' + r.code);
      p('   ' + String(r.body).substring(0, 300));
      break;
    }

    const d = r.data || {};
    const arr = d.requests || d.reportRequests || d.results ||
                (Array.isArray(d) ? d : []);

    if (!arr.length) { p('   Página ' + paginas + ': vacía. Fin.'); break; }

    arr.forEach(function(it){
      const t = String(it.reportType || it.type || '(sin tipo)').toUpperCase();
      tipos[t] = (tipos[t] || 0) + 1;
      if (!ejemplo[t]) ejemplo[t] = it;
      total++;
    });

    p('   Página ' + paginas + ': ' + arr.length + ' (acumulado ' + total + ')');
    cursor = d.nextCursor || d.cursor || null;
    if (!cursor) break;
    Utilities.sleep(400);
  }

  p('');
  p('── TIPOS ENCONTRADOS ──');
  p('');

  const nombres = Object.keys(tipos).sort(function(a, b){ return tipos[b] - tipos[a]; });
  if (!nombres.length) {
    p('   Ninguno. La API no devolvió solicitudes.');
    return p.texto();
  }

  const candidatos = [];
  nombres.forEach(function(t){
    let interesante = false;
    for (let i = 0; i < KD_PALABRAS.length; i++) {
      if (t.indexOf(KD_PALABRAS[i]) >= 0) { interesante = true; break; }
    }
    if (interesante) candidatos.push(t);
    const nuevo = KD_TIPOS_CONOCIDOS.indexOf(t) < 0;
    p('   ' + (interesante ? '⭐' : (nuevo ? '  ' : '· ')) + ' ' +
      String(tipos[t]).padStart(4) + '  ' + t);
  });

  p('');
  if (candidatos.length) {
    p('── CANDIDATOS ──');
    p('');
    candidatos.forEach(function(t){
      p('   ' + t + '  (' + tipos[t] + ')');
      const e = ejemplo[t] || {};
      Object.keys(e).slice(0, 12).forEach(function(k){
        const v = e[k];
        const s = (v && typeof v === 'object') ? JSON.stringify(v).substring(0, 80) : String(v);
        p('      ' + pad_(k, 22) + ' ' + s);
      });
      p('');
    });
  } else {
    p('   Solo reportes de items e inventario. Las ofertas no salen');
    p('   por esta vía — salen por /v3/price/incentives.');
  }

  p('');
  p('   Llamadas gastadas: ~' + paginas);
  return p.texto();
}
