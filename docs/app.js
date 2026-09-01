/**
 * WM_Inv — Walmart Dashboard · Frontend
 * Se conecta al backend en Apps Script vía fetch cross-origin.
 */

/* ============================================================
   State
   ============================================================ */
const STATE = {
  token: null,
  rows: [],
  cols: [],
  visibleCols: new Set(),
  filters: {},
  sort: { key: null, dir: 1 },
  autoTimer: null,
  progressTimer: null,
};

const STORAGE_TOKEN = 'wm_dash_token';
const STORAGE_TOKEN_TS = 'wm_dash_token_ts';
const STORAGE_COLS = 'wm_dash_cols';

/* Columnas numéricas (alineadas a la derecha y ordenadas como número) */
const NUM_COLS = new Set([
  'price', 'wfsDisponible', 'wfsEnMano', 'wfsReservado', 'wfsInbound',
  'wfsEdad0_90', 'wfsEdad91_180', 'wfsEdad181_270', 'wfsEdad271_365', 'wfsEdad365plus',
  'wfsProyS1_4', 'wfsProyS5_8', 'wfsProyS9_12',
  'wfsSellThrough', 'wfsDiasSupply', 'wfsSugeridas', 'wfsExcedente',
  'invNormal',
]);

/* Etiquetas legibles */
const COL_LABELS = {
  sku: 'SKU',
  productName: 'Producto',
  productType: 'Tipo',
  shelf: 'Categoría',
  wpid: 'WPID',
  upc: 'UPC',
  gtin: 'GTIN',
  mart: 'Mart',
  price: 'Precio',
  currency: 'Moneda',
  publishedStatus: 'Publicación',
  lifecycleStatus: 'Ciclo de vida',
  unpublishedReasons: 'Razón despublicado',
  esWFS: '¿WFS?',
  offerId: 'Offer ID',
  wfsDisponible: 'WFS Disponible',
  wfsEnMano: 'WFS En mano',
  wfsReservado: 'WFS Reservado',
  wfsInbound: 'WFS Inbound',
  wfsEstado: 'WFS Estado',
  wfsTipoNodo: 'WFS Tipo nodo',
  wfsActualizado: 'WFS Actualizado',
  wfsPrimerStock: 'WFS Primer stock',
  wfsEdad0_90: 'Edad 0-90d',
  wfsEdad91_180: 'Edad 91-180d',
  wfsEdad181_270: 'Edad 181-270d',
  wfsEdad271_365: 'Edad 271-365d',
  wfsEdad365plus: 'Edad 365+d',
  wfsProyS1_4: 'Proy. S1-4',
  wfsProyS5_8: 'Proy. S5-8',
  wfsProyS9_12: 'Proy. S9-12',
  wfsSellThrough: 'Sell-through',
  wfsDiasSupply: 'Días supply',
  wfsFechaOOS: 'Fecha agotamiento',
  wfsSugeridas: 'Sugeridas',
  wfsExcedente: 'Excedente',
  invNormal: 'Inv. Normal',
  invUnidad: 'Unidad',
  invRevisado: 'Inv. revisado',
};

/* Columnas visibles por default (las más útiles) */
const DEFAULT_COLS = [
  'sku', 'productName', 'productType', 'price', 'publishedStatus',
  'esWFS', 'wfsDisponible', 'wfsEnMano', 'wfsEstado', 'invNormal',
];

/* Columnas vacías mientras Walmart no habilite el endpoint WFS nuevo */
const LOCKED_COLS = new Set([
  'wfsInbound', 'wfsEdad0_90', 'wfsEdad91_180', 'wfsEdad181_270',
  'wfsEdad271_365', 'wfsEdad365plus', 'wfsProyS1_4', 'wfsProyS5_8',
  'wfsProyS9_12', 'wfsSellThrough', 'wfsDiasSupply', 'wfsFechaOOS',
  'wfsSugeridas', 'wfsExcedente',
]);

/* ============================================================
   Init
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Ojo: no usar `window.APPS_SCRIPT_URL` como única vía — si config.js
  // declara la variable con const/let, existe en el scope global pero NO
  // como propiedad de window.
  var urlOk = (typeof APPS_SCRIPT_URL !== 'undefined')
              && APPS_SCRIPT_URL
              && APPS_SCRIPT_URL.indexOf('PON_AQUI') < 0;
  if (!urlOk) {
    showLoginError('Falta configurar APPS_SCRIPT_URL en config.js');
    return;
  }

  document.getElementById('loginForm').addEventListener('submit', onLogin);
  document.getElementById('btnLogout').onclick = onLogout;
  document.getElementById('btnRefresh').onclick = () => load(true);
  document.getElementById('btnCols').onclick = () => {
    const p = document.getElementById('colsPanel');
    p.hidden = !p.hidden;
  };
  document.getElementById('btnExportXlsx').onclick = exportXlsx;
  document.getElementById('btnExportCsv').onclick = exportCsv;
  document.getElementById('btnExportPdf').onclick = exportPdf;
  document.getElementById('btnClearFilters').onclick = clearFilters;
  document.getElementById('globalSearch').addEventListener('input', render);
  document.getElementById('autoInterval').addEventListener('change', e => setAutoRefresh(Number(e.target.value)));

  const savedToken = localStorage.getItem(STORAGE_TOKEN);
  const savedTs = Number(localStorage.getItem(STORAGE_TOKEN_TS) || 0);
  if (savedToken && (Date.now() - savedTs) < 12 * 3600 * 1000) {
    STATE.token = savedToken;
    enterDashboard();
  }
});

/* ============================================================
   Login
   ============================================================ */
async function onLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const pw = document.getElementById('loginPassword').value;
  btn.disabled = true;
  btn.textContent = 'Verificando…';
  clearLoginMsg();

  try {
    const res = await apiCall({ action: 'login', password: pw });
    if (!res.ok) throw new Error(res.error || 'Login falló');
    STATE.token = res.token;
    if (document.getElementById('rememberMe').checked) {
      localStorage.setItem(STORAGE_TOKEN, res.token);
      localStorage.setItem(STORAGE_TOKEN_TS, String(Date.now()));
    }
    enterDashboard();
  } catch (err) {
    showLoginError(err.message || 'Error de login');
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

function showLoginError(msg) {
  const el = document.getElementById('loginMsg');
  el.className = 'msg error';
  el.textContent = msg;
}
function clearLoginMsg() {
  const el = document.getElementById('loginMsg');
  el.className = 'msg';
  el.textContent = '';
}

function enterDashboard() {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('dashboard').hidden = false;
  setAutoRefresh(0);           // el servidor ya refresca cada 10 min
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
async function apiCall(params) {
  const body = new URLSearchParams();
  Object.keys(params).forEach(k => body.append(k, params[k]));
  const resp = await fetch(APPS_SCRIPT_URL, { method: 'POST', body, redirect: 'follow' });
  const text = await resp.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error('Respuesta inválida del backend: ' + text.substring(0, 200)); }
}

/* ============================================================
   Carga de datos
   ============================================================ */
async function load(force) {
  showLoading(force
    ? 'Refrescando catálogo + WFS desde Walmart… (~90 seg)'
    : 'Cargando inventario…');
  try {
    const res = await apiCall({ action: force ? 'refresh' : 'inventory', token: STATE.token });
    if (!res.ok) {
      if (res.error === 'unauthorized') return onLogout();
      throw new Error(res.error);
    }
    onLoaded(res);
  } catch (err) {
    onError(err);
  }
}

function onLoaded(res) {
  STATE.rows = res.rows || [];
  document.getElementById('marketLabel').textContent = (res.market || 'mx').toUpperCase();
  document.getElementById('lastSync').textContent = 'Sync: ' + formatTime(res.fetchedAt);
  updateProgressUI(res.progress);
  updateWfsBadge(res.wfsMode);
  buildColumns();
  render();
}

function onError(e) {
  const el = document.getElementById('emptyState');
  el.innerHTML = '<span style="color:var(--danger)">❌ ' + escapeHtml(e.message || String(e)) + '</span>';
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
   Progreso del barrido de inventario normal
   ============================================================ */
function startProgressPolling() {
  if (STATE.progressTimer) clearInterval(STATE.progressTimer);
  STATE.progressTimer = setInterval(async () => {
    try {
      const res = await apiCall({ action: 'progress', token: STATE.token });
      if (res.ok) updateProgressUI(res);
    } catch (_) {}
  }, 60000);   // cada minuto
}

function updateProgressUI(p) {
  const el = document.getElementById('scanProgress');
  if (!el || !p || !p.total) { if (el) el.hidden = true; return; }

  const pct = p.pct != null ? p.pct : Math.round((p.cursor / p.total) * 100);
  el.hidden = false;
  const done = pct >= 100 || p.cursor === 0;

  el.innerHTML = done
    ? `<span class="scan-label">✓ Inventario normal completo</span>
       <div class="scan-bar"><div class="scan-fill done" style="width:100%"></div></div>`
    : `<span class="scan-label">Barriendo inv. normal · ${p.cursor}/${p.total}</span>
       <div class="scan-bar"><div class="scan-fill" style="width:${pct}%"></div></div>
       <span class="scan-pct">${pct}%</span>`;
}

function updateWfsBadge(mode) {
  const el = document.getElementById('wfsBadge');
  if (!el) return;
  if (mode === 'new') {
    el.textContent = 'WFS completo';
    el.className = 'pill ok';
    el.title = 'Endpoint WFS avanzado activo: incluye forecast, aging y sell-through';
  } else {
    el.textContent = 'WFS básico';
    el.className = 'pill';
    el.title = 'Endpoint legacy: solo disponible y en-mano. Las columnas de forecast/aging requieren que Walmart habilite Program Eligibility en tu cuenta.';
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
    const initial = (saved && saved.length) ? saved : DEFAULT_COLS;
    initial.forEach(k => { if (keys.indexOf(k) >= 0) STATE.visibleCols.add(k); });
    if (STATE.visibleCols.size === 0) keys.forEach(k => STATE.visibleCols.add(k));
  }
  renderColsPanel();
}

function renderColsPanel() {
  const grid = document.getElementById('colsGrid');
  grid.innerHTML = STATE.cols.map(c => `
    <label ${c.locked ? 'class="locked" title="Requiere que Walmart habilite el endpoint WFS avanzado"' : ''}>
      <input type="checkbox" data-col="${c.key}" ${STATE.visibleCols.has(c.key) ? 'checked' : ''}>
      ${escapeHtml(c.label)}${c.locked ? ' <span class="lock">🔒</span>' : ''}
    </label>`).join('');
  grid.querySelectorAll('input').forEach(inp => {
    inp.onchange = () => {
      const k = inp.dataset.col;
      if (inp.checked) STATE.visibleCols.add(k); else STATE.visibleCols.delete(k);
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
  persistCols();
  renderColsPanel();
  render();
}

function resetCols() {
  STATE.visibleCols = new Set(DEFAULT_COLS.filter(k => STATE.cols.some(c => c.key === k)));
  persistCols();
  renderColsPanel();
  render();
}

/* ============================================================
   Filtros, orden, render
   ============================================================ */
function filteredRows() {
  const q = document.getElementById('globalSearch').value.toLowerCase().trim();
  const rows = STATE.rows.filter(r => {
    if (q) {
      let hit = false;
      for (const k in r) { if (String(r[k]).toLowerCase().includes(q)) { hit = true; break; } }
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
      const av = a[k], bv = b[k];
      if (isNum) {
        const an = av === '' ? -Infinity : Number(av);
        const bn = bv === '' ? -Infinity : Number(bv);
        return (an - bn) * dir;
      }
      return String(av).localeCompare(String(bv), 'es') * dir;
    });
  }
  return rows;
}

function render() {
  const cols = STATE.cols.filter(c => STATE.visibleCols.has(c.key));
  const rows = filteredRows();
  document.getElementById('rowCount').textContent = rows.length + ' / ' + STATE.rows.length + ' SKUs';

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
    return `<th class="sortable" data-col="${c.key}">${escapeHtml(c.label)} <span class="sort-ind">${arrow}</span></th>`;
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
    `<th><input type="text" placeholder="filtrar" data-col="${c.key}" value="${escapeHtml(STATE.filters[c.key] || '')}"></th>`
  ).join('');
  document.getElementById('theadFilters').querySelectorAll('input').forEach(inp => {
    inp.oninput = () => { STATE.filters[inp.dataset.col] = inp.value; render(); };
  });

  const MAX = 500;
  const slice = rows.slice(0, MAX);
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = slice.map(r => '<tr>' + cols.map(c => {
    const v = r[c.key];
    let cls = c.type === 'num' ? 'num' : '';
    if (c.key === 'wfsEstado') {
      cls += String(v).toLowerCase().includes('out') ? ' status-out' : (v ? ' status-ok' : '');
    }
    if (c.key === 'esWFS') cls += v === 'SÍ' ? ' status-ok' : ' muted';
    if (c.key === 'publishedStatus') {
      cls += String(v).toUpperCase() === 'PUBLISHED' ? ' status-ok' : ' status-out';
    }
    if (c.key === 'invNormal' && v === '') {
      return '<td class="num pending" title="Todavía no barrido">—</td>';
    }
    return `<td class="${cls}">${escapeHtml(v)}</td>`;
  }).join('') + '</tr>').join('');

  if (rows.length > MAX) {
    tbody.innerHTML += `<tr><td colspan="${cols.length}" class="more-note">
      Mostrando ${MAX} de ${rows.length}. Afina los filtros o exporta para verlas todas.</td></tr>`;
  }
}

function clearFilters() {
  STATE.filters = {};
  document.getElementById('globalSearch').value = '';
  render();
}

/* ============================================================
   Exports — respetan filtros y columnas visibles
   ============================================================ */
function getExportData() {
  return {
    cols: STATE.cols.filter(c => STATE.visibleCols.has(c.key)),
    rows: filteredRows(),
  };
}

function exportXlsx() {
  const { cols, rows } = getExportData();
  const aoa = [cols.map(c => c.label)].concat(rows.map(r => cols.map(c => r[c.key])));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  XLSX.writeFile(wb, `wm_inv_${stamp()}.xlsx`);
}

function exportCsv() {
  const { cols, rows } = getExportData();
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [cols.map(c => esc(c.label)).join(',')]
    .concat(rows.map(r => cols.map(c => esc(r[c.key])).join(',')))
    .join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `wm_inv_${stamp()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function exportPdf() {
  const { cols, rows } = getExportData();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: cols.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Inventario Walmart · Electronics MX', 40, 30);
  doc.setFontSize(9);
  doc.text('Generado: ' + new Date().toLocaleString('es-MX') + ' · ' + rows.length + ' SKUs', 40, 46);
  doc.autoTable({
    startY: 60,
    head: [cols.map(c => c.label)],
    body: rows.map(r => cols.map(c => r[c.key])),
    styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [0, 113, 220], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { top: 60, bottom: 30, left: 20, right: 20 },
  });
  doc.save(`wm_inv_${stamp()}.pdf`);
}

/* ============================================================
   Utils
   ============================================================ */
function setAutoRefresh(seconds) {
  if (STATE.autoTimer) clearInterval(STATE.autoTimer);
  if (seconds > 0) STATE.autoTimer = setInterval(() => load(false), seconds * 1000);
}

function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', { hour12: false });
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
