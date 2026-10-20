// Formatação de estacas, datas, números e coordenadas (padrão brasileiro).

const nfCache = {};
export function fmtNum(v, casas = 0) {
  if (v == null || !isFinite(v)) return '';
  const k = casas;
  if (!nfCache[k]) nfCache[k] = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  return nfCache[k].format(v);
}

/** 12300.5 -> "12+300,5" */
export function fmtEstaca(m) {
  if (m == null || !isFinite(m)) return '';
  const km = Math.floor(m / 1000 + 1e-9);
  const resto = m - km * 1000;
  if (Math.abs(resto - Math.round(resto)) < 1e-6) return `${km}+${String(Math.round(resto)).padStart(3, '0')}`;
  const inteiro = Math.floor(resto);
  const dec = (resto - inteiro).toFixed(3).slice(2).replace(/0+$/, '');
  return `${km}+${String(inteiro).padStart(3, '0')},${dec}`;
}

/** Aceita "12+300", "12+300,5", "12" (km) ou "12,5" (km). Devolve metros ou null. */
export function lerEstaca(txt) {
  const t = String(txt || '').trim().replace(/\s/g, '');
  if (!t) return null;
  const m = t.match(/^(\d+)\+(\d{1,3})(?:[.,](\d+))?$/);
  if (m) return Number(m[1]) * 1000 + Number(`${m[2]}.${m[3] || 0}`);
  const n = Number(t.replace(',', '.').replace(/km$/i, ''));
  return isFinite(n) ? n * 1000 : null;
}

const FUSO = 'America/Sao_Paulo';
const fData = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' });
const fHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
const fDia = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Aceita número (ms) ou texto "dd/mm/aaaa hh:mm[:ss]". */
export function paraData(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return new Date(v);
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}-03:00`);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
export const fmtData = (d) => (d ? fData.format(d) : '');
export const fmtHora = (d) => (d ? fHora.format(d) : '');
export const fmtDataHora = (d) => (d ? `${fData.format(d)} ${fHora.format(d)}` : '');
/** "2026-10-20" no fuso de Brasília. */
export const diaISO = (d) => (d ? fDia.format(d) : '');

export function hojeISO(deslocDias = 0) {
  const d = new Date(Date.now() - deslocDias * 86400000);
  return diaISO(d);
}

export function plural(n, um, varios) {
  return `${fmtNum(n)} ${n === 1 ? um : varios}`;
}

// ---------------------------------------------------------------- UTM (SIRGAS 2000)
export function paraUTM(lat, lon) {
  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const zona = Math.floor((lon + 180) / 6) + 1;
  const lon0 = ((zona - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lam - lon0);
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const M = a * ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
    - ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
    - ((35 * e6) / 3072) * Math.sin(6 * phi));
  const E = k0 * N * (A + ((1 - T + C) * A ** 3) / 6
    + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let Nn = k0 * (M + N * Math.tan(phi) * ((A * A) / 2
    + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) Nn += 10000000;
  return { E, N: Nn, zona, hemisferio: lat < 0 ? 'S' : 'N' };
}

export function fmtLatLon(lat, lon) {
  if (lat == null || lon == null) return '';
  return `${fmtNum(lat, 6)}, ${fmtNum(lon, 6)}`;
}
export function fmtUTM(lat, lon) {
  if (lat == null || lon == null) return '';
  const u = paraUTM(lat, lon);
  return `E ${fmtNum(u.E, 1)} · N ${fmtNum(u.N, 1)} (${u.zona}${u.hemisferio})`;
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
