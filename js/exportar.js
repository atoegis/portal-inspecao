// Exportação das fotos filtradas: planilha (CSV para Excel) e Google Earth (KML e KMZ com as fotos).
import { fmtData, fmtHora, fmtNum, esc } from './formatos.js';
import { corRegistro } from './cores.js';
import { criarZip } from './zip.js';

const linkFoto = (id) => (id ? `https://drive.google.com/file/d/${id}/view` : '');

function baixar(conteudo, nome, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function exportarCSV(regs, nomeBase) {
  const cab = ['Data', 'Hora', 'Inspetor', 'Relatório', 'Tipo de relatório', 'Objeto', 'Eixo', 'Estaca', 'Estaca (m)',
    'Latitude', 'Longitude', 'Precisão GPS (m)', 'Distância à estaca (m)', 'Situação faixa', 'Categoria', 'Descrição',
    'Pacote', 'Segmento', 'Cidade', 'Infraestrutura', 'Superestrutura', 'OAE', 'Foto com legenda', 'Foto sem legenda', 'ID registro', 'Equipe'];
  const cel = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (v, c) => (v == null ? '' : fmtNum(v, c).replace(/\./g, ''));
  const linhas = regs.map((r) => [
    fmtData(r.d), fmtHora(r.d), r.inspetor, r.idRelatorio, r.tipoRel, r.rel ? r.rel.objeto : '', r.eixo, r.estaca,
    num(r.estacaM, 3), num(r.lat, 7), num(r.lon, 7), num(r.precisao, 0), num(r.distancia, 1), r.situacao, r.cat,
    r.descricao, r.pacote, r.segmento, r.cidade, r.infra, r.super, r.oae, linkFoto(r.fotoCom), linkFoto(r.fotoSem), r.id, r.nomeEquipe || '',
  ].map(cel).join(';'));
  baixar(`﻿${[cab.join(';'), ...linhas].join('\r\n')}`, `${nomeBase}.csv`, 'text/csv;charset=utf-8');
}

/** #RRGGBB -> aabbggrr (formato do KML) */
const corKML = (hex) => `ff${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toLowerCase();

/** Monta o documento KML. imagens: Map(id do registro -> caminho dentro do KMZ). */
function montarKML(regs, nomeBase, modoCor, { imagens = null, eixos = [] } = {}) {
  const estilos = new Map();
  regs.forEach((r) => {
    const c = corRegistro(r, modoCor);
    if (!estilos.has(c)) estilos.set(c, `s${estilos.size}`);
  });
  const xml = (s) => esc(s);
  const pontos = regs.filter((r) => r.temPos).map((r) => {
    const img = imagens && imagens.get(r.id);
    const desc = [
      img ? `<img src="${img}" width="520"><br>` : '',
      `<b>${fmtData(r.d)} ${fmtHora(r.d)}</b> – ${esc(r.inspetor)}${r.nomeEquipe ? ` (${esc(r.nomeEquipe)})` : ''}`,
      r.estaca ? `Estaca ${esc(r.estaca)}${r.eixo && r.eixo !== 'Linha principal' ? ` (${esc(r.eixo)})` : ''}${r.distancia != null && r.distancia !== '' ? ` · a ${fmtNum(r.distancia, 0)} m` : ''}` : '',
      `Categoria: ${esc(r.cat)}`,
      r.descricao ? esc(r.descricao) : '',
      r.fora ? `<b>Fora da faixa de domínio</b> (${fmtNum(r.distancia, 0)} m)` : '',
      r.idRelatorio ? `Relatório: ${esc(r.rel ? [r.rel.tipo, r.rel.objeto].filter(Boolean).join(' – ') : r.idRelatorio)}` : 'Foto individual',
      r.fotoCom ? `<a href="${linkFoto(r.fotoCom)}">Abrir foto com legenda no Drive</a>` : '',
      r.fotoSem ? `<a href="${linkFoto(r.fotoSem)}">Abrir foto sem legenda no Drive</a>` : '',
    ].filter(Boolean).join('<br>');
    return `<Placemark><name>${xml(`EST ${r.estaca || '—'}`)}</name><styleUrl>#${estilos.get(corRegistro(r, modoCor))}</styleUrl>`
      + `<description><![CDATA[${desc}]]></description>`
      + `<TimeStamp><when>${r.d ? r.d.toISOString() : ''}</when></TimeStamp>`
      + `<Point><coordinates>${r.lon},${r.lat},0</coordinates></Point></Placemark>`;
  });
  const est = [...estilos].map(([c, id]) => `<Style id="${id}"><IconStyle><color>${corKML(c)}</color><scale>0.9</scale>`
    + '<Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle><LabelStyle><scale>0.7</scale></LabelStyle>'
    + '<BalloonStyle><text>$[description]</text></BalloonStyle></Style>').join('');
  const linhas = (eixos || []).filter((e) => e.latlngs && e.latlngs.length > 1).map((e) => `<Placemark><name>${xml(e.nome || e.eixo || 'Eixo')}</name><styleUrl>#eixo</styleUrl>`
    + `<LineString><tessellate>1</tessellate><coordinates>${e.latlngs.map(([la, lo]) => `${lo.toFixed(6)},${la.toFixed(6)},0`).join(' ')}</coordinates></LineString></Placemark>`);
  const pastaEixo = linhas.length
    ? `<Style id="eixo"><LineStyle><color>${corKML('#B8F34A')}</color><width>3</width></LineStyle></Style><Folder><name>Traçado</name>${linhas.join('')}</Folder>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(nomeBase)}</name>${est}${pastaEixo}
<Folder><name>Fotos (${pontos.length})</name>
${pontos.join('\n')}
</Folder></Document></kml>`;
}

export function exportarKML(regs, nomeBase, modoCor) {
  baixar(montarKML(regs, nomeBase, modoCor), `${nomeBase}.kml`, 'application/vnd.google-earth.kml+xml');
}

/**
 * Google Earth com as fotos dentro do arquivo (KMZ).
 * obterFoto(r) -> Promise<Uint8Array|null> (JPEG já reduzido). Devolve { comFoto, semFoto }.
 */
export async function exportarKMZ(regs, nomeBase, modoCor, { eixos, obterFoto, progresso, cancelado, paralelo = 3 }) {
  const comPos = regs.filter((r) => r.temPos);
  const imagens = new Map();
  const arquivos = [];
  let feitas = 0;
  let falhas = 0;
  let i = 0;
  const trabalhador = async () => {
    while (i < comPos.length) {
      if (cancelado()) return;
      const r = comPos[i++];
      try {
        const bytes = await obterFoto(r);
        if (bytes && bytes.length) {
          const caminho = `files/${String(r.id).replace(/[^\w.-]/g, '_')}.jpg`;
          imagens.set(r.id, caminho);
          arquivos.push({ nome: caminho, dados: bytes, ordem: comPos.indexOf(r) });
        } else {
          falhas++;
        }
      } catch (e) {
        falhas++;
      }
      feitas++;
      progresso(`Baixando fotos para o KMZ: ${feitas} de ${comPos.length}`, comPos.length ? feitas / comPos.length : 1);
    }
  };
  progresso(`Baixando fotos para o KMZ: 0 de ${comPos.length}`, 0);
  await Promise.all(Array.from({ length: Math.min(paralelo, comPos.length || 1) }, trabalhador));
  if (cancelado()) return null;
  progresso('Montando o arquivo KMZ…', 1);
  arquivos.sort((a, b) => a.ordem - b.ordem);
  const doc = montarKML(regs, nomeBase, modoCor, { imagens, eixos });
  const zip = criarZip([{ nome: 'doc.kml', dados: doc }, ...arquivos], 'application/vnd.google-earth.kmz');
  baixar(zip, `${nomeBase}.kmz`, 'application/vnd.google-earth.kmz');
  return { comFoto: imagens.size, semFoto: falhas, total: comPos.length, tamanho: zip.size };
}
