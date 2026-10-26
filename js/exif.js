// Leitura mínima de EXIF em JPEG: posição GPS, precisão e data/hora da foto.

/** Devolve { lat, lon, precisao, data } (campos ausentes ficam null). */
export async function lerExif(arquivo) {
  const vazio = { lat: null, lon: null, precisao: null, data: null };
  try {
    const buf = await arquivo.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return vazio;
    let p = 2;
    while (p + 4 < v.byteLength) {
      const marca = v.getUint16(p);
      const tam = v.getUint16(p + 2);
      if (marca === 0xFFE1 && v.getUint32(p + 4) === 0x45786966) { // "Exif"
        return { ...vazio, ...lerTiff(v, p + 10) };
      }
      if ((marca & 0xFF00) !== 0xFF00 || marca === 0xFFDA) break;
      p += 2 + tam;
    }
  } catch (e) { /* sem EXIF legível */ }
  return vazio;
}

function lerTiff(v, ini) {
  const le = v.getUint16(ini) === 0x4949;
  const u16 = (o) => v.getUint16(ini + o, le);
  const u32 = (o) => v.getUint32(ini + o, le);
  const ifd = (o) => {
    const tags = {};
    if (!o || ini + o + 2 > v.byteLength) return tags;
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12;
      if (ini + e + 12 > v.byteLength) break;
      tags[u16(e)] = { tipo: u16(e + 2), qtd: u32(e + 4), valor: e + 8 };
    }
    return tags;
  };
  const off = (t) => (t.tipo === 2 && t.qtd <= 4) || (t.tipo === 3 && t.qtd <= 2) || (t.tipo === 4 && t.qtd <= 1) || (t.tipo === 1 && t.qtd <= 4) ? t.valor : u32(t.valor);
  const texto = (t) => {
    if (!t) return '';
    const o = off(t);
    let s = '';
    for (let i = 0; i < t.qtd - 1 && ini + o + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(ini + o + i));
    return s;
  };
  const racionais = (t) => {
    if (!t) return null;
    const o = off(t);
    const r = [];
    for (let i = 0; i < t.qtd; i++) {
      const a = u32(o + i * 8);
      const b = u32(o + i * 8 + 4);
      r.push(b ? a / b : 0);
    }
    return r;
  };
  const ifd0 = ifd(u32(4));
  const res = {};
  const exifIfd = ifd0[0x8769] ? ifd(u32(ifd0[0x8769].valor)) : {};
  const dt = texto(exifIfd[0x9003]) || texto(ifd0[0x0132]);
  const fuso = texto(exifIfd[0x9011]) || '-03:00';
  const m = dt.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (m) res.data = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${/^[+-]\d{2}:\d{2}$/.test(fuso) ? fuso : '-03:00'}`);
  if (ifd0[0x8825]) {
    const g = ifd(u32(ifd0[0x8825].valor));
    const la = racionais(g[2]);
    const lo = racionais(g[4]);
    if (la && lo && la.length >= 3 && lo.length >= 3) {
      let lat = la[0] + la[1] / 60 + la[2] / 3600;
      let lon = lo[0] + lo[1] / 60 + lo[2] / 3600;
      if (texto(g[1]).toUpperCase() === 'S') lat = -lat;
      if (texto(g[3]).toUpperCase() === 'W') lon = -lon;
      if (lat || lon) { res.lat = lat; res.lon = lon; }
      const pe = racionais(g[0x1F]);
      if (pe && pe[0]) res.precisao = pe[0];
    }
  }
  return res;
}
