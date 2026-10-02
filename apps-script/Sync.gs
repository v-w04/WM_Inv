/**
 * ============================================================
 *  Sync — Dos procesos independientes
 * ============================================================
 *
 *  1) syncMain()          cada 10 min · catálogo (3,271) + WFS (471) ≈ 90 seg
 *     → escribe la hoja "Inventario" completa
 *
 *  2) syncRegularChunk()  cada 5 min · barre inventario normal por partes
 *     → escribe/actualiza la hoja "Inv_Normal", guarda su posición y continúa
 *       en la siguiente corrida. Ciclo completo ≈ 2 h para 3,271 SKUs.
 *
 *  Usan LockService para no pisarse.
 */

/* ============================================================
   1. SYNC PRINCIPAL — catálogo + WFS
   ============================================================ */
function syncMain() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('⏭ syncMain: otra corrida en curso, se salta.');
    return { skipped: true };
  }

  try {
    const t0 = Date.now();
    const deadline = t0 + WM_CONFIG.BUDGET_MAIN_MS;

    // Marca el turno AL EMPEZAR, no al terminar.
    //
    // Si se marca solo cuando termina bien y syncMain falla (cuota, red),
    // nunca queda registro de que corrió. El barrido entonces cree que
    // syncMain lleva horas esperando turno y cede indefinidamente:
    // los dos se quedan bloqueados y no corre ninguno.
    PropertiesService.getScriptProperties()
      .setProperty(WM_CONFIG.PROP_LAST_MAIN, String(Date.now()));

    if (cuotaGoogleAgotada_()) {
      Logger.log('⏭ syncMain: Google reportó cuota agotada hoy. Se salta.');
      return { skipped: true, reason: 'cuota de Google agotada' };
    }

    /* ── ¿Toca bajar el catálogo completo? ───────────────────────
       El stock de WFS se mueve con cada venta, así que eso sí se
       refresca cada 15 min: son 3 llamadas.

       El catálogo (nombres, precios, publishedStatus) casi no cambia,
       y bajarlo cuesta ~17 llamadas. Repaginarlo 96 veces al día era
       el 65% de todo el consumo del proyecto para releer lo mismo.
       Ahora se baja una vez por hora; el resto de las corridas lo
       relee de la hoja, que no cuesta ni una llamada.               */
    const propsS = PropertiesService.getScriptProperties();
    const lastCat = Number(propsS.getProperty(WM_CONFIG.PROP_LAST_CATALOG) || 0);
    const minsSinCat = lastCat ? (Date.now() - lastCat) / 60000 : 999999;
    let tocaCatalogo = minsSinCat >= WM_CONFIG.CATALOG_REFRESH_MIN;

    // Si no alcanza el presupuesto, mejor no empezar a medias.
    const restan = fetchRestantes_();
    const costo = tocaCatalogo ? 60 : 15;
    if (restan < costo) {
      Logger.log('⏭ syncMain: solo quedan ' + restan + ' llamadas hoy ' +
                 '(esta corrida necesita ~' + costo + '). Se salta.');
      return { skipped: true, reason: 'sin presupuesto' };
    }

    Logger.log('▶ syncMain arrancando... (' + restan + ' llamadas disponibles hoy)');

    /* ── WFS ────────────────────────────────────────────────────
       Aquí un dato faltante NO es un hueco: es una mentira. Si la
       lista viene corta, cada SKU ausente se escribe como
       esWFS='NO', wfsDisponible=0 — o sea "no hay nada en la bodega
       de Walmart" sobre mercancía que sí está ahí.
       Por eso se compara contra el último conteo bueno conocido.     */
    const wfsList = getAllWfsInventory();
    const ultimoWfs = Number(propsS.getProperty(WM_CONFIG.PROP_WFS_COUNT) || 0);

    if (wfsList.completo === false ||
        (ultimoWfs && wfsList.length < ultimoWfs * 0.9)) {
      Logger.log('⏭ syncMain: el inventario WFS vino corto (' + wfsList.length +
                 ' contra ' + ultimoWfs + ' conocidos). Escribirlo pondría ' +
                 'ceros falsos sobre mercancía real. Se salta la corrida.');
      logRun_('syncMain', 0, ((Date.now() - t0) / 1000).toFixed(1),
              'SALTADA: WFS incompleto (' + wfsList.length + '/' + ultimoWfs + ')');
      return { skipped: true, reason: 'WFS incompleto' };
    }

    const wfsBySku = {};
    wfsList.forEach(function(w){ if (w.sku) wfsBySku[w.sku] = w; });

    // El conteo bueno conocido. Es la vara con la que se mide todo
    // lo que llegue: escribir menos que esto es destruir datos.
    const ultimoN = Number(propsS.getProperty(WM_CONFIG.PROP_MASTER_COUNT) || 0);

    // Catálogo: de la API si toca, de la hoja si no
    let items, origenCat;
    if (tocaCatalogo) {
      items = getAllItems(deadline);
      origenCat = 'API';

      /* ── Guardarraíl del catálogo bajado de la API ──────────────
         getAllItems corta por tiempo y devuelve lo que alcanzó, sin
         quejarse. Escribir esa lista parcial hacía dos daños a la vez:
         writeMasterSheet_ borraba los SKUs faltantes de Inventario, y
         ensureRegularSheet_ podaba Inv_Normal a esa lista corta —
         tirando a la basura horas de barrido.
         Ante una lista incompleta NO se escribe nada: se conserva la
         hoja de la corrida anterior, que está completa.              */
      if (items.completo === false) {
        Logger.log('⏭ syncMain: el catálogo vino INCOMPLETO (' + items.length +
                   (items.totalWalmart ? ' de ' + items.totalWalmart : '') +
                   '). No se reescribe la hoja.');
        return { skipped: true, reason: 'catálogo incompleto' };
      }
      if (ultimoN && items.length < ultimoN * 0.95) {
        Logger.log('⏭ syncMain: el catálogo trajo ' + items.length +
                   ' contra ' + ultimoN + ' conocidos (menos del 95%). ' +
                   'Se sospecha truncado: no se reescribe la hoja.');
        return { skipped: true, reason: 'catálogo sospechosamente corto' };
      }
    } else {
      items = leerCatalogoDelMaster_();
      origenCat = 'hoja (catálogo de hace ' + minsSinCat.toFixed(0) + ' min)';

      // Guardarraíl: la hoja se reescribe entera con lo que aquí se lea.
      // Si por lo que sea vino incompleta (lectura a media escritura, alguien
      // borrando filas), escribirla de vuelta convertiría un accidente en
      // pérdida de datos. Ante la duda, se paga la API.
      //
      // El umbral es 95%, no 50%. Con 50% una hoja al 60% pasaba, se
      // reescribía con ese 60%, y PROP_MASTER_COUNT bajaba a ese número:
      // la siguiente corrida ya aceptaba el 30%. Cada ciclo consolidaba
      // la pérdida en vez de detenerla.
      if (ultimoN && items.length < ultimoN * 0.95) {
        Logger.log('  ⚠ La hoja solo trajo ' + items.length + ' SKUs de ~' + ultimoN +
                   '. No se reescribe con eso: se baja el catálogo de la API.');
        items = [];
      }

      if (!items.length) {
        // Primera corrida, hoja vacía, o el guardarraíl de arriba.
        // Esta corrida se presupuestó como "ligera" (~15 llamadas) y ahora
        // resulta que necesita el catálogo completo. Se revisa otra vez
        // antes de arrancarlo: dejarlo a medias sería peor.
        if (fetchRestantes_() < 60) {
          Logger.log('⏭ syncMain: hace falta el catálogo completo y ya no ' +
                     'alcanza el presupuesto. Se salta esta corrida.');
          return { skipped: true, reason: 'sin presupuesto para el catálogo' };
        }
        Logger.log('  ℹ No hay catálogo confiable que releer. Se baja de la API.');
        items = getAllItems(deadline);
        origenCat = 'API (la hoja no servía)';
        tocaCatalogo = true;

        // Mismo guardarraíl que arriba: por este camino también se
        // reescribe la hoja, así que también hay que exigir que esté completo.
        if (items.completo === false ||
            (ultimoN && items.length < ultimoN * 0.95)) {
          Logger.log('⏭ syncMain: el catálogo de respaldo tampoco vino ' +
                     'completo (' + items.length + '). No se reescribe nada.');
          return { skipped: true, reason: 'catálogo incompleto' };
        }
      }
    }

    if (!items.length) throw new Error('El catálogo regresó vacío — revisa el log.');
    if (tocaCatalogo) propsS.setProperty(WM_CONFIG.PROP_LAST_CATALOG, String(Date.now()));
    Logger.log('  Catálogo: ' + items.length + ' items desde ' + origenCat);

    /* Inventario propio ya consultado. Desde 1.3 se lee de la propia hoja
       maestra: es la unica fuente, y asi los valores dan la vuelta sin
       perderse cuando se reescribe Inventario.                          */
    const propioBySku = leerStockPropio_();

    /* ── Tu dictamen de publicación (1.1) ──────────────────────
       La hoja "Bloqueados" la llenas tú; aquí solo se lee. Si no
       existe o la lectura falla, el mapa viene vacío y todo se
       comporta como antes: nadie excluido, nada destruido.         */
    const bloq = leerBloqueados_();
    const fuera = skusExcluidos_(bloq, items.length);
    const nFuera = Object.keys(fuera).length;

    // Merge: una fila por SKU del catálogo, con WFS e inventario propio
    const rows = items.map(function(it){
      const w = wfsBySku[it.sku] || {};
      const pr = propioBySku[it.sku] || {};
      const enWfs = !!w.sku;
      const wfsDisp = enWfs ? (w.wfsAvailToSell != null ? Number(w.wfsAvailToSell) : 0) : 0;
      const dictamen = bloq.mapa[it.sku] || null;
      const bloqueado = !!fuera[it.sku];

      /* El inventario propio se deja VACÍO si nunca se ha consultado.
         Un 0 diría "no hay stock"; un hueco dice "todavía no sé", que
         es la verdad mientras el barrido no llega a ese SKU.

         Y en un SKU BLOQUEADO se blanquea a propósito: sale del
         barrido, así que su número dejaría de refrescarse. Conservarlo
         sería peor que no tenerlo — un dato viejo que se ve igual de
         fresco que los demás. La marca queda en invRevisado.          */
      const tienePropio = !bloqueado && pr.cantidad !== undefined && pr.cantidad !== '';
      const propio = tienePropio ? Number(pr.cantidad) : '';

      return Object.assign({}, it, {
        lifecycleStatus:  it.lifecycleStatus || '',
        // Por el camino de la API la clave es unpublishedReasons;
        // releído de la hoja ya viene como motivoWalmart.
        motivoWalmart:    it.motivoWalmart || it.unpublishedReasons || '',
        miEstado:         dictamen ? dictamen.estado : '',
        esWFS:            enWfs ? 'SÍ' : 'NO',
        offerId:          w.offerId || '',
        // Sin WFS = 0 real, no celda vacía. Un hueco se lee como "no sé";
        // aquí sí sabemos: no está en WFS, así que no hay stock ahí.
        wfsDisponible:    wfsDisp,
        invNormal:        propio,
        stockTotal:       tienePropio ? (wfsDisp + propio) : wfsDisp,
        invRevisado:      bloqueado ? 'bloqueado' : (pr.revisado || ''),
        wfsEnMano:        enWfs ? (w.wfsOnHand != null ? w.wfsOnHand : 0) : 0,
        wfsReservado:     enWfs ? (w.wfsReserved != null ? w.wfsReserved : 0) : 0,
        wfsInbound:       w.wfsInbound != null ? w.wfsInbound : '',
        wfsEstado:        w.wfsStockStatus || '',
        wfsTipoNodo:      w.wfsShipNodeType || '',
        wfsActualizado:   w.wfsModifiedDate || '',
        wfsPrimerStock:   w.wfsFirstInStock || '',
        // Campos del endpoint nuevo (vacíos mientras siga el legacy)
        wfsEdad0_90:      w.wfsAge0_90 != null ? w.wfsAge0_90 : '',
        wfsEdad91_180:    w.wfsAge91_180 != null ? w.wfsAge91_180 : '',
        wfsEdad181_270:   w.wfsAge181_270 != null ? w.wfsAge181_270 : '',
        wfsEdad271_365:   w.wfsAge271_365 != null ? w.wfsAge271_365 : '',
        wfsEdad365plus:   w.wfsAgeOver365 != null ? w.wfsAgeOver365 : '',
        wfsProyS1_4:      w.wfsForecastW1_4 != null ? w.wfsForecastW1_4 : '',
        wfsProyS5_8:      w.wfsForecastW5_8 != null ? w.wfsForecastW5_8 : '',
        wfsProyS9_12:     w.wfsForecastW9_12 != null ? w.wfsForecastW9_12 : '',
        wfsSellThrough:   w.wfsSellThrough != null ? w.wfsSellThrough : '',
        wfsDiasSupply:    w.wfsDaysOfSupply != null ? w.wfsDaysOfSupply : '',
        wfsFechaOOS:      w.wfsOutOfStockDate || '',
        wfsSugeridas:     w.wfsSuggestedUnits != null ? w.wfsSuggestedUnits : '',
        wfsExcedente:     w.wfsSurplusUnits != null ? w.wfsSurplusUnits : '',
      });
    });

    /* ── Última reja antes de escribir ──────────────────────────
       Todo lo de arriba (paginar catálogo, WFS, leer Inv_Normal) ya
       consumió tiempo. Apps Script mata la ejecución a los 360 s, y
       si eso pasa a media escritura la hoja queda inconsistente.
       Si no queda margen holgado para las dos hojas, mejor no empezar:
       los datos viejos completos valen más que datos nuevos a medias. */
    const usados = Date.now() - t0;
    if (usados > 300000) {
      Logger.log('⏭ syncMain: ya van ' + (usados / 1000).toFixed(0) + ' s. ' +
                 'No alcanza para escribir con seguridad. Se salta la escritura.');
      logRun_('syncMain', 0, (usados / 1000).toFixed(1),
              'SALTADA: sin tiempo para escribir');
      return { skipped: true, reason: 'sin tiempo para escribir' };
    }

    writeMasterSheet_(rows);
    propsS.setProperty(WM_CONFIG.PROP_MASTER_COUNT, String(rows.length));
    propsS.setProperty(WM_CONFIG.PROP_WFS_COUNT, String(wfsList.length));
    /* Desde 1.3 no hay hoja auxiliar: el barrido trabaja sobre esta misma
       hoja. Los BLOQUEADOS siguen fuera de su cola -- cada uno cuesta una
       llamada por corrida y no se pueden vender -- solo que ahora eso se
       decide leyendo la columna miEstado, no podando otra hoja.         */
    if (nFuera) {
      Logger.log('  ℹ Barrido: ' + nFuera + ' SKUs BLOQUEADOS fuera de la cola. ' +
                 'Quedan ' + (rows.length - nFuera) + ' por barrer.');
    }

    /* ── Lista de trabajo de publicación ───────────────────────
       SOLO cuando se bajó el catálogo de la API.

       Al principio esto corría en cada corrida, y fue un error:
       `publishedStatus` y `motivoWalmart` únicamente pueden cambiar
       cuando el catálogo se vuelve a bajar. En las otras 3 de cada 4
       corridas se reescribían 1,500 filas para dejarlas idénticas.

       Y no era solo desperdicio: con eso syncMain escribía TRES hojas
       grandes en la misma ejecución (Inventario + Inv_Normal +
       No_Publicados), y el servicio de Hojas de cálculo se cansa —
       "Se agotó el tiempo de espera del servicio Hojas de cálculo".

       Va en try aparte: es una comodidad, no el trabajo principal. Si
       truena, el inventario ya quedó escrito y eso es lo que no se
       puede perder.                                                   */
    if (tocaCatalogo) {
      try {
        const cPub = escribirNoPublicados_(rows, bloq);
        Logger.log('  Publicación: ' + cPub.total + ' sin publicar · ' +
                   cPub['POR ANALIZAR'] + ' por analizar · ' +
                   cPub['BLOQUEADO'] + ' bloqueados' +
                   (nFuera ? ' (' + nFuera + ' fuera del barrido)' : ''));
      } catch (ePub) {
        Logger.log('  ⚠ No pude escribir "' + WM_CONFIG.SHEET_NOPUB + '": ' +
                   ePub.message);
      }
    }

    invalidateCache_();

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const conWfs = rows.filter(function(r){ return r.esWFS === 'SÍ'; }).length;
    Logger.log('✅ syncMain OK: ' + rows.length + ' SKUs (' + conWfs + ' en WFS) en ' + elapsed + 's' +
               ' · quedan ' + fetchRestantes_() + ' llamadas hoy');
    logRun_('syncMain', rows.length, elapsed,
            conWfs + ' en WFS' + (tocaCatalogo ? ' · catálogo completo' : ' · solo WFS'));
    return {
      count: rows.length, wfs: conWfs, elapsedSec: elapsed,
      catalogoCompleto: tocaCatalogo,
    };

  } finally {
    // El contador de llamadas vive en memoria durante la corrida
    // (para no reventar el limite de PropertiesService). Aqui se vuelca
    // a disco pase lo que pase, incluso si la corrida murio con error.
    grabarContadorFetch_();
    lock.releaseLock();
  }
}

/* ============================================================
   2. BARRIDO POR PARTES — inventario normal (1 llamada por SKU)
   ============================================================ */
function syncRegularChunk() {
  // ── Cede el turno si syncMain lleva rato sin poder correr ──
  // Sin esto, el barrido acapara el lock 4 de cada 5 minutos y syncMain
  // se queda sin ejecutar (medido: pasó de 10 min a 123 min entre corridas).
  const propsCede = PropertiesService.getScriptProperties();
  const lastMain = Number(propsCede.getProperty(WM_CONFIG.PROP_LAST_MAIN) || 0);
  const minsSinMain = lastMain ? (Date.now() - lastMain) / 60000 : 999;

  if (minsSinMain > WM_CONFIG.REFRESH_INTERVAL_MIN - 1) {
    /* Ceder está bien cuando syncMain corrió y falló. Pero si syncMain
       NUNCA arranca — trigger borrado, o desactivado por Google tras
       fallos repetidos — minsSinMain solo crece y el barrido cede para
       siempre: se apagan los dos procesos a la vez, en silencio.
       Por eso se cede como máximo 3 corridas seguidas.                */
    const cedidas = Number(propsCede.getProperty(WM_CONFIG.PROP_CEDIDAS) || 0);
    if (cedidas < 3) {
      propsCede.setProperty(WM_CONFIG.PROP_CEDIDAS, String(cedidas + 1));
      Logger.log('⏭ Cediendo el turno a syncMain (lleva ' +
                 minsSinMain.toFixed(0) + ' min sin correr). ' +
                 'Cesión ' + (cedidas + 1) + ' de 3.');
      return { skipped: true, reason: 'cede a syncMain' };
    }
    Logger.log('⚠ syncMain lleva ' + minsSinMain.toFixed(0) + ' min sin correr ' +
               'y ya cedí 3 veces. Parece que sus triggers no existen. ' +
               'Sigo con el barrido para no apagarnos los dos.');
  }
  propsCede.setProperty(WM_CONFIG.PROP_CEDIDAS, '0');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('⏭ syncRegularChunk: otra corrida en curso, se salta.');
    return { skipped: true };
  }

  try {
    const t0 = Date.now();
    const deadline = t0 + WM_CONFIG.BUDGET_CHUNK_MS;

    /* Hoja maestra unica (1.3). Las columnas se localizan por su
       encabezado real, nunca por letra: si se agrega una columna al final
       o cambia el modo WFS, esto sigue apuntando al lugar correcto.     */
    const sh = getSheet_(WM_CONFIG.SHEET_MASTER);
    const lastRow = sh.getLastRow();
    if (lastRow < 2) {
      Logger.log('⏭ ' + WM_CONFIG.SHEET_MASTER + ' vacia. Corre syncMain() primero.');
      return { skipped: true, reason: 'sin SKUs' };
    }

    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                   .map(function(h){ return String(h).trim(); });
    const cSku  = head.indexOf('sku') + 1;
    const cWfs  = head.indexOf('wfsDisponible') + 1;
    const cMi   = head.indexOf('miEstado') + 1;
    const cProp = head.indexOf('invNormal') + 1;
    const cTot  = head.indexOf('stockTotal') + 1;
    const cRev  = head.indexOf('invRevisado') + 1;
    if (cSku < 1 || cWfs < 1 || cMi < 1 || cProp < 1 || cTot < 1 || cRev < 1) {
      Logger.log('⛔ El encabezado de ' + WM_CONFIG.SHEET_MASTER + ' no trae las ' +
                 'columnas del barrido. No se barre nada.');
      logRun_('chunk', 0, 0, 'SALTADA: faltan columnas en ' + WM_CONFIG.SHEET_MASTER);
      return { skipped: true, reason: 'faltan columnas' };
    }

    if (cuotaGoogleAgotada_()) {
      Logger.log('⏭ Barrido: Google reportó cuota agotada hoy. Se salta.');
      return { skipped: true, reason: 'cuota de Google agotada' };
    }

    const restan = fetchRestantes_();
    const tope = Math.min(WM_CONFIG.MAX_SKUS_POR_CHUNK, Math.max(0, restan - 100));
    if (tope <= 0) {
      Logger.log('⏭ Barrido: sin presupuesto propio hoy (' + restan + ' restantes).');
      return { skipped: true, reason: 'sin presupuesto' };
    }

    /* ── Armar la cola de trabajo ──────────────────────────────
       Sin cursor de posición: se buscan las filas que faltan.
       Un cursor se corrompe cuando el catálogo crece o Walmart
       devuelve los items en otro orden — y entonces el avance
       se reinicia solo, sin que nadie se entere.

       Prioridad 1: los que nunca se han consultado
       Prioridad 2: los más viejos primero
       ────────────────────────────────────────────────────────── */
    const total = lastRow - 1;

    /* Se leen SOLO las 5 columnas que el barrido necesita, una por una,
       en vez del rectangulo completo de ~26: la hoja maestra es ancha y
       leerla entera es lo que cansaba al servicio de Hojas.             */
    const colSku  = sh.getRange(2, cSku,  total, 1).getValues();
    const colWfs  = sh.getRange(2, cWfs,  total, 1).getValues();
    const colMi   = sh.getRange(2, cMi,   total, 1).getValues();
    const colProp = sh.getRange(2, cProp, total, 1).getValues();
    const colRev  = sh.getRange(2, cRev,  total, 1).getValues();

    /* `datos` conserva la forma de siempre -- [sku, cantidad, unidad,
       revisado] -- para que el bucle de abajo no cambie en nada.
       invRevisado puede traer el texto "bloqueado": no es fecha.        */
    const datos = [];
    for (let i = 0; i < total; i++) {
      datos.push([
        colSku[i][0],
        (colProp[i][0] === '' || colProp[i][0] === null) ? '' : colProp[i][0],
        'EACH',
        colRev[i][0] instanceof Date ? colRev[i][0] : '',
      ]);
    }

    const esBloqueado = function(i){
      return String(colMi[i][0] || '').trim().toUpperCase() === 'BLOQUEADO';
    };

    const nuevos = [];
    const viejos = [];

    for (let i = 0; i < datos.length; i++) {
      const sku = String(datos[i][0] || '').trim();
      if (!sku) continue;
      // Los BLOQUEADOS son decision de la duena: no se consultan nunca.
      if (esBloqueado(i)) continue;
      const tieneDato = datos[i][1] !== '' && datos[i][1] !== null;
      if (!tieneDato) {
        nuevos.push(i);
      } else {
        const ts = datos[i][3] instanceof Date ? datos[i][3].getTime() : 0;
        viejos.push({ i: i, ts: ts });
      }
    }
    viejos.sort(function(a, b){ return a.ts - b.ts; });

    const cola = nuevos.concat(viejos.map(function(v){ return v.i; })).slice(0, tope);

    if (!cola.length) {
      Logger.log('⏭ Nada que barrer.');
      return { skipped: true, reason: 'cola vacía' };
    }

    Logger.log('▶ Barrido: ' + cola.length + ' SKUs de la cola  (' +
               nuevos.length + ' sin dato, ' + viejos.length + ' a refrescar)');

    /* ── Procesar ────────────────────────────────────────────── */
    let hechos = 0, errores = 0, fallosSeguidos = 0;
    let throttled = false, sinPresupuesto = false;
    const tocados = [];   // indices de `datos` que realmente cambiaron

    for (let k = 0; k < cola.length; k++) {
      if (Date.now() > deadline) break;

      const idx = cola[k];
      const sku = String(datos[idx][0]).trim();

      /* Una excepción aquí (típicamente PropertiesService pasándose de
         operaciones) escapaba del bucle y se saltaba el bloque de
         guardado de abajo: hasta 200 llamadas ya pagadas se tiraban
         sin escribir nada, y se repetía en cada corrida.
         Ahora el SKU que truena cuenta como error y la corrida sigue. */
      let inv;
      try {
        inv = getInventoryForSku(sku);
      } catch (e) {
        Logger.log('  ⚠ Excepción con ' + sku + ': ' + (e && e.message || e));
        errores++;
        fallosSeguidos++;
        if (fallosSeguidos >= 8) {
          Logger.log('  ⚠ Demasiadas excepciones seguidas — se corta y se guarda.');
          break;
        }
        continue;
      }

      if (inv.sinPresupuesto) {
        sinPresupuesto = true;
        Logger.log('  ⏹ Presupuesto agotado a media corrida. Se guarda el avance.');
        break;
      }

      if (inv.ok) {
        fallosSeguidos = 0;
        hechos++;
        datos[idx][1] = inv.qty;
        datos[idx][2] = inv.unit;
        datos[idx][3] = new Date();
        tocados.push(idx);
      } else {
        errores++;
        fallosSeguidos++;
        if (inv.throttled) throttled = true;
        // No se toca la celda: queda en la cola para el siguiente intento
        if (fallosSeguidos >= 8) {
          Logger.log('  ⚠ ' + fallosSeguidos + ' fallos seguidos' +
                     (throttled ? ' (HTTP 429 — throttling)' : '') +
                     ' — se corta y se guarda el avance.');
          break;
        }
      }

      Utilities.sleep(throttled ? WM_CONFIG.SKU_PACING_MS * 4 : WM_CONFIG.SKU_PACING_MS);
    }

    /* ── Guardar SOLO las filas que se tocaron ───────────────────────── */
    /* Antes se reescribia el bloque COMPLETO (1,666 filas x 4 columnas)
       con el objeto `sh` abierto al ARRANCAR la corrida, hasta 4 minutos
       antes de escribir.

       Medido el 30/09/2026 con dos fotos del Sheet y un barrido en medio:
       el barrido consulto 115 SKUs, actualizarStockEnMaster_ SI dejo sus
       fechas en Inventario -- o sea el arreglo `datos` estaba bien -- y en
       Inv_Normal no cambio ni una celda. En 8 horas y ~2,900 llamadas solo
       33 filas avanzaron: la escritura del bloque completo se perdia en
       silencio.

       Ahora se reabre la hoja al momento de escribir, se verifica que cada
       fila siga teniendo el mismo SKU, y se escriben unicamente los
       renglones consultados, en bloques contiguos, sin tocar la columna A.
       Asi una escritura ajena cuesta un renglon, no la hoja entera; y si
       aun asi no queda, se dice en la bitacora en vez de reportar trabajo
       que no existe.                                                     */
    let escritas = 0;
    if (tocados.length) {
      const shW  = getSpreadsheet_().getSheetByName(WM_CONFIG.SHEET_MASTER);
      const vivo = shW.getRange(2, cSku, total, 1).getValues();
      const contiguas = (cTot === cProp + 1 && cRev === cProp + 2);

      tocados.sort(function(a, b){ return a - b; });

      const bloques = [];
      let ini = -1, prev = -2, movidas = 0;
      for (let t = 0; t < tocados.length; t++) {
        const i = tocados[t];
        if (String(vivo[i][0] || '').trim() !== String(datos[i][0] || '').trim()) {
          movidas++;
          continue;   // la hoja se movio bajo los pies: esa fila no se escribe
        }
        if (i !== prev + 1) {
          if (ini >= 0) bloques.push([ini, prev]);
          ini = i;
        }
        prev = i;
      }
      if (ini >= 0) bloques.push([ini, prev]);
      if (movidas) {
        Logger.log('  ⚠ ' + movidas + ' filas cambiaron de SKU durante la ' +
                   'corrida. No se escriben.');
      }

      bloques.forEach(function(b){
        const n = b[1] - b[0] + 1;
        const vals = [];
        for (let k = b[0]; k <= b[1]; k++) {
          const propio = Number(datos[k][1]);
          const wfsQty = Number(colWfs[k][0]) || 0;
          // stockTotal = lo que hay en WFS + lo que hay en bodega propia.
          vals.push([propio, wfsQty + propio, datos[k][3]]);
        }
        if (contiguas) {
          shW.getRange(b[0] + 2, cProp, n, 3).setValues(vals);
        } else {
          shW.getRange(b[0] + 2, cProp, n, 1)
             .setValues(vals.map(function(v){ return [v[0]]; }));
          shW.getRange(b[0] + 2, cTot,  n, 1)
             .setValues(vals.map(function(v){ return [v[1]]; }));
          shW.getRange(b[0] + 2, cRev,  n, 1)
             .setValues(vals.map(function(v){ return [v[2]]; }));
        }
        escritas += n;
      });
      SpreadsheetApp.flush();

      /* Comprobar que de veras quedo. Un barrido que reporta 200 SKUs y
         no guarda nada es peor que uno que falla: nadie se entera.
         Esto es lo que descubrio, el 30/09/2026, que las escrituras a la
         vieja hoja Inv_Normal se perdian en silencio.                   */
      if (bloques.length) {
        const f0  = bloques[0][0] + 2;
        const chk = shW.getRange(f0, cRev, 1, 1).getValue();
        if (!(chk instanceof Date) || chk.getTime() < t0) {
          const nota = 'ESCRITURA PERDIDA en ' + WM_CONFIG.SHEET_MASTER + ' · ' +
                       hechos + ' consultados · ' + escritas + ' escritas · ' +
                       bloques.length + ' bloques · ' + movidas + ' movidas · ' +
                       'fila ' + f0 + ' col ' + cRev;
          Logger.log('  ⛔ ' + nota);
          logRun_('chunk', escritas, ((Date.now() - t0) / 1000).toFixed(1), nota);
          return { processed: escritas, errores: errores, escrituraPerdida: true };
        }
      }

      // Ya se escribio en la hoja maestra: no hay nada que reflejar aparte.
      invalidateCache_();
    }

    /* ── Reportar cobertura, no posición ─────────────────────── */
    /* Cobertura sobre la COLA real: filas con SKU que no estan BLOQUEADAS.
       Ni el alto de la hoja ni los bloqueados inflan el porcentaje.     */
    let conDato = 0, conSku = 0;
    for (let i = 0; i < datos.length; i++) {
      if (!String(datos[i][0] || '').trim()) continue;
      if (esBloqueado(i)) continue;
      conSku++;
      if (datos[i][1] !== '' && datos[i][1] !== null) conDato++;
    }
    const pct = conSku ? Math.round(conDato / conSku * 100) : 0;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    Logger.log('✅ Barrido: ' + hechos + ' SKUs en ' + elapsed + 's' +
               (errores ? ' · ' + errores + ' errores' : '') +
               '  →  ' + escritas + ' guardadas  ->  cobertura ' + conDato + '/' + conSku +
               ' (' + pct + '%)' +
               ' · quedan ' + fetchRestantes_() + ' llamadas hoy');

    logRun_('chunk', hechos, elapsed,
            escritas + ' guardadas · cobertura ' + conDato + '/' + conSku +
            ' (' + pct + '%)' +
            (sinPresupuesto ? ' · sin presupuesto' : ''));

    return {
      processed: hechos, errores: errores, escritas: escritas,
      cubiertos: conDato, total: conSku, pct: pct,
      elapsedSec: elapsed,
    };

  } finally {
    // El contador de llamadas vive en memoria durante la corrida
    // (para no reventar el limite de PropertiesService). Aqui se vuelca
    // a disco pase lo que pase, incluso si la corrida murio con error.
    grabarContadorFetch_();
    lock.releaseLock();
  }
}

/* ============================================================
   Barrido — sin cursor
   ============================================================
   El barrido ya no lleva posición: cada corrida busca las filas
   que le faltan. Estas funciones quedan por compatibilidad.
   ============================================================ */
function getInvCursor_() { return 0; }

/**
 * Vacia el inventario PROPIO de la hoja maestra para forzar un barrido
 * completo. Los SKUs y todo lo de WFS se conservan: stockTotal se deja
 * en el stock de WFS, que es dato real y no se vuelve a consultar aqui.
 */
function reiniciarBarrido() {
  const sh = getSheet_(WM_CONFIG.SHEET_MASTER);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) { Logger.log(WM_CONFIG.SHEET_MASTER + ' esta vacia.'); return; }

  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                 .map(function(h){ return String(h).trim(); });
  const cWfs  = head.indexOf('wfsDisponible') + 1;
  const cProp = head.indexOf('invNormal') + 1;
  const cTot  = head.indexOf('stockTotal') + 1;
  const cRev  = head.indexOf('invRevisado') + 1;
  if (cWfs < 1 || cProp < 1 || cTot < 1 || cRev < 1) {
    Logger.log('⛔ Falta alguna columna del barrido. No se toca nada.');
    return;
  }

  const n   = lastRow - 1;
  const wfs = sh.getRange(2, cWfs, n, 1).getValues();

  sh.getRange(2, cProp, n, 1).setValues(wfs.map(function(){ return ['']; }));
  sh.getRange(2, cTot,  n, 1).setValues(wfs.map(function(w){ return [Number(w[0]) || 0]; }));
  sh.getRange(2, cRev,  n, 1).setValues(wfs.map(function(){ return ['']; }));
  SpreadsheetApp.flush();
  invalidateCache_();

  Logger.log('✅ ' + n + ' SKUs marcados como pendientes.');
  Logger.log('   El barrido los va a consultar de nuevo. WFS quedo intacto.');
}

/* ============================================================
   Escritura de hojas
   ============================================================ */
/**
 * Orden de columnas en la hoja Inventario.
 * Las primeras 9 son las que se usan a diario — mismo orden que en el dashboard.
 */
/* ──────────────────────────────────────────────────────────────
   COLUMNAS DE LA HOJA "Inventario"

   Antes eran 40 fijas y 17 salían SIEMPRE vacías: son campos que
   solo existen en /v3/wfs/inventory (WFS avanzado), y esa cuenta
   todavía no tiene habilitado "Program Eligibility".

   Ahora la lista se arma sola:
     · modo legacy → solo las columnas que de verdad se llenan (23)
     · modo new    → se agregan las 15 de analítica WFS

   El día que Walmart habilite el endpoint nuevo, detectWfsEndpoint_()
   guarda 'new' y las columnas reaparecen sin tocar código.
   ────────────────────────────────────────────────────────────── */
const MASTER_COLS_BASE = [
  // ── Las de uso diario ──
  'sku', 'shelf', 'upc', 'gtin', 'price', 'currency',
  'publishedStatus',
  // ── Por qué no está publicado (1.1) ──
  // Estas tres venían de /v3/items desde siempre y se tiraban a la
  // basura: Api.gs ya las capturaba pero no estaban en esta lista.
  // Escribirlas cuesta CERO llamadas extra.
  'lifecycleStatus',   // ACTIVE / RETIRED / ARCHIVED, según Walmart
  'motivoWalmart',     // unpublishedReasons: el motivo que da Walmart
  'miEstado',          // tu dictamen, de la hoja "Bloqueados"
  'esWFS',
  'wfsDisponible',   // stock en bodega de Walmart (solo SKUs WFS)
  'invNormal',       // stock en TU bodega (los que envías tú)
  'stockTotal',      // la suma — el número que importa de un vistazo
  'invRevisado',     // cuándo se consultó invNormal por última vez
  // ── Resto del catálogo ──
  'productName', 'productType', 'shelfCompleto', 'wpid', 'mart', 'offerId',
  // ── Resto de WFS (esto sí lo trae el endpoint legacy) ──
  'wfsEnMano', 'wfsReservado', 'wfsEstado', 'wfsTipoNodo', 'wfsActualizado',
];

/** Solo con /v3/wfs/inventory habilitado. Con legacy vienen vacías. */
const MASTER_COLS_WFS_PRO = [
  'wfsInbound', 'wfsPrimerStock',
  'wfsEdad0_90', 'wfsEdad91_180', 'wfsEdad181_270', 'wfsEdad271_365', 'wfsEdad365plus',
  'wfsProyS1_4', 'wfsProyS5_8', 'wfsProyS9_12',
  'wfsSellThrough', 'wfsDiasSupply', 'wfsFechaOOS', 'wfsSugeridas', 'wfsExcedente',
];

function getMasterCols_() {
  const modo = PropertiesService.getScriptProperties()
                 .getProperty(WM_CONFIG.PROP_WFS_ENDPOINT);
  return (modo === 'new')
    ? MASTER_COLS_BASE.concat(MASTER_COLS_WFS_PRO)
    : MASTER_COLS_BASE.slice();
}

/** Campos que vienen de /v3/items — los únicos que se pueden releer de la hoja */
const CAMPOS_CATALOGO = [
  'sku', 'shelf', 'upc', 'gtin', 'price', 'currency', 'publishedStatus',
  'productName', 'productType', 'shelfCompleto', 'wpid', 'mart',
  // Vienen de la API igual que los de arriba, así que también hay que
  // releerlos de la hoja. Si no estuvieran aquí, las 3 de cada 4
  // corridas que NO bajan el catálogo los dejarían en blanco.
  'lifecycleStatus', 'motivoWalmart',
  // 'miEstado' NO va aquí a propósito: no viene de la API, se
  // recalcula en cada corrida desde la hoja "Bloqueados".
];

/** Columnas que Sheets debe tratar como TEXTO (si no, se come los ceros iniciales) */
const COLS_TEXTO = ['upc', 'gtin', 'sku'];

/** Columnas de la bitacora. Se usan por NOMBRE, igual que las demas. */
const LOG_COLS = ['Timestamp', 'Proceso', 'Filas', 'Segundos', 'Nota'];

/**
 * Relee el catálogo desde la hoja "Inventario" en vez de la API.
 *
 * Devuelve la misma forma que getAllItems(), pero SOLO con los campos
 * que vienen de /v3/items. Todo lo de WFS y el inventario propio se
 * vuelve a calcular en syncMain con datos frescos, así que no se relee
 * nada que pueda estar viejo.
 *
 * Cuesta CERO llamadas HTTP. Ese es el punto.
 */
function leerCatalogoDelMaster_() {
  const out = [];
  try {
    const sh = getSpreadsheet_().getSheetByName(WM_CONFIG.SHEET_MASTER);
    if (!sh) return out;

    const last = sh.getLastRow();
    const ancho = sh.getLastColumn();
    if (last < 2 || ancho < 1) return out;

    const head = sh.getRange(1, 1, 1, ancho).getValues()[0]
                   .map(function(h){ return String(h).trim(); });
    const idx = {};
    head.forEach(function(h, i){ if (h && idx[h] === undefined) idx[h] = i; });
    if (idx['sku'] === undefined) {
      Logger.log('  ⚠ La hoja no tiene columna "sku". No se puede releer el catálogo.');
      return out;
    }

    const vals = sh.getRange(2, 1, last - 1, ancho).getValues();
    vals.forEach(function(r){
      const sku = String(r[idx['sku']] || '').trim();
      if (!sku) return;
      const o = {};
      CAMPOS_CATALOGO.forEach(function(c){
        o[c] = (idx[c] !== undefined && r[idx[c]] != null) ? r[idx[c]] : '';
      });
      o.sku = sku;
      // upc/gtin son texto con ceros a la izquierda: nunca como número.
      o.upc  = o.upc  === '' ? '' : String(o.upc);
      o.gtin = o.gtin === '' ? '' : String(o.gtin);
      out.push(o);
    });
  } catch (e) {
    Logger.log('  ⚠ No se pudo releer el catálogo de la hoja: ' + e.message);
    return [];
  }
  return out;
}

/**
 * Lee la hoja Inv_Normal a un mapa por SKU.
 * Se usa para pegar el inventario propio al master.
 */
function leerStockPropio_() {
  const mapa = {};
  try {
    const sh = getSpreadsheet_().getSheetByName(WM_CONFIG.SHEET_MASTER);
    if (!sh) return mapa;
    const last = sh.getLastRow();
    if (last < 2) return mapa;

    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                   .map(function(h){ return String(h).trim(); });
    const cSku  = head.indexOf('sku') + 1;
    const cProp = head.indexOf('invNormal') + 1;
    const cRev  = head.indexOf('invRevisado') + 1;
    if (cSku < 1 || cProp < 1 || cRev < 1) {
      Logger.log('  ⚠ "' + WM_CONFIG.SHEET_MASTER + '" no trae sku/invNormal/' +
                 'invRevisado. No se puede leer el stock propio.');
      return mapa;
    }

    const n    = last - 1;
    const skus = sh.getRange(2, cSku,  n, 1).getValues();
    const prop = sh.getRange(2, cProp, n, 1).getValues();
    const rev  = sh.getRange(2, cRev,  n, 1).getValues();

    for (let i = 0; i < n; i++) {
      const sku = String(skus[i][0] || '').trim();
      if (!sku) continue;
      mapa[sku] = {
        cantidad: (prop[i][0] === '' || prop[i][0] === null) ? '' : Number(prop[i][0]),
        unidad:   'EACH',
        // Puede traer el texto "bloqueado": eso NO es fecha, cuenta como sin dato.
        revisado: rev[i][0] instanceof Date ? rev[i][0] : '',
      };
    }
  } catch (e) {
    Logger.log('  ⚠ No se pudo leer el stock propio de ' +
               WM_CONFIG.SHEET_MASTER + ': ' + e.message);
  }
  return mapa;
}

function writeMasterSheet_(rows) {
  if (!rows || !rows.length) return;
  const sh = getSheet_(WM_CONFIG.SHEET_MASTER);
  const MASTER_COLS = getMasterCols_();

  const values = [MASTER_COLS].concat(rows.map(function(r){
    return MASTER_COLS.map(function(c){ return r[c] != null ? r[c] : ''; });
  }));

  // ── REGLA: esta función escribe DATOS, no formato. ──
  // Nada de congelar filas/columnas, colores de encabezado, anchos ni
  // agrupaciones. El formato de la hoja es del usuario; si el script lo
  // reimpone en cada corrida, borra su trabajo cada 10 minutos.
  //
  // La única excepción es el formato TEXTO de upc/gtin: sin él Sheets
  // convierte "00063790259141" a 63790259141 y se pierden los ceros.
  // Eso es corrección de datos, no estética — y solo se aplica si hace falta.

  /* ── Escritura sin ventana vacía ────────────────────────────
     Antes esto era: clearContents() → flush() → setValues().
     Ese flush() COMMITEA la hoja vacía. Si Apps Script mataba la
     ejecución en esa ventana (pasa: el límite es 6 min y arriba ya
     se gastaron varios), la hoja se quedaba en cero.

     Ahora se escribe encima y solo después se limpia lo que sobra.
     En ningún instante la hoja está vacía, y si la ejecución muere
     a medias lo peor que queda son filas viejas de más abajo.       */
  const filasAntes = sh.getLastRow();
  const colsAntes  = sh.getLastColumn();

  COLS_TEXTO.forEach(function(col){
    const i = MASTER_COLS.indexOf(col);
    if (i < 0) return;
    const rango = sh.getRange(1, i + 1, Math.max(values.length, 2), 1);
    // Solo tocar si todavía no es texto, para no reescribir formato sin necesidad
    if (rango.getNumberFormat() !== '@') rango.setNumberFormat('@');
  });

  sh.getRange(1, 1, values.length, MASTER_COLS.length).setValues(values);

  // Sobrantes: filas de más abajo y columnas de más a la derecha
  if (filasAntes > values.length) {
    sh.getRange(values.length + 1, 1,
                filasAntes - values.length,
                Math.max(colsAntes, MASTER_COLS.length)).clearContent();
  }
  if (colsAntes > MASTER_COLS.length) {
    /* Solo se limpian las columnas sobrantes que son NUESTRAS: las que
       quedaron de un cambio de modo WFS (41 columnas -> 26), o las que
       no tienen encabezado. Una columna con un encabezado que no
       conocemos es de la duena y NO se toca.

       Antes se limpiaba todo lo que hubiera a la derecha, y eso borraba
       cualquier columna que ella agregara al final de la hoja -- que es
       justo donde la regla del proyecto le dice que las agregue.      */
    const nSobra  = colsAntes - MASTER_COLS.length;
    const cabSobra = sh.getRange(1, MASTER_COLS.length + 1, 1, nSobra)
                       .getValues()[0].map(function(h){ return String(h).trim(); });
    const nuestras = {};
    MASTER_COLS_BASE.concat(MASTER_COLS_WFS_PRO)
      .forEach(function(c){ nuestras[c] = true; });

    let ajenas = 0;
    const altoLimpiar = Math.max(filasAntes, values.length);
    for (let k = 0; k < nSobra; k++) {
      const h = cabSobra[k];
      if (h && !nuestras[h]) { ajenas++; continue; }   // columna de la duena
      sh.getRange(1, MASTER_COLS.length + 1 + k, altoLimpiar, 1).clearContent();
    }
    if (ajenas) {
      Logger.log('  ℹ ' + ajenas + ' columna(s) extra al final de ' +
                 WM_CONFIG.SHEET_MASTER + ' no son del script: se dejan intactas.');
    }
  }

  SpreadsheetApp.flush();
}

/**
 * Prepara la hoja de inventario normal con la misma lista y orden de SKUs
 * que el master. Conserva las cantidades ya obtenidas de los SKUs que siguen existiendo.
 */
/**
 * Prepara la hoja de inventario normal con la lista de SKUs del master.
 * Conserva las cantidades ya obtenidas.
 * @return {boolean} true si la lista de SKUs cambió (hay que reiniciar el cursor)
 */
/* ⚠ SIN USO desde 1.3 (30/09/2026). Generaba la hoja "Inv_Normal",
   que ya no existe en el flujo: sus escrituras se perdian en silencio y
   el barrido se mudo a la hoja maestra. Se deja por historia; NO volver
   a llamarla sin leer antes la seccion 1.3 de wm-inv-arquitectura.md. */
function ensureRegularSheet_(skus, excluidos) {
  const sh = getSheet_(WM_CONFIG.SHEET_REGULAR);
  const headers = ['sku', 'cantidad', 'unidad', 'revisadoEn'];
  const nExcluidos = Number(excluidos) || 0;

  // Conserva por SKU lo ya consultado. Si un SKU sigue existiendo,
  // su cantidad y su fecha se mantienen aunque cambie de posición.
  const previo = {};
  const previoOrden = [];
  const lastRow = sh.getLastRow();

  if (lastRow > 1) {
    const old = sh.getRange(2, 1, lastRow - 1, 4).getValues();
    old.forEach(function(r){
      const s = String(r[0] || '').trim();
      if (s) { previo[s] = [r[1], r[2], r[3]]; previoOrden.push(s); }
    });
  }

  /* ── Reja: no podar esta hoja con una lista corta ───────────
     Esta es la hoja cara. Sus cantidades cuestan una llamada HTTP
     por SKU y ~9 horas de barrido para rehacerse. Si `skus` viene
     corta, los SKUs ausentes pierden su cantidad y hay que volver
     a pagarlas todas.
     syncMain ya valida el catálogo antes de llegar aquí, pero esta
     función también se puede llamar desde otro lado: la reja vive
     donde está el daño, no donde está el llamador.                  */
  /* Los SKUs que se quitaron a propósito (BLOQUEADO) se suman de vuelta
     antes de comparar. Si no, la primera vez que se bloquean 1,000 SKUs
     la reja lee "llegaron 2,271 de 3,271" y se niega para siempre: la
     función quedaría rota justo por hacer su trabajo.
     Lo que la reja sigue atrapando es el caso real de peligro: una
     lista corta que NADIE pidió recortar.                              */
  const previoN = Object.keys(previo).length;
  if (previoN && (skus.length + nExcluidos) < previoN * 0.95) {
    Logger.log('  ⛔ ensureRegularSheet_: llegaron ' + skus.length +
               ' SKUs (+' + nExcluidos + ' excluidos a propósito) contra ' +
               previoN + ' que ya tenían dato. No se poda la hoja; se deja ' +
               'como está.');
    return;
  }

  /* Si la lista no cambio, no se toca la hoja.
     syncMain corre cada 15 min. Reescribir el bloque completo 96 veces al
     dia para dejarlo identico no aporta nada, y es la otra via por la que
     se perdia el avance del barrido: dos escrituras grandes peleando por
     el mismo rango. La lista solo cambia cuando cambia el catalogo o la
     hoja "Bloqueados".                                                  */
  let igual = previoOrden.length === skus.length;
  if (igual) {
    for (let i = 0; i < skus.length; i++) {
      if (previoOrden[i] !== skus[i]) { igual = false; break; }
    }
  }
  if (igual) {
    Logger.log('  = Inv_Normal: la lista no cambio (' + skus.length +
               ' SKUs). No se reescribe.');
    return;
  }

  if (nExcluidos) {
    Logger.log('  ℹ Barrido: ' + nExcluidos + ' SKUs BLOQUEADOS fuera de la ' +
               'cola. Quedan ' + skus.length + ' por barrer.');
  }

  const values = [headers].concat(skus.map(function(s){
    const p = previo[s];
    return p ? [s, p[0], p[1], p[2]] : [s, '', '', ''];
  }));

  // Igual que arriba: solo datos, sin tocar el formato de la hoja.
  // La única excepción es la columna A como texto: hay SKUs que son
  // puros dígitos y Sheets los convierte a número, perdiendo ceros
  // iniciales — y entonces la consulta a Walmart falla.
  //
  // Y como en writeMasterSheet_: se escribe ENCIMA y se limpia el
  // sobrante al final. Nunca hay un instante con la hoja vacía.
  // Antes, un clearContents()+flush() aquí podía dejar Inv_Normal en
  // cero, y eso costaba 3,300 llamadas y 9 horas recuperarlo.
  const colSku = sh.getRange(1, 1, Math.max(values.length, 2), 1);
  if (colSku.getNumberFormat() !== '@') colSku.setNumberFormat('@');

  sh.getRange(1, 1, values.length, 4).setValues(values);

  if (lastRow > values.length) {
    sh.getRange(values.length + 1, 1, lastRow - values.length, 4).clearContent();
  }
  SpreadsheetApp.flush();
}

/**
 * Copia el inventario propio a las columnas correspondientes de la hoja
 * principal, y recalcula stockTotal.
 *
 * Sin esto, Inventario se quedaría con el dato viejo hasta el siguiente
 * syncMain. Toca SOLO tres columnas — no reescribe la hoja entera.
 *
 * @param {Array} datosRegular filas [sku, cantidad, unidad, revisadoEn]
 */
/* ⚠ SIN USO desde 1.3: el barrido ya escribe directo en la hoja
   maestra, asi que no hay nada que reflejar de una hoja a otra.      */
function actualizarStockEnMaster_(datosRegular) {
  try {
    const sh = getSpreadsheet_().getSheetByName(WM_CONFIG.SHEET_MASTER);
    if (!sh) return;
    const last = sh.getLastRow();
    if (last < 2) return;

    // Las posiciones se leen del encabezado REAL de la hoja, no de la
    // constante: si el modo WFS cambia o alguien mueve una columna,
    // esto sigue escribiendo en el lugar correcto en vez de corromper datos.
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                   .map(function(h){ return String(h).trim(); });
    const cSku   = head.indexOf('sku') + 1;
    const cWfs   = head.indexOf('wfsDisponible') + 1;
    const cProp  = head.indexOf('invNormal') + 1;
    const cTotal = head.indexOf('stockTotal') + 1;
    const cRev   = head.indexOf('invRevisado') + 1;
    if (cSku < 1 || cWfs < 1 || cProp < 1 || cTotal < 1 || cRev < 1) {
      Logger.log('  ⚠ El encabezado de "' + WM_CONFIG.SHEET_MASTER +
                 '" no tiene las columnas de stock. Se salta la actualización.');
      return;
    }

    // Mapa de lo recién consultado
    const nuevo = {};
    datosRegular.forEach(function(r){
      const s = String(r[0] || '').trim();
      if (s) nuevo[s] = { cant: r[1], rev: r[3] };
    });

    const n = last - 1;
    const skus = sh.getRange(2, cSku, n, 1).getValues();
    const wfs  = sh.getRange(2, cWfs, n, 1).getValues();

    const salida = [];
    let cambios = 0;

    for (let i = 0; i < n; i++) {
      const s = String(skus[i][0] || '').trim();
      const d = nuevo[s];
      const wfsQty = Number(wfs[i][0]) || 0;

      if (d && d.cant !== '' && d.cant !== null) {
        const propio = Number(d.cant);
        salida.push([propio, wfsQty + propio, d.rev || '']);
        cambios++;
      } else if (d) {
        salida.push(['', wfsQty, '']);
      } else {
        salida.push([null, null, null]);   // null = no tocar
      }
    }

    if (!cambios) return;

    // Escribir las tres columnas juntas si son contiguas; si no, una por una
    if (cTotal === cProp + 1 && cRev === cProp + 2) {
      const actuales = sh.getRange(2, cProp, n, 3).getValues();
      for (let i = 0; i < n; i++) {
        if (salida[i][0] === null) salida[i] = actuales[i];
      }
      sh.getRange(2, cProp, n, 3).setValues(salida);
    } else {
      const cols = [cProp, cTotal, cRev];
      cols.forEach(function(col, j){
        const actual = sh.getRange(2, col, n, 1).getValues();
        const vals = salida.map(function(r, i){
          return [r[j] === null ? actual[i][0] : r[j]];
        });
        sh.getRange(2, col, n, 1).setValues(vals);
      });
    }
    SpreadsheetApp.flush();

  } catch (e) {
    // No es crítico: el siguiente syncMain lo corrige
    Logger.log('  ⚠ No se pudo reflejar el stock en la hoja principal: ' + e.message);
  }
}

/* ============================================================
   LECTURA para el web app — merge de las dos hojas
   ============================================================ */
function loadRows_() {
  const cached = getCachedData();
  if (cached && cached.rows && cached.rows.length) return cached;

  const master = readSheetAsObjects_(WM_CONFIG.SHEET_MASTER);
  if (!master.length) return { rows: [], ts: 0, progress: null };

  /* Desde 1.3 no hay merge: la hoja maestra ya trae invNormal,
     stockTotal e invRevisado escritos por el barrido. Solo se
     normaliza la fecha a texto para el JSON del dashboard.           */
  const rows = master.map(function(m){
    return Object.assign({}, m, {
      invUnidad:   'EACH',
      invRevisado: m.invRevisado instanceof Date
                     ? m.invRevisado.toISOString()
                     : (m.invRevisado || ''),
    });
  });

  // Cobertura = cuántos SKUs YA tienen dato de inventario.
  // Es distinto del cursor: el cursor es la posición del recorrido actual
  // y vuelve a cero en cada ciclo, la cobertura solo sube.
  let conDato = 0;
  Object.keys(regular).forEach(function(s){
    if (regular[s].invNormal !== '' && regular[s].invNormal !== undefined) conDato++;
  });

  const progress = {
    cubiertos: conDato,
    total: master.length,
    pctCobertura: master.length ? Math.round((conDato / master.length) * 100) : 0,
  };

  const payload = { rows: rows, ts: Date.now(), progress: progress };
  cacheData_(payload);
  return payload;
}

function readSheetAsObjects_(sheetName) {
  try {
    const sh = getSpreadsheet_().getSheetByName(sheetName);
    if (!sh) return [];
    const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];

    const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0].map(String);
    const out = [];
    for (let i = 1; i < values.length; i++) {
      const o = {};
      for (let j = 0; j < headers.length; j++) {
        const v = values[i][j];
        o[headers[j]] = (v instanceof Date) ? v.toISOString() : v;
      }
      out.push(o);
    }
    return out;
  } catch (e) {
    Logger.log('⚠ readSheetAsObjects_(' + sheetName + '): ' + e.message);
    return [];
  }
}

/* ============================================================
   Cache
   ============================================================ */
function cacheData_(payload) {
  try {
    const json = JSON.stringify(payload);
    if (json.length > WM_CONFIG.MAX_CACHE_BYTES) {
      Logger.log('  ℹ Dataset ' + Math.round(json.length/1024) + 'KB — se sirve desde Sheet');
      return;
    }
    const cache = CacheService.getScriptCache();
    const chunkSize = 90 * 1024;
    const chunks = [];
    for (let i = 0; i < json.length; i += chunkSize) chunks.push(json.substring(i, i + chunkSize));
    const put = {};
    put[WM_CONFIG.CACHE_INVENTORY + '_n'] = String(chunks.length);
    chunks.forEach(function(c, i){ put[WM_CONFIG.CACHE_INVENTORY + '_' + i] = c; });
    cache.putAll(put, WM_CONFIG.CACHE_TTL_SECONDS);
  } catch (e) {
    Logger.log('  ⚠ Cache falló (no crítico): ' + e.message);
  }
}

function getCachedData() {
  try {
    const cache = CacheService.getScriptCache();
    const nStr = cache.get(WM_CONFIG.CACHE_INVENTORY + '_n');
    if (!nStr) return null;
    const n = Number(nStr);
    let json = '';
    for (let i = 0; i < n; i++) {
      const c = cache.get(WM_CONFIG.CACHE_INVENTORY + '_' + i);
      if (c === null) return null;
      json += c;
    }
    return JSON.parse(json);
  } catch (e) { return null; }
}

function invalidateCache_() {
  try {
    const cache = CacheService.getScriptCache();
    const nStr = cache.get(WM_CONFIG.CACHE_INVENTORY + '_n');
    if (!nStr) return;
    const keys = [WM_CONFIG.CACHE_INVENTORY + '_n'];
    for (let i = 0; i < Number(nStr); i++) keys.push(WM_CONFIG.CACHE_INVENTORY + '_' + i);
    cache.removeAll(keys);
  } catch (e) {}
}

/* ============================================================
   Log
   ============================================================ */
function logRun_(tipo, count, elapsed, nota) {
  try {
    const sh = getSheet_(WM_CONFIG.SHEET_LOG);
    if (sh.getLastRow() === 0) {
      sh.appendRow(LOG_COLS.slice());
    }

    /* La fila se arma segun el encabezado REAL, no en orden fijo: si un
       dia alguien reordena o inserta una columna en la bitacora, cada
       valor sigue cayendo en su columna en vez de correrse todo.      */
    const ancho = Math.max(sh.getLastColumn(), LOG_COLS.length);
    const head  = sh.getRange(1, 1, 1, ancho).getValues()[0]
                    .map(function(h){ return String(h).trim(); });
    const dato = {
      'Timestamp': new Date(), 'Proceso': tipo, 'Filas': count,
      'Segundos': elapsed, 'Nota': nota || '',
    };
    const fila = [];
    for (let i = 0; i < ancho; i++) {
      fila.push(dato[head[i]] !== undefined ? dato[head[i]] : '');
    }
    // Si el encabezado no trae nada reconocible, se escribe en el orden
    // historico antes que perder el registro.
    const reconocidas = head.filter(function(h){ return dato[h] !== undefined; }).length;
    sh.appendRow(reconocidas ? fila
                             : [new Date(), tipo, count, elapsed, nota || '']);
    podarLog_(sh);
  } catch (e) {}
}

/**
 * Tira las filas de bitácora más viejas que LOG_DIAS.
 *
 * Solo hace trabajo cuando la hoja pasa de LOG_MAX_FILAS. El resto de
 * las veces cuesta un getLastRow() y se sale — `deleteRows` es caro y
 * no tiene caso pagarlo en cada corrida.
 *
 * La bitácora es el ÚNICO rastro forense que hay: si algo se rompió un
 * martes y lo notas el viernes, esto es lo que se revisa. Por eso poda
 * por FECHA y no por cantidad, y nunca deja menos de ~1 día.
 */
function podarLog_(sh) {
  const last = sh.getLastRow();
  if (last <= WM_CONFIG.LOG_MAX_FILAS) return;

  const n = last - 1;                       // sin el encabezado
  const corte = Date.now() - WM_CONFIG.LOG_DIAS * 86400000;

  // La columna de la fecha se busca por encabezado, no se asume la A.
  const head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), LOG_COLS.length))
                 .getValues()[0].map(function(h){ return String(h).trim(); });
  const cTs = head.indexOf('Timestamp') + 1 || 1;
  const fechas = sh.getRange(2, cTs, n, 1).getValues();

  // La bitácora se escribe con appendRow, así que está en orden.
  // Se cuenta la racha inicial de filas viejas y se corta ahí.
  let aBorrar = 0;
  for (let i = 0; i < n; i++) {
    const t = (fechas[i][0] instanceof Date) ? fechas[i][0].getTime() : 0;
    if (t && t >= corte) break;
    aBorrar++;
  }

  // Red de seguridad: si las fechas vinieran raras (alguien ordenó la
  // hoja a mano, o quedaron celdas de texto), esto evita vaciarla.
  const MINIMO = 200;
  if (n - aBorrar < MINIMO) aBorrar = Math.max(0, n - MINIMO);
  if (aBorrar <= 0) return;

  sh.deleteRows(2, aBorrar);
  Logger.log('  🧹 Bitácora podada: ' + aBorrar + ' filas de más de ' +
             WM_CONFIG.LOG_DIAS + ' días. Quedan ' + (n - aBorrar) + '.');
}

/* ============================================================
   Diagnóstico
   ============================================================ */
function testSheetAccess() {
  try {
    const ss = getSpreadsheet_();
    Logger.log('✅ Sheet OK: "' + ss.getName() + '"');
    Logger.log('   Pestañas: ' + ss.getSheets().map(function(s){ return s.getName(); }).join(', '));
    return true;
  } catch (e) {
    Logger.log('❌ ' + e.message);
    return false;
  }
}

/**
 * Estado del barrido, leido de la hoja maestra (1.3).
 *
 * Una sola funcion para los cinco lugares que lo reportan (menu, web app,
 * diagnostico, verProgreso): antes cada uno lo recalculaba a su manera
 * sobre Inv_Normal y podian no coincidir.
 *
 * `total` es la COLA real: filas con SKU que NO estan BLOQUEADAS.
 */
function progresoBarrido_() {
  const out = { total: 0, conDato: 0, faltan: 0, pct: 0,
                masViejo: null, masReciente: null, sinDato: [] };
  try {
    const sh = getSpreadsheet_().getSheetByName(WM_CONFIG.SHEET_MASTER);
    if (!sh) return out;
    const last = sh.getLastRow();
    if (last < 2) return out;

    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                   .map(function(h){ return String(h).trim(); });
    const cSku  = head.indexOf('sku') + 1;
    const cMi   = head.indexOf('miEstado') + 1;
    const cProp = head.indexOf('invNormal') + 1;
    const cRev  = head.indexOf('invRevisado') + 1;
    if (cSku < 1 || cMi < 1 || cProp < 1 || cRev < 1) return out;

    const n    = last - 1;
    const skus = sh.getRange(2, cSku,  n, 1).getValues();
    const mi   = sh.getRange(2, cMi,   n, 1).getValues();
    const prop = sh.getRange(2, cProp, n, 1).getValues();
    const rev  = sh.getRange(2, cRev,  n, 1).getValues();

    for (let i = 0; i < n; i++) {
      const sku = String(skus[i][0] || '').trim();
      if (!sku) continue;
      if (String(mi[i][0] || '').trim().toUpperCase() === 'BLOQUEADO') continue;
      out.total++;
      if (prop[i][0] !== '' && prop[i][0] !== null) {
        out.conDato++;
        const d = rev[i][0];
        if (d instanceof Date) {
          if (!out.masViejo    || d < out.masViejo)    out.masViejo    = d;
          if (!out.masReciente || d > out.masReciente) out.masReciente = d;
        }
      } else if (out.sinDato.length < 500) {
        out.sinDato.push(sku);
      }
    }
    out.faltan = Math.max(0, out.total - out.conDato);
    out.pct    = out.total ? Math.round(out.conDato / out.total * 100) : 0;
  } catch (e) {
    Logger.log('  ⚠ progresoBarrido_: ' + e.message);
  }
  return out;
}

/** Muestra en qué va el barrido de inventario propio */
function verProgreso() {
  try {
    const pr = progresoBarrido_();
    const total = pr.total, conDato = pr.conDato, masViejo = pr.masViejo;
    const pct = pr.pct;
    const faltan = pr.faltan;
    const corridas = Math.ceil(faltan / WM_CONFIG.MAX_SKUS_POR_CHUNK);

    Logger.log('── PROGRESO DEL BARRIDO ──');
    Logger.log('  Total de SKUs:       ' + total);
    Logger.log('  Con dato:            ' + conDato + '  (' + pct + '%)');
    Logger.log('  Pendientes:          ' + faltan);
    if (faltan > 0) {
      Logger.log('  Faltan ~' + corridas + ' corridas ≈ ' +
                 (corridas * WM_CONFIG.CHUNK_INTERVAL_MIN / 60).toFixed(1) + ' horas');
    } else {
      Logger.log('  ✅ Cobertura completa. Ahora solo refresca los más viejos.');
    }
    if (masViejo) Logger.log('  Dato más viejo:      ' + masViejo.toLocaleString('es-MX'));
    Logger.log('  Endpoint WFS:        ' +
      (PropertiesService.getScriptProperties().getProperty(WM_CONFIG.PROP_WFS_ENDPOINT) || 'sin detectar'));
  } catch (e) {
    Logger.log('❌ ' + e.message);
  }
}
