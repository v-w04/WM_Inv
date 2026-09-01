/**
 * Inventario Walmart — Electronics México
 * Frontend. Se conecta al backend en Apps Script vía fetch cross-origin.
 */

/* ============================================================
   Estado
   ============================================================ */
const STATE = {
  token: null,
  rows: [],
  cols: [],
  visibleCols: new Set(),
  filters: {},
  sort: { key: null, dir: 1 },
  progressTimer: null,
};

const STORAGE_TOKEN    = 'wm_dash_token';
const STORAGE_TOKEN_TS = 'wm_dash_token_ts';
const STORAGE_COLS     = 'wm_dash_cols';

const NUM_COLS = new Set([
  'price', 'wfsDisponible', 'wfsEnMano', 'wfsReservado', 'wfsInbound',
  'wfsEdad0_90', 'wfsEdad91_180', 'wfsEdad181_270', 'wfsEdad271_365', 'wfsEdad365plus',
  'wfsProyS1_4', 'wfsProyS5_8', 'wfsProyS9_12',
  'wfsSellThrough', 'wfsDiasSupply', 'wfsSugeridas', 'wfsExcedente',
  'invNormal',
]);

const COL_LABELS = {
  sku: 'SKU', productName: 'Producto', productType: 'Tipo', shelf: 'Categoría',
  wpid: 'WPID', upc: 'UPC', gtin: 'GTIN', mart: 'Mart',
  price: 'Precio', currency: 'Moneda',
  publishedStatus: 'Publicación', lifecycleStatus: 'Ciclo de vida',
  unpublishedReasons: 'Razón despublicado',
  esWFS: '¿WFS?', offerId: 'Offer ID',
  wfsDisponible: 'WFS Disponible', wfsEnMano: 'WFS En mano',
  wfsReservado: 'WFS Reservado', wfsInbound: 'WFS Inbound',
  wfsEstado: 'WFS Estado', wfsTipoNodo: 'WFS Tipo nodo',
  wfsActualizado: 'WFS Actualizado', wfsPrimerStock: 'WFS Primer stock',
  wfsEdad0_90: 'Edad 0-90d', wfsEdad91_180: 'Edad 91-180d',
  wfsEdad181_270: 'Edad 181-270d', wfsEdad271_365: 'Edad 271-365d',
  wfsEdad365plus: 'Edad 365+d',
  wfsProyS1_4: 'Proy. S1-4', wfsProyS5_8: 'Proy. S5-8', wfsProyS9_12: 'Proy. S9-12',
  wfsSellThrough: 'Sell-through', wfsDiasSupply: 'Días supply',
  wfsFechaOOS: 'Fecha agotamiento', wfsSugeridas: 'Sugeridas', wfsExcedente: 'Excedente',
  invNormal: 'Inv. Normal', invUnidad: 'Unidad', invRevisado: 'Inv. revisado',
};

const DEFAULT_COLS = [
  'sku', 'productName', 'productType', 'price', 'publishedStatus',
  'esWFS', 'wfsDisponible', 'wfsEnMano', 'wfsEstado', 'invNormal',
];

/* Columnas que solo se llenan con el endpoint WFS avanzado */
const LOCKED_COLS = new Set([
  'wfsInbound', 'wfsEdad0_90', 'wfsEdad91_180', 'wfsEdad181_270',
  'wfsEdad271_365', 'wfsEdad365plus', 'wfsProyS1_4', 'wfsProyS5_8',
  'wfsProyS9_12', 'wfsSellThrough', 'wfsDiasSupply', 'wfsFechaOOS',
  'wfsSugeridas', 'wfsExcedente',
]);

/* ============================================================
   Arranque
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const urlOk = (typeof APPS_SCRIPT_URL !== 'undefined')
                && APPS_SCRIPT_URL
                && APPS_SCRIPT_URL.indexOf('PON_AQUI') < 0;
  if (!urlOk) {
    showLoginMsg('Falta configurar APPS_SCRIPT_URL en config.js', 'danger');
    return;
  }

  document.getElementById('loginForm').addEventListener('submit', onLogin);
  document.getElementById('btnLogout').onclick       = onLogout;
  document.getElementById('btnRefresh').onclick      = () => load(true);
  document.getElementById('btnCols').onclick         = () => {
    const p = document.getElementById('colsPanel');
    p.hidden = !p.hidden;
  };
  document.getElementById('btnExportXlsx').onclick   = exportXlsx;
  document.getElementById('btnExportCsv').onclick    = exportCsv;
  document.getElementById('btnExportPdf').onclick    = exportPdf;
  document.getElementById('btnClearFilters').onclick = clearFilters;
  document.getElementById('globalSearch').addEventListener('input', render);

  const t  = localStorage.getItem(STORAGE_TOKEN);
  const ts = Number(localStorage.getItem(STORAGE_TOKEN_TS) || 0);
  if (t && (Date.now() - ts) < 12 * 3600 * 1000) {
    STATE.token = t;
    enterDashboard();
  }
});

/* ============================================================
   Sesión
   ============================================================ */
async function onLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Verificando…';
  hideLoginMsg();

  try {
    const res = await apiCall({ action: 'login', password: document.getElementById('loginPassword').value });
    if (!res.ok) throw new Error(res.error || 'No se pudo entrar');
    STATE.token = res.token;
    if (document.getElementById('rememberMe').checked) {
      localStorage.setItem(STORAGE_TOKEN, res.token);
      localStorage.setItem(STORAGE_TOKEN_TS, String(Date.now()));
    }
    enterDashboard();
  } catch (err) {
    showLoginMsg(err.message || 'Error de login', 'danger');
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

function showLoginMsg(msg, kind) {
  const el = document.getElementById('loginMsg');
  el.className = 'alert alert--' + (kind || 'danger');
  el.textContent = msg;
  el.hidden = false;
}
function hideLoginMsg() { document.getElementById('loginMsg').hidden = true; }

function enterDashboard() {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('dashboard').hidden   = false;
  startProgressPolling();
  load(false);
}

async function onLogout() {
  try { await apiCall({ action: 'logout', token: STATE.token }); } catch (_) {}
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_TOKEN_TS);
  location.reload();
}

/* ============================================================
   API — POST form-urlencoded (evita preflight CORS)
   ============================================================ */
async function apiCall(params, timeoutMs) {
  const body = new URLSearchParams();
  Object.keys(params).forEach(k => body.append(k, params[k]));

  // Sin límite, una URL muerta o un trigger ocupado dejan la UI colgada.
  // login/progress deben ser rápidos; inventory/refresh pueden tardar ~2 min.
  const limite = timeoutMs || 30000;
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), limite);

  let resp;
  try {
    resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST', body, redirect: 'follow', signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(reloj);
    if (e.name === 'AbortError') {
      throw new Error('El backend no respondió en ' + Math.round(limite / 1000) +
                      ' seg. Puede haber un proceso corriendo — espera un minuto y reintenta.');
    }
    throw new Error('No se pudo contactar el backend. Revisa que la URL en config.js ' +
                    'sea la de la implementación activa y que su acceso sea "Cualquier persona".');
  }
  clearTimeout(reloj);

  if (resp.status === 404) {
    throw new Error('La URL del backend ya no existe (404). Se creó una implementación ' +
                    'nueva y config.js apunta a la vieja.');
  }

  const text = await resp.text();
  try { return JSON.parse(text); }
  catch (e) {
    if (text.indexOf('<') === 0) {
      throw new Error('El backend devolvió una página en vez de datos. ' +
                      'Revisa que el acceso de la implementación sea "Cualquier persona".');
    }
    throw new Error('Respuesta inválida del backend: ' + text.substring(0, 160));
  }
}

/* ============================================================
   Carga
   ============================================================ */
async function load(force) {
  showLoading(force ? 'Refrescando catálogo y WFS desde Walmart… (~90 seg)' : 'Cargando inventario…');
  try {
    // El sync completo puede tardar ~2 min, por eso el límite es más largo
    const res = await apiCall({ action: force ? 'refresh' : 'inventory', token: STATE.token }, 180000);
    if (!res.ok) {
      if (res.error === 'unauthorized') return onLogout();
      throw new Error(res.error);
    }
    onLoaded(res);
  } catch (err) { onError(err); }
}

function onLoaded(res) {
  STATE.rows = res.rows || [];
  document.getElementById('lastSync').textContent = 'Sync ' + formatTime(res.fetchedAt);
  updateWfsBadge(res.wfsMode);
  updateProgress(res.progress);
  buildColumns();
  renderKpis();
  render();
}

function onError(e) {
  const el = document.getElementById('emptyState');
  el.innerHTML = '<span class="alert alert--danger">' + escapeHtml(e.message || String(e)) + '</span>';
  el.hidden = false;
  document.getElementById('tbl').hidden = true;
}

function showLoading(msg) {
  const el = document.getElementById('emptyState');
  el.innerHTML = '<span class="spinner"></span> ' + escapeHtml(msg);
  el.hidden = false;
  document.getElementById('tbl').hidden = true;
}

/* ============================================================
   KPIs
   Cada tarjeta lleva etiqueta escrita: el color refuerza, no informa solo.
   Al hacer clic, filtra la tabla.
   ============================================================ */
function renderKpis() {
  const r = STATE.rows;
  if (!r.length) return;

  const pub    = r.filter(x => String(x.publishedStatus).toUpperCase() === 'PUBLISHED').length;
  const unpub  = r.filter(x => String(x.publishedStatus).toUpperCase() === 'UNPUBLISHED').length;
  const sysErr = r.filter(x => String(x.publishedStatus).toUpperCase() === 'SYSTEM_PROBLEM').length;
  const wfs    = r.filter(x => x.esWFS === 'SÍ');
  const wfsCon = wfs.filter(x => Number(x.wfsEnMano || 0) > 0).length;

  // Dinero parado: en bodega WFS pero sin poder venderse
  let bloqueado = 0, bloqueadoN = 0;
  wfs.forEach(x => {
    if (String(x.publishedStatus).toUpperCase() !== 'PUBLISHED') {
      const u = Number(x.wfsEnMano || 0), p = Number(x.price || 0);
      if (u > 0) { bloqueado += u * p; bloqueadoN++; }
    }
  });

  const tiles = [
    { label: 'SKUs en catálogo', value: fmt(r.length), hint: 'total sincronizado' },
    { label: 'Publicados',       value: fmt(pub),   tone: 'ok',
      hint: pct(pub, r.length) + ' del catálogo', filter: ['publishedStatus', 'PUBLISHED'] },
    { label: 'Sin publicar',     value: fmt(unpub), tone: 'danger',
      hint: pct(unpub, r.length) + ' no se puede vender', filter: ['publishedStatus', 'UNPUBLISHED'] },
    { label: 'Problema Walmart', value: fmt(sysErr), tone: 'warn',
      hint: 'error del lado de ellos', filter: ['publishedStatus', 'SYSTEM_PROBLEM'] },
    { label: 'En WFS',           value: fmt(wfs.length),
      hint: wfsCon + ' con stock físico', filter: ['esWFS', 'SÍ'] },
  ];

  if (bloqueadoN > 0) {
    tiles.push({
      label: 'Inmovilizado en WFS',
      value: '$' + fmt(Math.round(bloqueado)),
      tone: 'danger',
      hint: bloqueadoN + ' SKUs en bodega sin poder venderse',
      action: 'Ver cuáles',
      onAction: () => {
        clearFilters();
        STATE.filters.esWFS = 'SÍ';
        STATE.filters.publishedStatus = 'UNPUB';
        ['esWFS','publishedStatus','wfsEnMano','price','productName','sku']
          .forEach(c => STATE.visibleCols.add(c));
        STATE.sort = { key: 'wfsEnMano', dir: -1 };
        renderColsPanel();
        render();
        document.getElementById('tableWrap').scrollIntoView({ behavior: 'smooth' });
      },
    });
  }

  const host = document.getElementById('kpis');
  host.innerHTML = '';
  tiles.forEach(t => {
    const el = document.createElement('div');
    el.className = 'stat';
    el.innerHTML =
      '<span class="stat__label">' + escapeHtml(t.label) + '</span>' +
      '<span class="stat__value' + (t.tone ? ' stat__value--' + t.tone : '') + '">' + t.value + '</span>' +
      '<span class="stat__hint">' + escapeHtml(t.hint || '') + '</span>' +
      (t.action || t.filter ? '<button class="stat__action">' + escapeHtml(t.action || 'Filtrar') + '</button>' : '');

    const btn = el.querySelector('.stat__action');
    if (btn) {
      btn.onclick = t.onAction || (() => {
        clearFilters();
        STATE.filters[t.filter[0]] = t.filter[1];
        render();
        document.getElementById('tableWrap').scrollIntoView({ behavior: 'smooth' });
      });
    }
    host.appendChild(el);
  });
}

function fmt(n) { return Number(n).toLocaleString('es-MX'); }
function pct(a, b) { return b ? Math.round(a / b * 100) + '%' : '0%'; }

/* ============================================================
   Progreso del barrido
   ============================================================ */
function startProgressPolling() {
  if (STATE.progressTimer) clearInterval(STATE.progressTimer);
  STATE.progressTimer = setInterval(async () => {
    try {
      const res = await apiCall({ action: 'progress', token: STATE.token });
      if (res.ok) updateProgress(res);
    } catch (_) {}
  }, 60000);
}

/**
 * Muestra COBERTURA (cuántos SKUs ya tienen dato), no la posición del recorrido.
 * La cobertura solo sube y se queda en 100%; el cursor vuelve a cero cada ciclo,
 * y mostrarlo confundía — parecía que el avance se perdía.
 */
function updateProgress(p) {
  const el = document.getElementById('scanProgress');
  if (!el) return;
  if (!p || !p.total) { el.hidden = true; return; }

  // Compatibilidad con la respuesta vieja del backend
  const cubiertos = p.cubiertos != null ? p.cubiertos : (p.cursor || 0);
  const pctCob    = p.pctCobertura != null ? p.pctCobertura
                    : Math.round(cubiertos / p.total * 100);
  const completo  = pctCob >= 100;

  // Solo mencionamos el refresco si de veras está a media pasada
  const enPase = p.pctPase != null && p.pctPase > 0 && p.pctPase < 100;
  const nota = (completo && enPase)
    ? ' · refrescando (' + p.pctPase + '% de la pasada)'
    : '';

  el.hidden = false;
  el.innerHTML = completo
    ? '<span class="scan__label">Inventario propio · los ' + fmt(p.total) +
      ' SKUs tienen dato' + nota + '</span>' +
      '<div class="progress"><div class="progress__fill progress__fill--done" style="width:100%"></div></div>' +
      '<span class="scan__pct" style="color:var(--ok-fg)">100%</span>'
    : '<span class="scan__label">Consultando inventario propio · ' + fmt(cubiertos) +
      ' de ' + fmt(p.total) + ' SKUs</span>' +
      '<div class="progress"><div class="progress__fill" style="width:' + pctCob + '%"></div></div>' +
      '<span class="scan__pct">' + pctCob + '%</span>';
}

function updateWfsBadge(mode) {
  const el = document.getElementById('wfsBadge');
  if (!el) return;
  if (mode === 'new') {
    el.textContent = 'WFS completo';
    el.className   = 'pill pill--ok';
    el.title       = 'Endpoint avanzado activo: incluye aging, proyección y sell-through';
  } else {
    el.textContent = 'WFS básico';
    el.className   = 'pill';
    el.title       = 'Endpoint legacy: solo disponible y en mano. Las columnas con 🔒 requieren que Walmart habilite Program Eligibility.';
  }
}

/* ============================================================
   Columnas
   ============================================================ */
function buildColumns() {
  if (!STATE.rows.length) { STATE.cols = []; return; }
  const keys = Object.keys(STATE.rows[0]);
  STATE.cols = keys.map(k => ({
    key: k,
    label: COL_LABELS[k] || k,
    type: NUM_COLS.has(k) ? 'num' : 'text',
    locked: LOCKED_COLS.has(k),
  }));

  if (STATE.visibleCols.size === 0) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_COLS) || 'null'); } catch (_) {}
    (saved && saved.length ? saved : DEFAULT_COLS)
      .forEach(k => { if (keys.indexOf(k) >= 0) STATE.visibleCols.add(k); });
    if (!STATE.visibleCols.size) keys.forEach(k => STATE.visibleCols.add(k));
  }
  renderColsPanel();
}

function renderColsPanel() {
  const grid = document.getElementById('colsGrid');
  grid.innerHTML = STATE.cols.map(c =>
    '<label' + (c.locked ? ' class="locked" title="Requiere el endpoint WFS avanzado"' : '') + '>' +
    '<input type="checkbox" data-col="' + c.key + '"' + (STATE.visibleCols.has(c.key) ? ' checked' : '') + '>' +
    escapeHtml(c.label) + (c.locked ? ' 🔒' : '') + '</label>'
  ).join('');
  grid.querySelectorAll('input').forEach(inp => {
    inp.onchange = () => {
      inp.checked ? STATE.visibleCols.add(inp.dataset.col) : STATE.visibleCols.delete(inp.dataset.col);
      persistCols();
      render();
    };
  });
}

function persistCols() {
  try { localStorage.setItem(STORAGE_COLS, JSON.stringify([...STATE.visibleCols])); } catch (_) {}
}
function toggleAllCols(v) {
  STATE.cols.forEach(c => v ? STATE.visibleCols.add(c.key) : STATE.visibleCols.delete(c.key));
  persistCols(); renderColsPanel(); render();
}
function resetCols() {
  STATE.visibleCols = new Set(DEFAULT_COLS.filter(k => STATE.cols.some(c => c.key === k)));
  persistCols(); renderColsPanel(); render();
}

/* ============================================================
   Filtros, orden y render
   ============================================================ */
function filteredRows() {
  const q = document.getElementById('globalSearch').value.toLowerCase().trim();
  const rows = STATE.rows.filter(r => {
    if (q) {
      let hit = false;
      for (const k in r) if (String(r[k]).toLowerCase().includes(q)) { hit = true; break; }
      if (!hit) return false;
    }
    for (const k in STATE.filters) {
      const f = STATE.filters[k];
      if (!f) continue;
      if (!String(r[k] ?? '').toLowerCase().includes(f.toLowerCase())) return false;
    }
    return true;
  });

  if (STATE.sort.key) {
    const k = STATE.sort.key, dir = STATE.sort.dir, isNum = NUM_COLS.has(k);
    rows.sort((a, b) => {
      if (isNum) {
        const an = a[k] === '' ? -Infinity : Number(a[k]);
        const bn = b[k] === '' ? -Infinity : Number(b[k]);
        return (an - bn) * dir;
      }
      return String(a[k]).localeCompare(String(b[k]), 'es') * dir;
    });
  }
  return rows;
}

function render() {
  const cols = STATE.cols.filter(c => STATE.visibleCols.has(c.key));
  const rows = filteredRows();
  document.getElementById('rowCount').textContent = fmt(rows.length) + ' de ' + fmt(STATE.rows.length) + ' SKUs';

  if (!STATE.rows.length) {
    const el = document.getElementById('emptyState');
    el.textContent = 'Sin datos. Presiona ↻ Refrescar.';
    el.hidden = false;
    document.getElementById('tbl').hidden = true;
    return;
  }
  document.getElementById('emptyState').hidden = true;
  document.getElementById('tbl').hidden = false;

  document.getElementById('theadCols').innerHTML = cols.map(c => {
    const arrow = STATE.sort.key === c.key ? (STATE.sort.dir === 1 ? '▲' : '▼') : '';
    return '<th class="sortable" data-col="' + c.key + '">' + escapeHtml(c.label) +
           ' <span class="sort-ind">' + arrow + '</span></th>';
  }).join('');
  document.getElementById('theadCols').querySelectorAll('th').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.col;
      if (STATE.sort.key === k) STATE.sort.dir *= -1;
      else { STATE.sort.key = k; STATE.sort.dir = 1; }
      render();
    };
  });

  document.getElementById('theadFilters').innerHTML = cols.map(c =>
    '<th><input type="text" class="field field--sm" placeholder="filtrar" data-col="' + c.key +
    '" value="' + escapeHtml(STATE.filters[c.key] || '') + '"></th>'
  ).join('');
  document.getElementById('theadFilters').querySelectorAll('input').forEach(inp => {
    inp.oninput = () => { STATE.filters[inp.dataset.col] = inp.value; render(); };
  });

  const MAX = 500;
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = rows.slice(0, MAX).map(r =>
    '<tr>' + cols.map(c => {
      const v = r[c.key];
      let cls = c.type === 'num' ? 'num' : '';

      if (c.key === 'sku') cls += ' mono';
      if (c.key === 'publishedStatus') {
        const s = String(v).toUpperCase();
        cls += s === 'PUBLISHED' ? ' state-ok' : (s === 'SYSTEM_PROBLEM' ? ' state-warn' : ' state-danger');
      }
      if (c.key === 'esWFS') cls += v === 'SÍ' ? ' state-ok' : ' muted';
      if (c.key === 'wfsEstado' && v) {
        cls += String(v).toLowerCase().includes('out') ? ' state-danger' : ' state-ok';
      }
      if (c.key === 'invNormal' && v === '') {
        return '<td class="pending" title="Aún no barrido">—</td>';
      }
      return '<td class="' + cls + '">' + escapeHtml(v) + '</td>';
    }).join('') + '</tr>'
  ).join('');

  if (rows.length > MAX) {
    tbody.innerHTML += '<tr><td class="more-note" colspan="' + cols.length + '">Mostrando ' +
      MAX + ' de ' + fmt(rows.length) + '. Afina los filtros o exporta para verlas todas.</td></tr>';
  }
}

function clearFilters() {
  STATE.filters = {};
  document.getElementById('globalSearch').value = '';
  document.querySelectorAll('#theadFilters input').forEach(i => i.value = '');
  render();
}

/* ============================================================
   Exportar — respeta filtros y columnas visibles
   ============================================================ */
function exportData() {
  return { cols: STATE.cols.filter(c => STATE.visibleCols.has(c.key)), rows: filteredRows() };
}

function exportXlsx() {
  const { cols, rows } = exportData();
  const aoa = [cols.map(c => c.label)].concat(rows.map(r => cols.map(c => r[c.key])));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Inventario');
  XLSX.writeFile(wb, 'inventario_walmart_' + stamp() + '.xlsx');
}

function exportCsv() {
  const { cols, rows } = exportData();
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [cols.map(c => esc(c.label)).join(',')]
    .concat(rows.map(r => cols.map(c => esc(r[c.key])).join(','))).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'inventario_walmart_' + stamp() + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function exportPdf() {
  const { cols, rows } = exportData();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: cols.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Inventario Walmart · Electronics México', 40, 30);
  doc.setFontSize(9);
  doc.text('Generado ' + new Date().toLocaleString('es-MX') + ' · ' + fmt(rows.length) + ' SKUs', 40, 46);
  doc.autoTable({
    startY: 60,
    head: [cols.map(c => c.label)],
    body: rows.map(r => cols.map(c => r[c.key])),
    styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [31, 111, 235], textColor: 255 },
    alternateRowStyles: { fillColor: [246, 248, 250] },
    margin: { top: 60, bottom: 30, left: 20, right: 20 },
  });
  doc.save('inventario_walmart_' + stamp() + '.pdf');
}

/* ============================================================
   Utilidades
   ============================================================ */
function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
}
function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', { hour12: true, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
