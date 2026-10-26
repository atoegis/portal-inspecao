// Leitura de coordenadas e data escritas em texto (legenda carimbada na foto, lida por OCR).
// Formatos aceitos: o do app ("Lat -14,060273  Lon -49,236258"), graus decimais com ou sem
// hemisfério, graus/minutos/segundos e UTM (E/N, com zona).

const FAIXA_LAT = [-34, 6];   // Brasil, com folga
const FAIXA_LON = [-75, -28];

function n(s) {
  return Number(String(s).replace(/\s/g, '').replace(',', '.'));
}

function noBrasil(lat, lon) {
  return isFinite(lat) && isFinite(lon) && lat >= FAIXA_LAT[0] && lat <= FAIXA_LAT[1] && lon >= FAIXA_LON[0] && lon <= FAIXA_LON[1];
}

/** Corrige trocas comuns do OCR dentro de trechos numéricos. */
export function limparOCR(t) {
  return String(t || '')
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[−–—]/g, '-')
    .replace(/(\d)\s*[º˚°oO]\s*(?=\d{1,2}\s*['’])/g, '$1°')
    .replace(/(?<=[\d.,])[oO](?=\d)/g, '0')
    .replace(/(?<=[\d.,])[lI|](?=\d)/g, '1')
    .replace(/(\d)\s*[º˚]\s*/g, '$1°')
    .replace(/[ \t]+/g, ' ');
}

/** UTM (SIRGAS 2000 / WGS84) para latitude e longitude. */
export function utmParaLatLon(E, N, zona, sul = true) {
  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const x = E - 500000;
  const y = sul ? N - 10000000 : N;
  const lon0 = ((zona - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = ep2 * Math.cos(phi1) ** 2;
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * k0);
  const lat = phi1 - ((N1 * Math.tan(phi1)) / R1) * ((D * D) / 2
    - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(phi1);
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/**
 * Procura uma coordenada no texto. Devolve { lat, lon, formato } ou null.
 * zonaPadrao: fuso UTM usado quando o texto não informa (22 na obra).
 * avaliar(lat, lon): opcional, devolve a distância ao traçado; quando o texto não diz o fuso UTM,
 * fica o fuso que cai mais perto da obra.
 */
export function lerCoordenada(texto, zonaPadrao = 22, avaliar = null) {
  const t = limparOCR(texto);
  let m;

  // 1) formato do app: "Lat -14,060273  Lon -49,236258"
  m = t.match(/Lat[a-z]*\.?\s*:?\s*(-?\s?\d{1,2}[.,]\d{3,})[^\d-]{1,20}Lo[nm]g?[a-z]*\.?\s*:?\s*(-?\s?\d{1,3}[.,]\d{3,})/i);
  if (m) {
    let lat = n(m[1]);
    let lon = n(m[2]);
    if (lat > 0 && lon < 0) lat = -lat; // sinal perdido no OCR (obra no hemisfério sul)
    if (lon > 0) lon = -lon;
    if (noBrasil(lat, lon)) return { lat, lon, formato: 'Lat/Lon' };
  }

  // 2) graus, minutos e segundos: 14°03'37.0"S 49°14'10.5"W
  const dms = /(\d{1,3})\s*°\s*(\d{1,2})\s*['’]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:"|''|”)?\s*([NSLOWE])/gi;
  const achados = [...t.matchAll(dms)];
  if (achados.length >= 2) {
    const conv = (a) => {
      const v = Number(a[1]) + Number(a[2]) / 60 + n(a[3]) / 3600;
      const h = a[4].toUpperCase();
      return { v: h === 'S' || h === 'W' || h === 'O' ? -v : v, eixo: h === 'N' || h === 'S' ? 'lat' : 'lon' };
    };
    const c = achados.slice(0, 2).map(conv);
    const lat = (c.find((x) => x.eixo === 'lat') || c[0]).v;
    const lon = (c.find((x) => x.eixo === 'lon') || c[1]).v;
    if (noBrasil(lat, lon)) return { lat, lon, formato: 'GMS' };
  }

  // 3) UTM: "E 690.444,8  N 8.444.895,5 (22S)", "N 8401547 E 603880", "690444 E 8444895 N" ou "22L 690444 8444895"
  const zonasTexto = [];
  for (const z of t.matchAll(/\(?\b(1[89]|2[0-5])\s?([C-HJ-NP-X])\b\)?/g)) zonasTexto.push(Number(z[1]));
  const zz = t.match(/(?:zona|fuso)\s*(\d{2})/i);
  if (zz) zonasTexto.unshift(Number(zz[1]));
  const numUTM = (s) => Number(String(s).replace(/[.\s](?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  const LE = '(\\d{3}[.\\s]?\\d{3}(?:[.,]\\d+)?)';                 // Este: 6 dígitos
  const LN = '(\\d{1,2}[.\\s]?\\d{3}[.\\s]?\\d{3}(?:[.,]\\d+)?)';   // Norte: 7 dígitos
  const padroes = [
    [new RegExp(`\\bE\\s*[:=]?\\s*${LE}\\D{1,15}?\\bN\\s*[:=]?\\s*${LN}`, 'i'), 1, 2],
    [new RegExp(`\\bN\\s*[:=]?\\s*${LN}\\D{1,15}?\\bE\\s*[:=]?\\s*${LE}`, 'i'), 2, 1],
    [new RegExp(`${LE}\\s*(?:m\\s*)?E\\b\\D{1,15}?${LN}\\s*(?:m\\s*)?N\\b`, 'i'), 1, 2],
    [new RegExp(`${LN}\\s*(?:m\\s*)?N\\b\\D{1,15}?${LE}\\s*(?:m\\s*)?E\\b`, 'i'), 2, 1],
  ];
  for (const [rx, iE, iN] of padroes) {
    m = t.match(rx);
    if (!m) continue;
    const E = numUTM(m[iE]);
    const N = numUTM(m[iN]);
    if (!(E > 100000 && E < 900000 && N > 6000000 && N < 10000000)) continue;
    const zonas = zonasTexto.length ? zonasTexto : [zonaPadrao, zonaPadrao - 1, zonaPadrao + 1];
    const cands = zonas.map((zona) => ({ ...utmParaLatLon(E, N, zona, true), formato: `UTM ${zona}S` }))
      .filter((r) => noBrasil(r.lat, r.lon));
    if (!cands.length) continue;
    if (avaliar && !zonasTexto.length && cands.length > 1) {
      cands.forEach((c) => { c.d = avaliar(c.lat, c.lon); });
      cands.sort((a, b) => a.d - b.d);
      delete cands[0].d;
    }
    return cands[0];
  }

  // 4) graus decimais com hemisfério: "14,060273 S  49,236258 W" ou "S 14.0603 W 49.2362"
  m = t.match(/(\d{1,2}[.,]\d{3,})\s*°?\s*([NS])\b[\s,;]+(\d{1,3}[.,]\d{3,})\s*°?\s*([LOWE])\b/i)
    || t.match(/\b([NS])\s*(\d{1,2}[.,]\d{3,})°?[\s,;]+([LOWE])\s*(\d{1,3}[.,]\d{3,})/i);
  if (m) {
    const [lat0, hLat, lon0, hLon] = /^\d/.test(m[1]) ? [m[1], m[2], m[3], m[4]] : [m[2], m[1], m[4], m[3]];
    const lat = n(lat0) * (/S/i.test(hLat) ? -1 : 1);
    const lon = n(lon0) * (/[OW]/i.test(hLon) ? -1 : 1);
    if (noBrasil(lat, lon)) return { lat, lon, formato: 'Graus decimais' };
  }

  // 5) par de graus decimais solto: "-14.060273, -49.236258"
  for (const p of t.matchAll(/(-?\d{1,2}[.,]\d{4,})\s*°?\s*[,;/\s]\s*(-?\d{1,3}[.,]\d{4,})/g)) {
    let lat = n(p[1]);
    let lon = n(p[2]);
    if (lat > 0 && lon > 0 && lon > 28) { lat = -lat; lon = -lon; }
    if (noBrasil(lat, lon)) return { lat, lon, formato: 'Graus decimais' };
  }
  return null;
}

const MESES = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };

/** Data e hora escritas no texto: "21/10/2026 14:52:08", "2026-10-21 14:52", "21.10.2026 14h52", "14 de out. de 2026, 10:20:55". */
export function lerDataHora(texto) {
  const t = limparOCR(texto);
  const mm = t.match(/(\d{1,2})\s*\.?\s*(?:de\s*)?([a-zç]{3})[a-zç]*[.:,"'\s]*(?:de\s*)?(\d{4})[\s,.;/-]+(?:às\s*)?(\d{1,2})[:h.](\d{2})(?:[:.](\d{2}))?/i);
  const mes = mm && (MESES[mm[2].toLowerCase()] || MESES[mm[2].toLowerCase().replace(/^q/, 'o').replace(/l$/, 't')]);
  if (mes) {
    const p = (x) => String(x).padStart(2, '0');
    return new Date(`${mm[3]}-${p(mes)}-${p(mm[1])}T${p(mm[4])}:${mm[5]}:${mm[6] || '00'}-03:00`);
  }
  let m = t.match(/(\d{2})[/.-](\d{2})[/.-](\d{4})[\sT,]+(\d{1,2})[:h](\d{2})(?::(\d{2}))?/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}-03:00`);
  m = t.match(/(\d{4})[/.-](\d{2})[/.-](\d{2})[\sT,]+(\d{1,2})[:h](\d{2})(?::(\d{2}))?/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}-03:00`);
  return null;
}

/** Estaca escrita no texto ("Km 120+420", "EST 12+300", "Estaca 5+020 (Alça Sul)"). Devolve { m, eixo } ou null. */
export function lerEstacaTexto(texto) {
  const t = limparOCR(texto);
  const m = t.match(/(?:\bKm|\bEST(?:ACA)?\.?)\s*[:=]?\s*(\d{1,3})\s*\+\s*(\d{3}(?:[.,]\d+)?)/i);
  if (!m) return null;
  return { m: Number(m[1]) * 1000 + Number(m[2].replace(',', '.')), eixo: /al[cç]a\s*sul/i.test(t) ? 'Alça Sul' : '' };
}
