/**
 * Walmart WFS Dashboard — Frontend
 * Se conecta al backend en Apps Script via fetch cross-origin.
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
};

const STORAGE_KEY_TOKEN = 'wm_dash_token';
const STORAGE_KEY_TOKEN_TS = 'wm_dash_token_ts';

const NUM_COLS = new Set([
  'availableUnits','reservedUnits','inboundUnits','onhandUnits',
  'inventoryReviewUnits','inventoryMovementUnits',
  'age_0_90','age_91_180','age_181_270','age_271_365','age_over_365',
  'forecast_w1_4','forecast_w5_8','forecast_w9_12',
  'sellThroughRate','daysOfSupply','suggestedUnits','surplusUnits','price'
]);

const COL_LABELS = {
  sku:'SKU', itemName:'Producto', brand:'Marca', gtin:'GTIN', upc:'UPC',
  wpid:'WPID (Walmart ID)', offerID:'Offer ID', itemCondition:'Condición',
  productType:'Tipo', shelf:'Shelf', mart:'Mart',
  publishingStatus:'Publish Status', itemLifecycle:'Lifecycle', stockStatus:'Stock',
  availableUnits:'Disponible', reservedUnits:'Reservado', inboundUnits:'Inbound', onhandUnits:'On-hand',
  inventoryReviewUnits:'En Revisión', inventoryMovementUnits:'En Movimiento',
  age_0_90:'Edad 0-90d', age_91_180:'Edad 91-180d', age_181_270:'Edad 181-270d',
  age_271_365:'Edad 271-365d', age_over_365:'Edad 365+d',
  firstInStockDate:'Primer stock',
  forecast_w1_4:'Forecast S1-4', forecast_w5_8:'Forecast S5-8', forecast_w9_12:'Forecast S9-12',
  sellThroughRate:'Sell-through', daysOfSupply:'Días supply',
  outOfStockDate:'Fecha OOS', suggestedUnits:'Sugeridas', surplusUnits:'Excedente',
  price:'Precio', currency:'Moneda',
  unpublishedReasons:'Razón unpub', lastSync:'Sync'
};

/* ============================================================
   Init: si hay token guardado, salta directo al dashboard
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  // Config check
  if (!window.APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PON_AQUI') >= 0) {
    document.getElementById('loginMsg').className = 'msg error';
    document.getElementById('loginMsg').textContent = 'Falta configurar APPS_SCRIPT_URL en config.js';
    return;
  }

  // Login form
  document.getElementById('loginForm').addEventListener('submit', onLogin);

  // Dashboard controls
  document.getElementById('btnLogout').onclick = onLogout;
  document.getElementById('btnRefresh').onclick = () => load(true);
  document.getElementById('btnCols').onclick = () => document.getElementById('colsPanel').hidden = !document.getElementById('colsPanel').hidden;
  document.getElementById('btnExportXlsx').onclick = exportXlsx;
  document.getElementById('btnExportCsv').onclick = exportCsv;
  document.getElementById('btnExportPdf').onclick = exportPdf;
  document.getElementById('btnClearFilters').onclick = clearFilters;
  document.getElementById('globalSearch').addEventListener('input', render);
  document.getElementById('autoInterval').addEventListener('change', (e) => setAutoRefresh(Number(e.target.value)));

  // ¿Hay token válido guardado?
  const savedToken = localStorage.getItem(STORAGE_KEY_TOKEN);
  const savedTs = Number(localStorage.getItem(STORAGE_KEY_TOKEN_TS) || 0);
  const twelveHoursMs = 12 * 60 * 60 * 1000;
  if (savedToken && (Date.now() - savedTs) < twelveHoursMs) {
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
  const msg = document.getElementById('loginMsg');
  const pw = document.getElementById('loginPassword').value;
  btn.disabled = true;
  btn.textContent = 'Verificando…';
  msg.className = 'msg';
  msg.textContent = '';

  try {
    const res = await apiCall({ action: 'login', password: pw });
    if (!res.ok) throw new Error(res.error || 'Login failed');
    STATE.token = res.token;
    if (document.getElementById('rememberMe').checked) {
      localStorage.setItem(STORAGE_KEY_TOKEN, res.token);
      localStorage.setItem(STORAGE_KEY_TOKEN_TS, String(Date.now()));
    }
    enterDashboard();
  } catch (err) {
    msg.className = 'msg error';
    msg.textContent = err.message || 'Error de login';
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

function enterDashboard() {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('dashboard').hidden = false;
  setAutoRefresh(600);
  load(false);
}

async function onLogout() {
  try { await apiCall({ action: 'logout', token: STATE.token }); } catch (_) {}
  localStorage.removeItem(STORAGE_KEY_TOKEN);
  localStorage.removeItem(STORAGE_KEY_TOKEN_TS);
  location.reload();
}

/* ============================================================
   API call — POST form-urlencoded (evita preflight CORS)
   ============================================================ */
async function apiCall(params) {
  const body = new URLSearchParams();
  Object.keys(params).forEach(k => body.append(k, params[k]));
  const resp = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    body: body,   // sin headers custom = "simple request" en CORS
    redirect: 'follow',
  });
  const text = await resp.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error('Respuesta inválida del backend: ' + text.substring(0, 200)); }
}

/* ============================================================
   Data loading
   ============================================================ */
async function load(force) {
  showLoading(force ? 'Refrescando desde Walmart API…' : 'Cargando inventario…');
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
  document.getElementById('marketLabel').textContent = (res.market || 'mx').toUpperCase() + (res.sandbox ? ' · SANDBOX' : '');
  document.getElementById('lastSync').textContent = 'Sync: ' + formatTime(res.fetchedAt);
  buildColumns();
  render();
}

function onError(e) {
  document.getElementById('emptyState').innerHTML = '<span style="color:var(--danger)">❌ ' + escapeHtml(e.message || String(e)) + '</span>';
  document.getElementById('emptyState').hidden = false;
  document.getElementById('tbl').hidden = true;
}

function showLoading(msg) {
  const el = document.getElementById('emptyState');
  el.innerHTML = '<span class="spinner"></span> ' + msg;
  el.hidden = false;
  document.getElementById('tbl').hidden = true;
}

/* ============================================================
   Columns setup
   ============================================================ */
function buildColumns() {
  if (!STATE.rows.length) { STATE.cols = []; return; }
  const keys = Object.keys(STATE.rows[0]);
  STATE.cols = keys.map(k => ({
    key: k, label: COL_LABELS[k] || k,
    type: NUM_COLS.has(k) ? 'num' : 'text',
  }));
  if (STATE.visibleCols.size === 0) STATE.cols.forEach(c => STATE.visibleCols.add(c.key));
  renderColsPanel();
}

function renderColsPanel() {
  const grid = document.getElementById('colsGrid');
  grid.innerHTML = STATE.cols.map(c => `
    <label>
      <input type="checkbox" data-col="${c.key}" ${STATE.visibleCols.has(c.key) ? 'checked' : ''}>
      ${escapeHtml(c.label)}
    </label>`).join('');
  grid.querySelectorAll('input').forEach(inp => {
    inp.onchange = () => {
      const k = inp.dataset.col;
      if (inp.checked) STATE.visibleCols.add(k); else STATE.visibleCols.delete(k);
      render();
    };
  });
}

function toggleAllCols(v) {
  STATE.cols.forEach(c => v ? STATE.visibleCols.add(c.key) : STATE.visibleCols.delete(c.key));
  renderColsPanel();
  render();
}

/* ============================================================
   Filtering + sorting + render
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
      const v = String(r[k] ?? '').toLowerCase();
      if (!v.includes(f.toLowerCase())) return false;
    }
    return true;
  });
  if (STATE.sort.key) {
    const k = STATE.sort.key, dir = STATE.sort.dir;
    const isNum = NUM_COLS.has(k);
    rows.sort((a, b) => {
      const av = a[k], bv = b[k];
      if (isNum) return (Number(av) - Number(bv)) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }
  return rows;
}

function render() {
  const cols = STATE.cols.filter(c => STATE.visibleCols.has(c.key));
  const rows = filteredRows();
  document.getElementById('rowCount').textContent = rows.length + ' / ' + STATE.rows.length + ' SKUs';

  if (!STATE.rows.length) {
    document.getElementById('emptyState').textContent = 'Sin datos. Presiona ↻ Refrescar.';
    document.getElementById('emptyState').hidden = false;
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

  document.getElementById('theadFilters').innerHTML = cols.map(c => `
    <th><input type="text" placeholder="filtrar" data-col="${c.key}" value="${escapeHtml(STATE.filters[c.key] || '')}"></th>
  `).join('');
  document.getElementById('theadFilters').querySelectorAll('input').forEach(inp => {
    inp.oninput = () => {
      STATE.filters[inp.dataset.col] = inp.value;
      render();
    };
  });

  const MAX = 500;
  const slice = rows.slice(0, MAX);
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = slice.map(r => {
    return '<tr>' + cols.map(c => {
      const v = r[c.key];
      let cls = c.type === 'num' ? 'num' : '';
      if (c.key === 'stockStatus') cls += String(v).toLowerCase().includes('out') ? ' status-out' : ' status-ok';
      return `<td class="${cls}">${escapeHtml(v)}</td>`;
    }).join('') + '</tr>';
  }).join('');
  if (rows.length > MAX) {
    tbody.innerHTML += `<tr><td colspan="${cols.length}" style="text-align:center;padding:12px;color:var(--muted)">Mostrando ${MAX} de ${rows.length}. Afina los filtros para verlas todas, o exporta.</td></tr>`;
  }
}

function clearFilters() {
  STATE.filters = {};
  document.getElementById('globalSearch').value = '';
  render();
}

/* ============================================================
   Exports (respetan filtros + columnas visibles)
   ============================================================ */
function getExportRows() {
  const cols = STATE.cols.filter(c => STATE.visibleCols.has(c.key));
  const rows = filteredRows();
  return { cols, rows };
}

function exportXlsx() {
  const { cols, rows } = getExportRows();
  const aoa = [cols.map(c => c.label)].concat(rows.map(r => cols.map(c => r[c.key])));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Walmart_WFS');
  XLSX.writeFile(wb, `walmart_wfs_${stamp()}.xlsx`);
}

function exportCsv() {
  const { cols, rows } = getExportRows();
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [cols.map(c => esc(c.label)).join(',')]
    .concat(rows.map(r => cols.map(c => esc(r[c.key])).join(',')))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `walmart_wfs_${stamp()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function exportPdf() {
  const { cols, rows } = getExportRows();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: cols.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Walmart WFS Inventory · Electronics MX', 40, 30);
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
  doc.save(`walmart_wfs_${stamp()}.pdf`);
}

/* ============================================================
   Auto refresh + utils
   ============================================================ */
function setAutoRefresh(seconds) {
  if (STATE.autoTimer) clearInterval(STATE.autoTimer);
  if (seconds > 0) STATE.autoTimer = setInterval(() => load(true), seconds * 1000);
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
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
