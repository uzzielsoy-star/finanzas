// Utilidades sin dependencias: formato, fechas, CSV, validación.

const fmt0 = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => { const v = Math.round((Number(n) || 0) * 100) / 100; return (Number.isInteger(v) ? fmt0 : fmt2).format(v); };
export const moneyShort = (n) => {
  const v = Number(n) || 0, a = Math.abs(v);
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1).replace('.0', '') + 'k';
  return '$' + Math.round(v);
};
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Regla de negocio: cualquier categoría que contenga "ahorro" es Ahorro; lo demás es Gasto.
export const isAhorro = (cat) => norm(cat).includes('ahorro');

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const todayISO = () => toISO(new Date());
export function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function startOfWeek(d) { // semana de lunes a domingo
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
export function fmtShort(iso) { const d = parseISO(iso); return `${d.getDate()} ${MES_CORTO[d.getMonth()]}`; }
export function fmtDay(iso) {
  const t = todayISO();
  if (iso === t) return 'Hoy';
  if (iso === toISO(addDays(new Date(), -1))) return 'Ayer';
  const d = parseISO(iso);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()}`;
}

export function newTxId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint8Array(6));
  return 'TRX-' + Array.from(a, (b) => chars[b % chars.length]).join('');
}

// Acepta "1,234.50", "$1 234", "1.234,50", "12,5", números…
export function parseAmount(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[^\d,.\-]/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    const parts = s.split(',');
    s = parts.length > 2 || parts[parts.length - 1].length === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// Fechas de Sheets: "2025-03-14", "14/03/2025", "14/3/25", "2025-03-14 10:22:00"
export function parseDateFlexible(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return valid(y, +m[2], +m[1]); } // día/mes/año (formato MX)
  const n = Number(s);
  if (n > 30000 && n < 80000) return toISO(new Date(Math.round((n - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000)); // serial de Sheets
  return null;
  function valid(y, mo, d) {
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? toISO(dt) : null;
  }
}

// Valida y limpia un movimiento. Lanza error si falta algo: nunca se guarda un registro vacío.
export function cleanTx(d) {
  const tx = {
    fecha: parseDateFlexible(d.fecha),
    categoria: String(d.categoria ?? '').trim(),
    concepto: String(d.concepto ?? '').trim(),
    cantidad: round2(parseAmount(d.cantidad)),
    notas: String(d.notas ?? '').trim(),
  };
  if (!tx.fecha) throw new Error('Fecha inválida');
  if (!tx.categoria) throw new Error('Falta la categoría');
  if (!(tx.cantidad > 0)) throw new Error('La cantidad debe ser mayor a 0');
  if (!tx.concepto) tx.concepto = tx.categoria;
  return tx;
}

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', q = false;
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const clean = rows.filter((r) => r.some((x) => x.trim()));
  if (!clean.length) return [];
  const head = clean[0].map(norm);
  return clean.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export function toCSV(rows, headers) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function download(name, content, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const loaded = {};
export function loadScript(src) {
  return loaded[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => { delete loaded[src]; rej(new Error('No se pudo cargar ' + src)); };
    document.head.appendChild(s);
  });
}
