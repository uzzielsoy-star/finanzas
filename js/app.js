import { initStore, isDemo } from './store.js';
import { ALLOWED_EMAILS, APP_NAME } from './config.js';
import * as U from './utils.js';

const { money, esc, norm, isAhorro } = U;
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const sheetWrap = $('#sheetWrap');
const sheetBody = $('#sheetBody');
const now = new Date();
const CHART_JS = 'js/vendor/chart.umd.min.js';

// ------------------------------------------------------------------ estado
const S = {
  user: null, loginMsg: '',
  tab: 'inicio', mode: 'mes', anchor: new Date(),
  txs: [], cats: [], txLoaded: false, year: null,
  hist: { year: now.getFullYear(), month: now.getMonth(), q: '', cats: new Set() },
  graf: { year: now.getFullYear(), donutMonth: -1 },
};
let store, unsubTx = null, unsubCat = null, charts = [], pendingImport = null, importKind = null;

// ------------------------------------------------------------------ helpers
const allowed = (email) => isDemo || !ALLOWED_EMAILS?.length || ALLOWED_EMAILS.some((e) => e.toLowerCase() === String(email || '').toLowerCase());
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const byDateDesc = (a, b) => b.fecha.localeCompare(a.fecha) || String(b.id).localeCompare(String(a.id));
const weeklyGoal = (c) => (c.metaSemanal > 0 ? c.metaSemanal : (c.metaMensual > 0 ? U.round2(c.metaMensual * 12 / 52) : 0));
const goalFor = (c) => (S.mode === 'mes' ? Number(c.metaMensual) || 0 : weeklyGoal(c));
const pct = (real, goal) => (goal > 0 ? Math.min(100, (real / goal) * 100) : real > 0 ? 100 : 0);

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 2600);
}
function fail(e) {
  console.error(e);
  toast(e?.code === 'permission-denied' ? 'Esta cuenta no tiene acceso. Pide que agreguen tu correo a las reglas.' : (e?.message || String(e)), 'bad');
}

// Categorías configuradas + las que aparecen en movimientos pero no están configuradas.
function catList() {
  const map = new Map();
  S.cats.forEach((c) => map.set(norm(c.nombre), { ...c, configured: true }));
  S.txs.forEach((t) => {
    const k = norm(t.categoria);
    if (!map.has(k)) map.set(k, { nombre: t.categoria, metaMensual: 0, metaSemanal: 0, configured: false });
  });
  return [...map.values()].sort((a, b) =>
    (isAhorro(a.nombre) - isAhorro(b.nombre)) || ((a.orden ?? 9e15) - (b.orden ?? 9e15)) || a.nombre.localeCompare(b.nombre, 'es'));
}

function periodRange() {
  if (S.mode === 'mes') {
    const a = S.anchor, y = a.getFullYear(), m = a.getMonth();
    return { from: U.toISO(new Date(y, m, 1)), to: U.toISO(new Date(y, m + 1, 0)), label: `${U.MESES[m]} ${y}` };
  }
  const s = U.startOfWeek(S.anchor), e = U.addDays(s, 6);
  return { from: U.toISO(s), to: U.toISO(e), label: `${s.getDate()} ${U.MES_CORTO[s.getMonth()]} – ${e.getDate()} ${U.MES_CORTO[e.getMonth()]} ${e.getFullYear()}` };
}
const inRange = (t, r) => t.fecha >= r.from && t.fecha <= r.to;

function yearOptions(sel) {
  const ys = []; const top = now.getFullYear();
  for (let y = top; y >= Math.min(top - 5, sel); y--) ys.push(y);
  return ys.map((y) => `<option value="${y}" ${y === sel ? 'selected' : ''}>${y}</option>`).join('');
}

// Escucha solo el año que se está viendo (± 1 semana para semanas que cruzan de año).
function yearForTab() {
  return S.tab === 'historial' ? S.hist.year : S.tab === 'graficas' ? S.graf.year : S.anchor.getFullYear();
}
function ensureYear() {
  const y = yearForTab();
  if (y === S.year) return;
  S.year = y; S.txLoaded = false; S.txs = [];
  unsubTx?.();
  unsubTx = store.watchRange(`${y - 1}-12-24`, `${y + 1}-01-07`, (txs) => { S.txs = txs; S.txLoaded = true; render(); }, fail);
}

// ------------------------------------------------------------------ hoja inferior (modal)
let sheetOpen = false;
function openSheet(html) {
  sheetBody.innerHTML = html;
  $('.sheet').scrollTop = 0;
  if (!sheetOpen) {
    sheetOpen = true; sheetWrap.hidden = false;
    requestAnimationFrame(() => sheetWrap.classList.add('open'));
    history.pushState({ sheet: 1 }, ''); // el botón "atrás" del celular cierra la hoja
  }
}
function closeSheet(fromPop = false) {
  if (!sheetOpen) return;
  sheetOpen = false; sheetWrap.classList.remove('open');
  setTimeout(() => { if (!sheetOpen) { sheetWrap.hidden = true; sheetBody.innerHTML = ''; } }, 220);
  if (!fromPop && history.state?.sheet) history.back();
}
addEventListener('popstate', () => closeSheet(true));
sheetWrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// Botón de confirmación en dos toques (sin diálogos del navegador).
function armConfirm(btn, label, fn) {
  if (btn.dataset.armed) return fn();
  const old = btn.textContent;
  btn.dataset.armed = '1'; btn.textContent = label; btn.classList.add('armed');
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = old; btn.classList.remove('armed'); } }, 3000);
}

// ------------------------------------------------------------------ piezas de UI
function txItem(t, showDate = true) {
  const sv = isAhorro(t.categoria) ? 'save' : '';
  return `<button class="tx" data-act="tx" data-v="${esc(t.id)}">
    <div class="tx-l">
      <div class="tx-c">${esc(t.concepto || t.categoria)}</div>
      <div class="tx-m">${showDate ? `${U.fmtShort(t.fecha)} · ` : ''}<span class="pill ${sv}">${esc(t.categoria)}</span>${t.notas ? ` · ${esc(t.notas)}` : ''}</div>
    </div>
    <div class="tx-a ${sv}">${money(t.cantidad)}</div>
  </button>`;
}

function barClass(real, goal, ahorro) {
  if (ahorro) return goal > 0 && real >= goal ? 'good' : 'save';
  if (!goal) return real > 0 ? 'warn' : '';
  const p = real / goal;
  return p > 1 ? 'bad' : p > 0.85 ? 'warn' : 'good';
}

function catRow(c, real) {
  const goal = goalFor(c), ah = isAhorro(c.nombre);
  let sub;
  if (ah) sub = goal > 0 ? (real >= goal ? `Meta cumplida${real > goal ? ` · +${money(real - goal)}` : ''}` : `Faltan ${money(goal - real)}`) : 'Sin meta';
  else sub = goal > 0 ? (real <= goal ? `Quedan ${money(goal - real)}` : `Excedido ${money(real - goal)}`) : 'Sin meta';
  const subCls = ah ? (goal > 0 && real >= goal ? 'good' : '') : (goal > 0 && real > goal ? 'bad' : '');
  return `<button class="cat-row" data-act="cat" data-v="${esc(c.nombre)}">
    <div class="cat-top"><span class="cat-name">${esc(c.nombre)}</span><span class="cat-amt">${money(real)}<small> / ${money(goal)}</small></span></div>
    <div class="bar"><i class="${barClass(real, goal, ah)}" style="width:${pct(real, goal)}%"></i></div>
    <div class="cat-sub ${subCls}">${sub}${S.mode === 'semana' && !c.metaSemanal && c.metaMensual ? ' · meta aprox.' : ''}</div>
  </button>`;
}

const loadingHTML = '<div class="loading"><span class="spin"></span>Cargando…</div>';

// ------------------------------------------------------------------ vistas
function render() {
  if (!S.user) return;
  $('#tabbar').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  if (S.tab === 'historial' && view.dataset.tab === 'historial' && document.activeElement?.id === 'q') return updateHistList();
  charts.forEach((c) => c.destroy()); charts = [];
  view.dataset.tab = S.tab;
  ({ inicio: renderInicio, historial: renderHistorial, graficas: renderGraficas, ajustes: renderAjustes })[S.tab]();
}

function renderInicio() {
  const r = periodRange();
  const isCurrent = U.todayISO() >= r.from && U.todayISO() <= r.to;
  const head = `<div class="period">
      <div class="seg"><button data-act="mode" data-v="mes" class="${S.mode === 'mes' ? 'on' : ''}">Mes</button><button data-act="mode" data-v="semana" class="${S.mode === 'semana' ? 'on' : ''}">Semana</button></div>
      <div class="pnav"><button data-act="prev" aria-label="Anterior">‹</button><span>${r.label}</span><button data-act="next" aria-label="Siguiente">›</button></div>
      ${isCurrent ? '' : '<button class="link" data-act="today">Ir a hoy</button>'}
    </div>`;
  if (!S.txLoaded) { view.innerHTML = head + loadingHTML; return; }

  const txs = S.txs.filter((t) => inRange(t, r));
  const real = new Map();
  txs.forEach((t) => real.set(norm(t.categoria), (real.get(norm(t.categoria)) || 0) + t.cantidad));
  const cats = catList().filter((c) => c.configured || real.get(norm(c.nombre)));
  let gR = 0, gM = 0, aR = 0, aM = 0;
  cats.forEach((c) => {
    const v = real.get(norm(c.nombre)) || 0;
    if (isAhorro(c.nombre)) { aR += v; aM += goalFor(c); } else { gR += v; gM += goalFor(c); }
  });
  const saldo = gM - gR;
  const gastos = cats.filter((c) => !isAhorro(c.nombre)), ahorros = cats.filter((c) => isAhorro(c.nombre));

  if (!S.cats.length && !S.txs.length) {
    view.innerHTML = head + `<div class="empty-state"><h3>¡Bienvenidos!</h3><p>Crea sus categorías con metas o importa lo que ya tienen en Google Sheets.</p>
      <button class="btn primary" data-act="goto" data-v="ajustes">Configurar categorías</button></div>`;
    return;
  }

  view.innerHTML = head + `
    <section class="summary">
      <div class="card">
        <div class="card-k">Gastos</div>
        <div class="card-v">${money(gR)}</div>
        <div class="card-s">de ${money(gM)} presupuestado</div>
        <div class="bar"><i class="${barClass(gR, gM, false)}" style="width:${pct(gR, gM)}%"></i></div>
        <div class="tag ${saldo >= 0 ? 'good' : 'bad'}">${saldo >= 0 ? 'Saldo a favor' : 'Déficit · reponer'} ${money(Math.abs(saldo))}</div>
      </div>
      <div class="card">
        <div class="card-k">Ahorro</div>
        <div class="card-v save">${money(aR)}</div>
        <div class="card-s">meta ${money(aM)}</div>
        <div class="bar"><i class="${barClass(aR, aM, true)}" style="width:${pct(aR, aM)}%"></i></div>
        <div class="tag ${aR >= aM ? 'good' : 'neutral'}">${aR >= aM ? `Meta cumplida${aR > aM ? ` +${money(aR - aM)}` : ''}` : `Faltan ${money(aM - aR)}`}</div>
      </div>
    </section>
    <h3 class="sec">Gastos por categoría</h3>
    <div class="cats">${gastos.map((c) => catRow(c, real.get(norm(c.nombre)) || 0)).join('') || '<p class="empty">Sin categorías de gasto</p>'}</div>
    ${ahorros.length ? `<h3 class="sec">Ahorros</h3><div class="cats">${ahorros.map((c) => catRow(c, real.get(norm(c.nombre)) || 0)).join('')}</div>` : ''}
    ${txs.length ? `<h3 class="sec">Últimos movimientos</h3><div class="txlist card-list">${[...txs].sort(byDateDesc).slice(0, 5).map((t) => txItem(t)).join('')}</div>
      <button class="link block" data-act="goto" data-v="historial">Ver todo el historial ›</button>` : ''}`;
}

function shiftPeriod(dir) {
  const a = new Date(S.anchor);
  if (S.mode === 'mes') { a.setDate(1); a.setMonth(a.getMonth() + dir); } else a.setDate(a.getDate() + 7 * dir);
  S.anchor = a; ensureYear(); render();
}

function openCatSheet(name) {
  const r = periodRange();
  const list = S.txs.filter((t) => inRange(t, r) && norm(t.categoria) === norm(name)).sort(byDateDesc);
  openSheet(`<h2>${esc(name)}</h2>
    <p class="muted">${r.label} · ${list.length} movimiento${list.length === 1 ? '' : 's'} · <b>${money(sum(list, (t) => t.cantidad))}</b></p>
    <div class="txlist">${list.map((t) => txItem(t)).join('') || '<p class="empty">Sin movimientos en este periodo</p>'}</div>
    <button class="btn primary block" data-act="addcat" data-v="${esc(name)}">+ Agregar en ${esc(name)}</button>`);
}

// ---------------- Historial
function histFiltered() {
  const h = S.hist, q = norm(h.q);
  return S.txs.filter((t) => t.fecha.startsWith(h.year + '-')
    && (h.month < 0 || +t.fecha.slice(5, 7) === h.month + 1)
    && (!h.cats.size || h.cats.has(norm(t.categoria)))
    && (!q || norm(`${t.concepto} ${t.notas} ${t.categoria} ${t.cantidad} ${t.id}`).includes(q))).sort(byDateDesc);
}
function renderHistorial() {
  const h = S.hist;
  view.innerHTML = `<div class="filters">
      <div class="row2">
        <select id="hYear" aria-label="Año">${yearOptions(h.year)}</select>
        <select id="hMonth" aria-label="Mes"><option value="-1">Todo el año</option>${U.MESES.map((m, i) => `<option value="${i}" ${i === h.month ? 'selected' : ''}>${m}</option>`).join('')}</select>
      </div>
      <input id="q" type="search" placeholder="Buscar concepto, nota, monto…" value="${esc(h.q)}" autocomplete="off">
      <div class="chips scroll">${catList().map((c) => `<button class="chip ${isAhorro(c.nombre) ? 'save' : ''} ${h.cats.has(norm(c.nombre)) ? 'on' : ''}" data-act="hcat" data-v="${esc(norm(c.nombre))}">${esc(c.nombre)}</button>`).join('')}</div>
    </div>
    <div id="histTotals" class="totals"></div>
    <div id="histList"></div>`;
  updateHistList();
}
function updateHistList() {
  const box = $('#histList'); if (!box) return;
  if (!S.txLoaded) { box.innerHTML = loadingHTML; $('#histTotals').innerHTML = ''; return; }
  const list = histFiltered();
  const g = sum(list.filter((t) => !isAhorro(t.categoria)), (t) => t.cantidad);
  const a = sum(list.filter((t) => isAhorro(t.categoria)), (t) => t.cantidad);
  $('#histTotals').innerHTML = `<span>${list.length} mov.</span><span>Gastos <b>${money(g)}</b></span><span>Ahorro <b class="save">${money(a)}</b></span>`;
  const groups = new Map();
  list.forEach((t) => { if (!groups.has(t.fecha)) groups.set(t.fecha, []); groups.get(t.fecha).push(t); });
  box.innerHTML = [...groups].map(([f, items]) => {
    const dg = sum(items.filter((t) => !isAhorro(t.categoria)), (t) => t.cantidad);
    const da = sum(items.filter((t) => isAhorro(t.categoria)), (t) => t.cantidad);
    return `<div class="day"><div class="day-h"><span>${U.fmtDay(f)}</span><span>${dg ? money(dg) : ''}${da ? ` <em class="save">+${money(da)} ahorro</em>` : ''}</span></div>
      <div class="txlist card-list">${items.map((t) => txItem(t, false)).join('')}</div></div>`;
  }).join('') || '<p class="empty">No hay movimientos con estos filtros</p>';
}

// ---------------- Gráficas y balance anual
async function renderGraficas() {
  const y = S.graf.year;
  const head = `<div class="period"><select id="gYear" aria-label="Año">${yearOptions(y)}</select></div>`;
  if (!S.txLoaded) { view.innerHTML = head + loadingHTML; return; }
  const txs = S.txs.filter((t) => t.fecha.startsWith(y + '-'));
  const g = Array(12).fill(0), a = Array(12).fill(0);
  txs.forEach((t) => { (isAhorro(t.categoria) ? a : g)[+t.fecha.slice(5, 7) - 1] += t.cantidad; });
  const presG = sum(S.cats.filter((c) => !isAhorro(c.nombre)), (c) => c.metaMensual);
  const presA = sum(S.cats.filter((c) => isAhorro(c.nombre)), (c) => c.metaMensual);
  const lastM = y < now.getFullYear() ? 11 : y > now.getFullYear() ? -1 : now.getMonth();
  let firstM = g.findIndex((v, i) => v || a[i]); if (firstM < 0) firstM = lastM + 1; // desde su primer mes con datos
  const elapsed = Math.max(0, lastM - firstM + 1);
  const gT = sum(g), aT = sum(a), saldo = presG * elapsed - gT;
  const dm = S.graf.donutMonth;

  const rows = U.MESES.map((m, i) => {
    if ((i > lastM || i < firstM) && !g[i] && !a[i]) return '';
    const s = presG - g[i];
    return `<tr data-act="gotomonth" data-v="${i}"><td>${m.slice(0, 3)}</td><td>${money(g[i])}</td>
      <td class="${s >= 0 ? 'good' : 'bad'}">${s >= 0 ? '+' : '−'}${money(Math.abs(s))}</td>
      <td class="save">${money(a[i])}${presA && a[i] >= presA ? ' ✓' : ''}</td></tr>`;
  }).join('');

  view.innerHTML = head + `
    <section class="summary">
      <div class="card"><div class="card-k">Gastos ${y}</div><div class="card-v">${money(gT)}</div>
        <div class="card-s">Presupuesto a la fecha ${money(presG * elapsed)}<br>Anual ${money(presG * 12)}</div>
        <div class="tag ${saldo >= 0 ? 'good' : 'bad'}">${saldo >= 0 ? 'A favor' : 'Déficit'} ${money(Math.abs(saldo))}</div></div>
      <div class="card"><div class="card-k">Ahorro ${y}</div><div class="card-v save">${money(aT)}</div>
        <div class="card-s">Meta a la fecha ${money(presA * elapsed)}<br>Anual ${money(presA * 12)}</div>
        <div class="tag ${aT >= presA * elapsed ? 'good' : 'neutral'}">${aT >= presA * elapsed ? 'Al corriente' : `Faltan ${money(presA * elapsed - aT)}`}</div></div>
    </section>
    <h3 class="sec">Evolución mensual</h3>
    <div class="chart-box"><canvas id="chEvo"></canvas></div>
    <h3 class="sec">Gastos por categoría</h3>
    <select id="gDonut" aria-label="Periodo de la gráfica"><option value="-1">Todo ${y}</option>${U.MESES.map((m, i) => `<option value="${i}" ${i === dm ? 'selected' : ''}>${m}</option>`).join('')}</select>
    <div class="chart-box donut"><canvas id="chDonut"></canvas></div>
    <div id="legend" class="legend"></div>
    <h3 class="sec">Balance mes a mes</h3>
    <p class="hint">Saldo = presupuesto de gastos − gasto real. Toca un mes para abrirlo.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Mes</th><th>Gasto</th><th>Saldo</th><th>Ahorro</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Sin datos</td></tr>'}</tbody></table></div>`;

  try { await U.loadScript(CHART_JS); } catch { $('#chEvo').parentElement.innerHTML = '<p class="empty">No se pudieron cargar las gráficas.</p>'; return; }
  if (view.dataset.tab !== 'graficas' || !$('#chEvo')) return;
  const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim();
  Chart.defaults.color = col('--muted'); Chart.defaults.borderColor = col('--line');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const tip = { callbacks: { label: (c) => ` ${c.dataset.label || c.label}: ${money(c.parsed.y ?? c.parsed)}` } };

  charts.push(new Chart($('#chEvo'), {
    data: {
      labels: U.MES_CORTO,
      datasets: [
        { type: 'bar', label: 'Gastos', data: g, backgroundColor: col('--accent'), borderRadius: 4 },
        { type: 'bar', label: 'Ahorro', data: a, backgroundColor: col('--save'), borderRadius: 4 },
        ...(presG ? [{ type: 'line', label: 'Presupuesto', data: Array(12).fill(presG), borderColor: col('--warn'), borderDash: [5, 4], pointRadius: 0, borderWidth: 2 }] : []),
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: tip },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => U.moneyShort(v) } }, x: { grid: { display: false } } } },
  }));

  const dTx = txs.filter((t) => !isAhorro(t.categoria) && (dm < 0 || +t.fecha.slice(5, 7) === dm + 1));
  const byCat = new Map(); dTx.forEach((t) => byCat.set(t.categoria, (byCat.get(t.categoria) || 0) + t.cantidad));
  const entries = [...byCat].sort((p, q) => q[1] - p[1]);
  const palette = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b'];
  const total = sum(entries, (e) => e[1]);
  if (!entries.length) { $('#chDonut').parentElement.innerHTML = '<p class="empty">Sin gastos en este periodo</p>'; return; }
  charts.push(new Chart($('#chDonut'), {
    type: 'doughnut',
    data: { labels: entries.map((e) => e[0]), datasets: [{ data: entries.map((e) => e[1]), backgroundColor: entries.map((_, i) => palette[i % palette.length]), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false }, tooltip: tip } },
  }));
  $('#legend').innerHTML = entries.map((e, i) => `<div><i style="background:${palette[i % palette.length]}"></i><span>${esc(e[0])}</span><b>${money(e[1])}</b><em>${Math.round(e[1] / total * 100)}%</em></div>`).join('');
}

// ---------------- Ajustes
function renderAjustes() {
  const cats = catList().filter((c) => c.configured);
  view.innerHTML = `
    ${isDemo ? '<div class="notice"><b>Modo demo:</b> los datos se guardan solo en este navegador. Para usarla en serio, configura Firebase en <code>js/config.js</code> (ver README).</div>' : ''}
    <h3 class="sec">Categorías y metas</h3>
    <p class="hint">Las categorías que contienen “ahorro” cuentan como ahorro. Si no pones meta semanal, se calcula de la mensual (×12 ÷ 52).</p>
    <div class="list">${cats.map((c) => `<button class="li" data-act="editcat" data-v="${esc(c.id)}">
        <span class="li-t"><i class="dot ${isAhorro(c.nombre) ? 'save' : ''}"></i>${esc(c.nombre)}</span>
        <span class="li-s">${money(c.metaMensual)}/mes · ${money(weeklyGoal(c))}/sem${c.metaSemanal ? '' : ' (aprox.)'}</span></button>`).join('') || '<p class="empty">Aún no hay categorías</p>'}</div>
    <button class="btn block" data-act="newcat">+ Nueva categoría</button>

    <h3 class="sec">Datos</h3>
    <div class="list">
      <button class="li" data-act="import-tx"><span class="li-t">Importar movimientos (CSV)</span><span class="li-s">De tu hoja: Archivo › Descargar › CSV (pestaña de transacciones)</span></button>
      <button class="li" data-act="import-cat"><span class="li-t">Importar categorías y metas (CSV)</span><span class="li-s">La pestaña “Configuracion” descargada como CSV</span></button>
      <button class="li" data-act="export"><span class="li-t">Exportar todo a CSV</span><span class="li-s">Para abrirlo en Sheets o Excel cuando quieran</span></button>
    </div>

    <h3 class="sec">Cuenta</h3>
    <div class="list">
      <div class="li static"><span class="li-t">${esc(S.user.name)}</span><span class="li-s">${esc(S.user.email)}</span></div>
      ${isDemo ? '<button class="li" data-act="resetdemo"><span class="li-t bad">Reiniciar datos demo</span></button>' : '<button class="li" data-act="logout"><span class="li-t bad">Cerrar sesión</span></button>'}
    </div>
    <input type="file" id="fileIn" accept=".csv,text/csv" hidden>
    <p class="foot">${esc(APP_NAME)} · ${isDemo ? 'demo local' : 'sincronizado con Firebase'}</p>`;
}

// ------------------------------------------------------------------ formularios
function openTxForm(tx = null, presetCat = '') {
  const editing = !!tx;
  const cats = catList().filter((c) => c.configured || (tx && norm(c.nombre) === norm(tx.categoria)));
  let sel = tx?.categoria || presetCat || '';
  const conceptos = [...new Set([...S.txs].sort(byDateDesc).map((t) => t.concepto).filter(Boolean))].slice(0, 40);

  openSheet(`<h2>${editing ? 'Editar movimiento' : 'Nuevo movimiento'}</h2>
    <form id="txf" autocomplete="off" novalidate>
      <label class="amount"><span>$</span><input name="cantidad" inputmode="decimal" placeholder="0.00" value="${tx ? tx.cantidad : ''}" aria-label="Cantidad"></label>
      <div class="field-label">Categoría</div>
      <div class="chips wrap" id="catChips">${cats.map((c) => `<button type="button" class="chip ${isAhorro(c.nombre) ? 'save' : ''} ${norm(c.nombre) === norm(sel) ? 'on' : ''}" data-cat="${esc(c.nombre)}">${esc(c.nombre)}</button>`).join('')
        || '<p class="hint">Primero crea categorías en Ajustes.</p>'}</div>
      <label class="field"><span>Concepto</span><input name="concepto" list="dlConceptos" value="${esc(tx?.concepto || '')}" placeholder="Ej. Walmart, gasolina…"></label>
      <datalist id="dlConceptos">${conceptos.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="row2">
        <label class="field"><span>Fecha</span><input type="date" name="fecha" value="${tx?.fecha || U.todayISO()}"></label>
        <label class="field"><span>Notas</span><input name="notas" value="${esc(tx?.notas || '')}" placeholder="Opcional"></label>
      </div>
      <p class="form-err" id="txErr"></p>
      <div class="form-actions">
        ${editing ? '<button type="button" class="btn danger" id="delBtn">Eliminar</button>' : ''}
        <button class="btn primary grow" type="submit">Guardar</button>
      </div>
      ${editing ? `<p class="foot">${esc(tx.id)}${tx.creadoPor ? ` · creado por ${esc(tx.creadoPor)}` : ''}</p>` : ''}
    </form>`);

  const f = $('#txf');
  $('#catChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    sel = b.dataset.cat; $('#txErr').textContent = '';
    $('#catChips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b));
  });
  if (!editing) setTimeout(() => f.cantidad.focus(), 250);

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    let data;
    try { data = U.cleanTx({ cantidad: f.cantidad.value, categoria: sel, concepto: f.concepto.value, fecha: f.fecha.value, notas: f.notas.value }); }
    catch (err) { $('#txErr').textContent = err.message; return; }
    if (editing) {
      const same = ['fecha', 'categoria', 'concepto', 'cantidad', 'notas'].every((k) => String(data[k]) === String(tx[k] ?? (k === 'notas' ? '' : '')));
      closeSheet();
      if (same) return;
      store.updateTx(tx.id, data).catch(fail);
      toast('Movimiento actualizado');
    } else {
      store.addTx(data).catch(fail);
      closeSheet();
      toast(`Guardado: ${money(data.cantidad)} en ${data.categoria}`);
    }
  });
  $('#delBtn')?.addEventListener('click', (e) => armConfirm(e.currentTarget, '¿Seguro? Toca otra vez', () => {
    store.deleteTx(tx.id).catch(fail); closeSheet(); toast('Movimiento eliminado');
  }));
}

function openCatForm(cat = null) {
  openSheet(`<h2>${cat ? 'Editar categoría' : 'Nueva categoría'}</h2>
    <form id="catf" autocomplete="off" novalidate>
      <label class="field"><span>Nombre</span><input name="nombre" value="${esc(cat?.nombre || '')}" placeholder="Ej. Súper, Ahorro viaje"></label>
      <p class="hint" id="catKind"></p>
      <div class="row2">
        <label class="field"><span>Meta mensual</span><input name="metaMensual" inputmode="decimal" value="${cat?.metaMensual || ''}" placeholder="0"></label>
        <label class="field"><span>Meta semanal</span><input name="metaSemanal" inputmode="decimal" value="${cat?.metaSemanal || ''}" placeholder="auto"></label>
      </div>
      <p class="form-err" id="catErr"></p>
      <div class="form-actions">
        ${cat ? '<button type="button" class="btn danger" id="delCat">Eliminar</button>' : ''}
        <button class="btn primary grow" type="submit">Guardar</button>
      </div>
    </form>`);
  const f = $('#catf');
  const kind = () => { $('#catKind').innerHTML = f.nombre.value.trim() ? (isAhorro(f.nombre.value) ? 'Contará como <b class="save">Ahorro</b>' : 'Contará como <b>Gasto</b>') : ''; };
  f.nombre.addEventListener('input', kind); kind();
  if (!cat) setTimeout(() => f.nombre.focus(), 250);

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = f.nombre.value.trim().replace(/\s+/g, ' ');
    if (!nombre) { $('#catErr').textContent = 'Escribe un nombre'; return; }
    if (S.cats.some((c) => c.id !== cat?.id && norm(c.nombre) === norm(nombre))) { $('#catErr').textContent = 'Ya existe una categoría con ese nombre'; return; }
    const data = { id: cat?.id, nombre, metaMensual: U.parseAmount(f.metaMensual.value), metaSemanal: U.parseAmount(f.metaSemanal.value) };
    closeSheet();
    try {
      if (cat && cat.nombre !== nombre) {
        toast('Renombrando y actualizando movimientos…');
        await store.saveCategory(data);
        const n = await store.renameCategory(cat.nombre, nombre);
        toast(`Categoría renombrada (${n} movimientos actualizados)`);
      } else { store.saveCategory(data).catch(fail); toast('Categoría guardada'); }
    } catch (err) { fail(err); }
  });
  $('#delCat')?.addEventListener('click', (e) => armConfirm(e.currentTarget, '¿Seguro? Toca otra vez', () => {
    store.deleteCategory(cat.id).catch(fail); closeSheet();
    toast('Categoría eliminada (sus movimientos se conservan)');
  }));
}

// ------------------------------------------------------------------ importar / exportar
function pickFile(kind) { importKind = kind; const f = $('#fileIn'); f.value = ''; f.click(); }

async function handleFile(file) {
  if (!file) return;
  const rows = U.parseCSV(await file.text());
  if (importKind === 'tx') {
    const items = rows.map((r) => ({
      id: /^TRX-/i.test(r.id || '') ? r.id.trim().toUpperCase() : null,
      fecha: U.parseDateFlexible(r.fecha), categoria: (r.categoria || '').trim(),
      concepto: (r.concepto || '').trim(), cantidad: U.round2(U.parseAmount(r.cantidad ?? r.monto)), notas: (r.notas || '').trim(),
    }));
    const ok = items.filter((t) => t.fecha && t.categoria && t.cantidad > 0);
    const bad = items.length - ok.length;
    const newCats = [...new Map(ok.filter((t) => !S.cats.some((c) => norm(c.nombre) === norm(t.categoria))).map((t) => [norm(t.categoria), t.categoria])).values()];
    pendingImport = { kind: 'tx', items: ok, newCats };
    openSheet(`<h2>Importar movimientos</h2>
      <p><b>${ok.length}</b> movimientos válidos${bad ? ` · ${bad} filas ignoradas (sin fecha, categoría o cantidad)` : ''}.</p>
      ${newCats.length ? `<p class="hint">Se crearán ${newCats.length} categorías nuevas sin meta: ${newCats.map(esc).join(', ')}.</p>` : ''}
      <div class="txlist">${ok.slice(0, 5).map((t) => txItem(t)).join('')}</div>
      <p class="hint">Si un ID ya existe se actualiza en lugar de duplicarse, así que puedes importar dos veces sin problema.</p>
      <button class="btn primary block" data-act="doimport" ${ok.length ? '' : 'disabled'}>Importar ${ok.length}</button>`);
  } else {
    const items = rows.map((r) => ({ nombre: (r.categoria || r.nombre || '').trim(), metaMensual: U.parseAmount(r['meta mensual']), metaSemanal: U.parseAmount(r['meta semanal']) })).filter((c) => c.nombre);
    pendingImport = { kind: 'cat', items };
    openSheet(`<h2>Importar categorías</h2><p><b>${items.length}</b> categorías encontradas. Las que ya existan se actualizan.</p>
      <div class="list">${items.map((c) => `<div class="li static"><span class="li-t">${esc(c.nombre)}</span><span class="li-s">${money(c.metaMensual)}/mes · ${c.metaSemanal ? money(c.metaSemanal) + '/sem' : 'semanal auto'}</span></div>`).join('')}</div>
      <button class="btn primary block" data-act="doimport" ${items.length ? '' : 'disabled'}>Importar ${items.length}</button>`);
  }
}

async function doImport(btn) {
  const p = pendingImport; if (!p) return;
  btn.disabled = true; btn.textContent = 'Importando…';
  try {
    if (p.kind === 'tx') {
      if (p.newCats.length) await store.importCategories(p.newCats.map((nombre) => ({ nombre, metaMensual: 0, metaSemanal: 0 })));
      await store.importTransactions(p.items);
    } else await store.importCategories(p.items);
    toast(`Importación lista: ${p.items.length} registros`);
    pendingImport = null; closeSheet();
  } catch (e) { fail(e); btn.disabled = false; btn.textContent = 'Reintentar'; }
}

async function exportCSV() {
  try {
    toast('Preparando archivo…');
    const all = (await store.getAllTransactions()).sort((a, b) => a.fecha.localeCompare(b.fecha));
    U.download(`finanzas-${U.todayISO()}.csv`, U.toCSV(all.map((t) => [t.id, t.fecha, t.categoria, t.concepto, t.cantidad, t.notas || '']), ['ID', 'Fecha', 'Categoria', 'Concepto', 'Cantidad', 'Notas']));
  } catch (e) { fail(e); }
}

// ------------------------------------------------------------------ eventos
function handleAct(el) {
  const act = el.dataset.act, v = el.dataset.v;
  switch (act) {
    case 'mode': S.mode = v; render(); break;
    case 'prev': shiftPeriod(-1); break;
    case 'next': shiftPeriod(1); break;
    case 'today': S.anchor = new Date(); ensureYear(); render(); break;
    case 'cat': openCatSheet(v); break;
    case 'addcat': openTxForm(null, v); break;
    case 'tx': { const t = S.txs.find((x) => x.id === v); if (t) openTxForm(t); break; }
    case 'goto': goTab(v); break;
    case 'hcat': { const s = S.hist.cats; s.has(v) ? s.delete(v) : s.add(v); el.classList.toggle('on'); updateHistList(); break; }
    case 'gotomonth': S.anchor = new Date(S.graf.year, +v, 1); S.mode = 'mes'; goTab('inicio'); break;
    case 'editcat': { const c = S.cats.find((x) => x.id === v); if (c) openCatForm(c); break; }
    case 'newcat': openCatForm(); break;
    case 'import-tx': pickFile('tx'); break;
    case 'import-cat': pickFile('cat'); break;
    case 'doimport': doImport(el); break;
    case 'export': exportCSV(); break;
    case 'logout': store.signOut(); break;
    case 'resetdemo': armConfirm(el, '¿Seguro? Toca otra vez', () => store.resetDemo()); break;
    case 'login': S.loginMsg = ''; store.signIn().catch(fail); break;
  }
}
view.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (el) handleAct(el); });
sheetBody.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (el) handleAct(el); });
view.addEventListener('input', (e) => { if (e.target.id === 'q') { S.hist.q = e.target.value; updateHistList(); } });
view.addEventListener('change', (e) => {
  const id = e.target.id, v = +e.target.value;
  if (id === 'hYear') { S.hist.year = v; ensureYear(); render(); }
  else if (id === 'hMonth') { S.hist.month = v; updateHistList(); }
  else if (id === 'gYear') { S.graf.year = v; ensureYear(); render(); }
  else if (id === 'gDonut') { S.graf.donutMonth = v; render(); }
  else if (id === 'fileIn') handleFile(e.target.files[0]);
});

function goTab(tab) { S.tab = tab; ensureYear(); render(); scrollTo(0, 0); }
$('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) goTab(b.dataset.tab); });
$('#fab').addEventListener('click', () => openTxForm());
$('#userBtn').addEventListener('click', () => S.user && goTab('ajustes'));

const net = () => $('#netBadge').classList.toggle('hidden', navigator.onLine);
addEventListener('online', net); addEventListener('offline', net); net();

// ------------------------------------------------------------------ arranque
function renderLogin() {
  $('#tabbar').classList.add('hidden'); $('#fab').classList.add('hidden'); $('#userBtn').innerHTML = '';
  view.dataset.tab = 'login';
  view.innerHTML = `<div class="login">
    <img src="icons/icon-192.png" alt="" width="84" height="84">
    <h2>${esc(APP_NAME)}</h2><p class="muted">Gastos y ahorros en pareja</p>
    ${S.loginMsg ? `<p class="bad">${esc(S.loginMsg)}</p>` : ''}
    <button class="btn primary" data-act="login">Entrar con Google</button></div>`;
}

async function boot() {
  document.title = APP_NAME; $('#appTitle').textContent = APP_NAME;
  try { store = await initStore(); }
  catch (e) {
    console.error(e);
    view.innerHTML = '<div class="login"><p class="bad">No se pudo cargar Firebase.</p><p class="muted">Revisa tu conexión y los datos de js/config.js.</p></div>';
    return;
  }
  store.onAuth((user) => {
    if (user && !allowed(user.email)) { S.loginMsg = `La cuenta ${user.email} no tiene acceso.`; store.signOut(); return; }
    S.user = user;
    if (!user) {
      unsubTx?.(); unsubCat?.(); unsubTx = unsubCat = null;
      S.year = null; S.txs = []; S.cats = [];
      renderLogin(); return;
    }
    $('#tabbar').classList.remove('hidden'); $('#fab').classList.remove('hidden');
    $('#userBtn').innerHTML = user.photo ? `<img src="${esc(user.photo)}" alt="" referrerpolicy="no-referrer">` : esc((user.name || '?')[0].toUpperCase());
    unsubCat?.(); unsubCat = store.watchCategories((c) => { S.cats = c; render(); }, fail);
    S.year = null; ensureYear(); render();
  });
}
boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
