// Leitura do arquivo de legenda (.srt ou .vtt) gerado pelo app: tempos, posição, estaca e cabeçalho.

function segundos(t) {
  const m = String(t).trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/);
  if (!m) return null;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

const num = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const numCoord = (s) => Number(String(s).replace(',', '.'));

function lerEstacaTxt(txt) {
  const m = String(txt).match(/^(\d+)\+(\d{3})(?:,(\d+))?$/);
  return m ? Number(m[1]) * 1000 + Number(`${m[2]}.${m[3] || 0}`) : null;
}

/** Devolve { trechos: [{ ini, fim, texto, ts, lat, lon, acc, estaca, estacaM, eixo, dist, fora }], cabecalho } */
export function lerLegenda(texto) {
  const limpo = String(texto || '').replace(/^﻿/, '').replace(/\r/g, '');
  const blocos = limpo.split(/\n{2,}/);
  const trechos = [];
  const cabecalho = {};
  for (const b of blocos) {
    const linhas = b.split('\n').filter((l) => l.trim() !== '');
    const iTempo = linhas.findIndex((l) => l.includes('-->'));
    if (iTempo < 0) continue;
    const [a, z] = linhas[iTempo].split('-->');
    const ini = segundos(a);
    const fim = segundos(z);
    if (ini == null || fim == null) continue;
    const corpo = linhas.slice(iTempo + 1);
    const txt = corpo.join('\n');
    const t = { ini, fim, texto: txt, linhas: corpo };
    const d = txt.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
    if (d) t.ts = new Date(`${d[3]}-${d[2]}-${d[1]}T${d[4]}:${d[5]}:${d[6]}-03:00`).getTime();
    const p = txt.match(/Lat (-?\d+[.,]\d+)\s+Lon (-?\d+[.,]\d+)(?:\s+±(\d+) m)?/);
    if (p) { t.lat = numCoord(p[1]); t.lon = numCoord(p[2]); t.acc = p[3] ? Number(p[3]) : null; }
    const e = txt.match(/(?:EST|Estaca mais próxima) (\d+\+\d{3}(?:,\d+)?)(?: \(([^)]+)\))?(?: ·)? a ([\d.,]+) m/);
    if (e) {
      t.estaca = e[1];
      t.estacaM = lerEstacaTxt(e[1]);
      t.eixo = e[2] || 'Linha principal';
      t.dist = num(e[3]);
    }
    t.fora = /FORA DA FAIXA/i.test(txt);
    for (const l of corpo) {
      const m = l.match(/^(Inspetor|Relatório|Categoria|Descrição): (.+)$/);
      if (m && !cabecalho[m[1]]) cabecalho[m[1]] = m[2].trim();
    }
    trechos.push(t);
  }
  trechos.sort((x, y) => x.ini - y.ini);
  return { trechos, cabecalho };
}

/** Resume a legenda para o registro do vídeo. */
export function resumirLegenda(leg) {
  const tr = leg.trechos;
  const comPos = tr.filter((t) => isFinite(t.lat) && isFinite(t.lon));
  const comEst = tr.filter((t) => t.estacaM != null);
  const r = {
    inicio: (tr.find((t) => t.ts) || {}).ts || null,
    duracao: tr.length ? tr[tr.length - 1].fim : null,
    inspetor: leg.cabecalho['Inspetor'] || '',
    idRelatorio: ((leg.cabecalho['Relatório'] || '').match(/^(REL-[\w-]+)/) || [])[1] || '',
    descricao: leg.cabecalho['Descrição'] || '',
    categoria: leg.cabecalho['Categoria'] || '',
    foraSeg: Math.round(tr.filter((t) => t.fora).reduce((s, t) => s + (t.fim - t.ini), 0)),
    latIni: comPos.length ? comPos[0].lat : '',
    lonIni: comPos.length ? comPos[0].lon : '',
    latFim: comPos.length ? comPos[comPos.length - 1].lat : '',
    lonFim: comPos.length ? comPos[comPos.length - 1].lon : '',
    eixo: '', estIni: '', estFim: '', estIniM: '', estFimM: '',
    trilha: [],
  };
  if (comEst.length) {
    const min = comEst.reduce((a, b) => (b.estacaM < a.estacaM ? b : a));
    const max = comEst.reduce((a, b) => (b.estacaM > a.estacaM ? b : a));
    Object.assign(r, { eixo: min.eixo, estIni: min.estaca, estFim: max.estaca, estIniM: min.estacaM, estFimM: max.estacaM });
  }
  // trilha com no máximo ~500 pontos
  const passo = Math.max(1, Math.ceil(comPos.length / 500));
  for (let i = 0; i < comPos.length; i += passo) {
    const t = comPos[i];
    r.trilha.push([Math.round(t.lat * 1e6), Math.round(t.lon * 1e6), Math.round(t.ini)]);
  }
  const ult = comPos[comPos.length - 1];
  if (ult && r.trilha.length && r.trilha[r.trilha.length - 1][2] !== Math.round(ult.ini)) {
    r.trilha.push([Math.round(ult.lat * 1e6), Math.round(ult.lon * 1e6), Math.round(ult.ini)]);
  }
  return r;
}

/** Converte .srt em WebVTT (formato que o navegador mostra sobre o vídeo). */
export function srtParaVtt(texto) {
  const corpo = String(texto || '').replace(/^﻿/, '').replace(/\r/g, '');
  if (/^WEBVTT/.test(corpo)) return corpo;
  return `WEBVTT\n\n${corpo.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
}
