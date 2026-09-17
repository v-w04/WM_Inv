/**
 * ============================================================
 *  Publicacion — triaje de SKUs que Walmart NO tiene publicados
 * ============================================================
 *
 *  El problema: de ~3,271 SKUs del catálogo, ~1,500 no están
 *  PUBLISHED. Algunos no se pueden publicar nunca (restricción del
 *  catálogo de Walmart, que no se puede editar). Otros están mal
 *  publicados y SÍ tienen arreglo (precio, información). Y otros
 *  simplemente nadie los ha revisado.
 *
 *  Sin separar esos tres casos, la lista completa es ruido: no se
 *  puede saber dónde hay dinero recuperable.
 *
 *  ── Cómo funciona ──────────────────────────────────────────
 *
 *  Dos hojas, con dueños distintos. Esa separación es el diseño:
 *
 *    "Bloqueados"      LA TUYA. El script SOLO la lee, jamás la
 *                      escribe. Aquí tú dictaminas.
 *
 *    "No_Publicados"   LA DEL SCRIPT. Se regenera en cada corrida.
 *                      Es la lista de trabajo, ya cruzada con tu
 *                      dictamen. No escribas aquí: se sobreescribe.
 *
 *  ── Los tres estados ───────────────────────────────────────
 *
 *    BLOQUEADO       Walmart no lo permite y no hay nada que hacer.
 *                    Deja de gastar llamadas a la API y deja de
 *                    aparecer como pendiente.
 *
 *    MAL_PUBLICADO   Está mal el precio o la información, pero SÍ
 *                    hay algo que hacer. Se sigue consultando su
 *                    inventario y sigue apareciendo como pendiente.
 *
 *    REPUBLICADO     Ya hiciste el esfuerzo. Si se logró, el SKU
 *                    sale solo de la lista en la siguiente corrida
 *                    (porque Walmart ya lo reporta PUBLISHED). Si
 *                    sigue sin publicarse, aparece marcado — eso
 *                    significa que el intento no funcionó.
 *
 *    (vacío)         POR ANALIZAR. Nadie lo ha dictaminado.
 *
 *  El motivo que da Walmart NO se inventa aquí: viene en
 *  /v3/items como `unpublishedReasons` y `lifecycleStatus`. Ya se
 *  estaban capturando en Api.gs y se tiraban a la basura. Ahora se
 *  escriben. Cuesta CERO llamadas extra.
 */

/** Los únicos valores que el script reconoce en la columna estado */
const PUB_ESTADOS = ['BLOQUEADO', 'MAL_PUBLICADO', 'REPUBLICADO'];

/** Piso de SKUs que el barrido debe conservar aunque el dictamen diga otra cosa */
const PUB_MIN_BARRIDO = 100;

/** Columnas de la hoja que llena la usuaria */
const BLOQ_COLS = ['sku', 'estado', 'motivo', 'skuNuevo', 'fecha', 'nota'];

/** Columnas de la lista de trabajo que genera el script */
const NOPUB_COLS = [
  'sku', 'miEstado', 'publishedStatus', 'lifecycleStatus', 'motivoWalmart',
  'price', 'stockTotal', 'esWFS', 'productName', 'shelf',
  'skuNuevo', 'nota', 'vistoDesde',
];

/**
 * Orden en que se muestran. Lo accionable arriba: si abres la hoja
 * y solo alcanzas a ver 20 filas, que sean las que importan.
 */
const NOPUB_ORDEN = {
  'POR ANALIZAR':  0,
  'MAL_PUBLICADO': 1,
  'REPUBLICADO':   2,
  'BLOQUEADO':     3,
};

/* ============================================================
   LECTURA DEL DICTAMEN DE LA USUARIA
   ============================================================ */

/**
 * Lee la hoja "Bloqueados".
 *
 * Falla en seguro: si la hoja no existe, está vacía o la lectura
 * truena, regresa el mapa vacío. Eso significa "nadie bloqueado",
 * que es el comportamiento de siempre — nunca se destruye nada por
 * no poder leer esta hoja.
 *
 * @return {{mapa:Object, nBloqueados:number, ok:boolean, basura:number}}
 */
function leerBloqueados_() {
  const out = { mapa: {}, nBloqueados: 0, ok: false, basura: 0 };

  try {
    const sh = getSpreadsheet_().getSheetByName(WM_CONFIG.SHEET_BLOQUEADOS);
    if (!sh) return out;                    // todavía no se ha creado

    const last = sh.getLastRow();
    if (last < 2) { out.ok = true; return out; }   // solo encabezados

    const vals = sh.getRange(2, 1, last - 1, BLOQ_COLS.length).getValues();

    vals.forEach(function(r){
      const sku = String(r[0] || '').trim();
      if (!sku) return;

      // Se tolera que escriba "mal publicado", "Mal Publicado", etc.
      const estado = String(r[1] || '').trim().toUpperCase().replace(/\s+/g, '_');

      if (PUB_ESTADOS.indexOf(estado) < 0) {
        // Una fila con SKU pero sin estado válido no se adivina: se
        // cuenta y se reporta. Adivinar aquí sería decidir por ella
        // si un SKU deja de consultarse.
        out.basura++;
        return;
      }

      out.mapa[sku] = {
        estado:   estado,
        motivo:   String(r[2] || '').trim(),
        skuNuevo: String(r[3] || '').trim(),
        nota:     String(r[5] || '').trim(),
      };
      if (estado === 'BLOQUEADO') out.nBloqueados++;
    });

    out.ok = true;

  } catch (e) {
    Logger.log('  ⚠ No pude leer "' + WM_CONFIG.SHEET_BLOQUEADOS + '": ' +
               e.message + '. Se sigue sin excluir a nadie.');
  }

  return out;
}

/**
 * Devuelve el conjunto de SKUs que NO se deben consultar en el barrido.
 *
 * Reja: si el dictamen dejaría el barrido en menos de PUB_MIN_BARRIDO
 * SKUs, no se excluye a nadie. Eso solo puede pasar por un error al
 * llenar la hoja (pegar 3,000 filas de golpe, un filtro mal aplicado),
 * y el daño sería apagar el inventario completo en silencio.
 *
 * @param {Object} bloq  resultado de leerBloqueados_()
 * @param {number} totalCatalogo  cuántos SKUs tiene el catálogo
 * @return {Object} mapa sku -> true
 */
function skusExcluidos_(bloq, totalCatalogo) {
  const fuera = {};
  if (!bloq || !bloq.ok || !bloq.nBloqueados) return fuera;

  const quedarian = totalCatalogo - bloq.nBloqueados;
  if (quedarian < PUB_MIN_BARRIDO) {
    Logger.log('  ⛔ "' + WM_CONFIG.SHEET_BLOQUEADOS + '" marca ' + bloq.nBloqueados +
               ' BLOQUEADOS de ' + totalCatalogo + ' SKUs: el barrido quedaría en ' +
               quedarian + '. Eso parece un error al llenar la hoja, no una ' +
               'decisión. No se excluye a nadie. Revisa la hoja.');
    return fuera;
  }

  Object.keys(bloq.mapa).forEach(function(sku){
    if (bloq.mapa[sku].estado === 'BLOQUEADO') fuera[sku] = true;
  });
  return fuera;
}

/* ============================================================
   LA HOJA DE LA USUARIA — se crea una vez y no se vuelve a tocar
   ============================================================ */

/**
 * Crea "Bloqueados" con encabezados y una lista desplegable en la
 * columna de estado.
 *
 * Solo actúa si la hoja NO existe. Si ya existe, esta función no
 * escribe nada: es la hoja de la usuaria y el formato es suyo.
 *
 * @return {boolean} true si la creó, false si ya existía
 */
function crearHojaBloqueados_() {
  const ss = getSpreadsheet_();
  if (ss.getSheetByName(WM_CONFIG.SHEET_BLOQUEADOS)) return false;

  const sh = ss.insertSheet(WM_CONFIG.SHEET_BLOQUEADOS);
  sh.getRange(1, 1, 1, BLOQ_COLS.length).setValues([BLOQ_COLS]);

  // La columna A como texto: hay SKUs que son puros dígitos y Sheets
  // les come los ceros iniciales, y entonces no empatan con el catálogo.
  sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');

  // Desplegable en la columna estado. Sin esto se escribe a mano y
  // cualquier variante ("bloqueado?", "BLOQ") se ignora en silencio.
  const regla = SpreadsheetApp.newDataValidation()
    .requireValueInList(PUB_ESTADOS, true)
    .setAllowInvalid(true)     // permisivo: mejor una nota rara que un bloqueo
    .setHelpText('BLOQUEADO = ya no me digas nada. ' +
                 'MAL_PUBLICADO = hay algo que hacer. ' +
                 'REPUBLICADO = ya lo intenté.')
    .build();
  sh.getRange(2, 2, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(regla);

  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, BLOQ_COLS.length).setFontWeight('bold');

  return true;
}

/* ============================================================
   LA LISTA DE TRABAJO
   ============================================================ */

/**
 * Escribe "No_Publicados" a partir de las filas del catálogo.
 *
 * No cuesta llamadas: `rows` ya está en memoria cuando syncMain la
 * llama, y desde el menú se relee de la hoja "Inventario".
 *
 * `vistoDesde` se conserva por SKU: es la primera vez que lo vimos
 * sin publicar. Es el dato que dice si algo lleva una semana roto o
 * seis meses.
 *
 * @param {Array} rows  filas del catálogo (objetos con sku, publishedStatus…)
 * @param {Object} bloq resultado de leerBloqueados_()
 * @return {Object} conteos por estado
 */
function escribirNoPublicados_(rows, bloq) {
  const sh = getSheet_(WM_CONFIG.SHEET_NOPUB);
  const mapa = (bloq && bloq.mapa) || {};

  // Fechas de "visto desde" de la corrida anterior
  const antes = {};
  const lastRow = sh.getLastRow();
  if (lastRow > 1) {
    const cabeceras = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const iSku = cabeceras.indexOf('sku');
    const iDesde = cabeceras.indexOf('vistoDesde');
    if (iSku >= 0 && iDesde >= 0) {
      const viejo = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
      viejo.forEach(function(r){
        const s = String(r[iSku] || '').trim();
        if (s && r[iDesde]) antes[s] = r[iDesde];
      });
    }
  }

  const hoy = new Date();
  const conteo = { 'POR ANALIZAR': 0, 'MAL_PUBLICADO': 0, 'REPUBLICADO': 0, 'BLOQUEADO': 0 };
  const lista = [];

  rows.forEach(function(r){
    const estadoWm = String(r.publishedStatus || '').trim().toUpperCase();
    if (estadoWm === 'PUBLISHED') return;      // este no es problema

    const sku = String(r.sku || '').trim();
    if (!sku) return;

    const dictamen = mapa[sku] || null;
    const mio = dictamen ? dictamen.estado : 'POR ANALIZAR';
    conteo[mio] = (conteo[mio] || 0) + 1;

    lista.push({
      sku:             sku,
      miEstado:        mio,
      publishedStatus: estadoWm || '(sin dato)',
      lifecycleStatus: r.lifecycleStatus || '',
      // El motivo viene de Walmart. Por el camino de la API la clave es
      // unpublishedReasons; releído de la hoja ya viene como motivoWalmart.
      motivoWalmart:   r.motivoWalmart || r.unpublishedReasons || '',
      price:           r.price != null ? r.price : '',
      stockTotal:      r.stockTotal != null ? r.stockTotal : '',
      esWFS:           r.esWFS || '',
      productName:     r.productName || '',
      shelf:           r.shelf || '',
      skuNuevo:        dictamen ? dictamen.skuNuevo : '',
      nota:            dictamen ? dictamen.nota : '',
      vistoDesde:      antes[sku] || hoy,
    });
  });

  /* Orden: primero por qué tan accionable es, luego por stock de mayor
     a menor. Un SKU sin publicar con 40 piezas en bodega es dinero
     parado; uno con cero es trámite. */
  lista.sort(function(a, b){
    const oa = NOPUB_ORDEN[a.miEstado] != null ? NOPUB_ORDEN[a.miEstado] : 9;
    const ob = NOPUB_ORDEN[b.miEstado] != null ? NOPUB_ORDEN[b.miEstado] : 9;
    if (oa !== ob) return oa - ob;
    const sa = Number(a.stockTotal) || 0;
    const sb = Number(b.stockTotal) || 0;
    if (sa !== sb) return sb - sa;
    return a.sku < b.sku ? -1 : 1;
  });

  const values = [NOPUB_COLS].concat(lista.map(function(o){
    return NOPUB_COLS.map(function(c){ return o[c] != null ? o[c] : ''; });
  }));

  /* Igual que en writeMasterSheet_: se escribe ENCIMA y se limpia el
     sobrante al final. Nunca hay un instante con la hoja vacía. */
  const filasAntes = sh.getLastRow();
  const colsAntes  = sh.getLastColumn();

  const colSku = sh.getRange(1, 1, Math.max(values.length, 2), 1);
  if (colSku.getNumberFormat() !== '@') colSku.setNumberFormat('@');

  sh.getRange(1, 1, values.length, NOPUB_COLS.length).setValues(values);

  if (filasAntes > values.length) {
    sh.getRange(values.length + 1, 1, filasAntes - values.length,
                Math.max(colsAntes, NOPUB_COLS.length)).clearContent();
  }
  if (colsAntes > NOPUB_COLS.length) {
    sh.getRange(1, NOPUB_COLS.length + 1, Math.max(filasAntes, values.length),
                colsAntes - NOPUB_COLS.length).clearContent();
  }

  conteo.total = lista.length;
  return conteo;
}

/* ============================================================
   ENTRADAS PÚBLICAS (menú)
   ============================================================ */

/**
 * Regenera "No_Publicados" leyendo la hoja "Inventario".
 * Cero llamadas a la API. Se puede correr cuantas veces se quiera.
 *
 * @return {string} reporte para mostrar en pantalla
 */
function refrescarNoPublicados() {
  const t0 = Date.now();
  const creada = crearHojaBloqueados_();

  const rows = readSheetAsObjects_(WM_CONFIG.SHEET_MASTER);
  if (!rows.length) {
    return 'La hoja "' + WM_CONFIG.SHEET_MASTER + '" está vacía.\n' +
           'Corre primero "Sincronizar ahora".';
  }

  const bloq = leerBloqueados_();
  const c = escribirNoPublicados_(rows, bloq);

  const lineas = [];
  if (creada) {
    lineas.push('Creé la hoja "' + WM_CONFIG.SHEET_BLOQUEADOS + '".');
    lineas.push('Ahí dictaminas tú. El script solo la lee.');
    lineas.push('');
  }

  lineas.push('CATÁLOGO');
  lineas.push('  ' + rows.length + ' SKUs en total');
  lineas.push('  ' + (rows.length - c.total) + ' publicados');
  lineas.push('  ' + c.total + ' SIN publicar');
  lineas.push('');
  lineas.push('DE LOS QUE NO ESTÁN PUBLICADOS');
  lineas.push('  ' + c['POR ANALIZAR']  + '  por analizar   <- aquí está el trabajo');
  lineas.push('  ' + c['MAL_PUBLICADO'] + '  mal publicados');
  lineas.push('  ' + c['REPUBLICADO']   + '  republicados (siguen sin salir)');
  lineas.push('  ' + c['BLOQUEADO']     + '  bloqueados por ti');

  if (bloq.basura) {
    lineas.push('');
    lineas.push('OJO: ' + bloq.basura + ' fila(s) de "' + WM_CONFIG.SHEET_BLOQUEADOS +
                '" tienen SKU pero el estado no es válido.');
    lineas.push('Usa el desplegable de la columna B. Esas filas se ignoraron.');
  }

  if (c['BLOQUEADO']) {
    lineas.push('');
    lineas.push('Los ' + c['BLOQUEADO'] + ' bloqueados salen del barrido de');
    lineas.push('inventario en la próxima corrida de "Sincronizar ahora".');
  }

  lineas.push('');
  lineas.push('Listo en ' + ((Date.now() - t0) / 1000).toFixed(1) + 's. ' +
              'Sin gastar llamadas a la API.');

  return lineas.join('\n');
}

/**
 * Resumen sin reescribir nada: cuántos hay de cada estado de Walmart.
 * Sirve para entender de qué tamaño es el problema antes de meterle mano.
 *
 * @return {string} reporte para mostrar en pantalla
 */
function resumenPublicacion() {
  const rows = readSheetAsObjects_(WM_CONFIG.SHEET_MASTER);
  if (!rows.length) {
    return 'La hoja "' + WM_CONFIG.SHEET_MASTER + '" está vacía.\n' +
           'Corre primero "Sincronizar ahora".';
  }

  const bloq = leerBloqueados_();
  const porEstado = {};
  const porMotivo = {};
  let sinPublicar = 0, stockParado = 0, valorParado = 0;

  rows.forEach(function(r){
    const est = String(r.publishedStatus || '(sin dato)').trim().toUpperCase() || '(sin dato)';
    porEstado[est] = (porEstado[est] || 0) + 1;
    if (est === 'PUBLISHED') return;

    sinPublicar++;
    const dictamen = bloq.mapa[String(r.sku || '').trim()];
    if (dictamen && dictamen.estado === 'BLOQUEADO') return;

    const stock = Number(r.stockTotal) || 0;
    if (stock > 0) {
      stockParado += stock;
      valorParado += stock * (Number(r.price) || 0);
    }

    const motivo = String(r.motivoWalmart || r.unpublishedReasons || '').trim() || '(Walmart no dio motivo)';
    porMotivo[motivo] = (porMotivo[motivo] || 0) + 1;
  });

  const lineas = [];
  lineas.push('ESTADO SEGÚN WALMART');
  Object.keys(porEstado).sort(function(a, b){ return porEstado[b] - porEstado[a]; })
    .forEach(function(k){
      lineas.push('  ' + String(porEstado[k]).padStart(5) + '  ' + k);
    });

  lineas.push('');
  lineas.push('MOTIVOS (solo los que NO has bloqueado)');
  const motivos = Object.keys(porMotivo).sort(function(a, b){ return porMotivo[b] - porMotivo[a]; });
  if (!motivos.length) {
    lineas.push('  nada pendiente');
  } else {
    motivos.slice(0, 12).forEach(function(k){
      const corto = k.length > 58 ? k.slice(0, 55) + '...' : k;
      lineas.push('  ' + String(porMotivo[k]).padStart(5) + '  ' + corto);
    });
    if (motivos.length > 12) {
      lineas.push('  ... y ' + (motivos.length - 12) + ' motivos más. ' +
                  'La lista completa está en "' + WM_CONFIG.SHEET_NOPUB + '".');
    }
  }

  lineas.push('');
  lineas.push('DINERO PARADO');
  lineas.push('  ' + sinPublicar + ' SKUs sin publicar');
  lineas.push('  ' + stockParado + ' piezas en bodega que no se pueden vender');
  lineas.push('  $' + valorParado.toLocaleString('es-MX', { maximumFractionDigits: 0 }) +
              ' a precio de lista');
  lineas.push('');
  lineas.push('(No cuenta los que ya marcaste BLOQUEADO.)');

  return lineas.join('\n');
}
