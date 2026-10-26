// Gerador de arquivo ZIP simples (sem compressão), suficiente para o KMZ: fotos JPEG já são comprimidas.
const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABELA[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dataDos(d) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, dia };
}

/** arquivos: [{ nome, dados: Uint8Array | string }] → Blob (application/zip) */
export function criarZip(arquivos, tipo = 'application/zip') {
  const enc = new TextEncoder();
  const partes = [];
  const central = [];
  let pos = 0;
  const { hora, dia } = dataDos(new Date());
  for (const a of arquivos) {
    const nome = enc.encode(a.nome);
    const dados = typeof a.dados === 'string' ? enc.encode(a.dados) : a.dados;
    const crc = crc32(dados);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true);
    loc.setUint16(4, 20, true);
    loc.setUint16(6, 0x0800, true); // nomes em UTF-8
    loc.setUint16(8, 0, true);      // sem compressão
    loc.setUint16(10, hora, true);
    loc.setUint16(12, dia, true);
    loc.setUint32(14, crc, true);
    loc.setUint32(18, dados.length, true);
    loc.setUint32(22, dados.length, true);
    loc.setUint16(26, nome.length, true);
    loc.setUint16(28, 0, true);
    partes.push(loc.buffer, nome, dados);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, hora, true);
    cen.setUint16(14, dia, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, dados.length, true);
    cen.setUint32(24, dados.length, true);
    cen.setUint16(28, nome.length, true);
    cen.setUint32(42, pos, true);
    central.push(cen.buffer, nome);
    pos += 30 + nome.length + dados.length;
  }
  const tamCentral = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true);
  fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamCentral, true);
  fim.setUint32(16, pos, true);
  return new Blob([...partes, ...central, fim.buffer], { type: tipo });
}
