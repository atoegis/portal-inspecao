// Exportação das fotos filtradas: planilha (CSV para Excel) e Google Earth (KML).
import { fmtData, fmtHora, fmtNum, esc } from './formatos.js';
import { corRegistro } from './cores.js';

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
    'Pacote', 'Segmento', 'Cidade', 'Infraestrutura', 'Superestrutura', 'OAE', 'Foto com legenda', 'Foto sem legenda', 'ID registro'];
  const cel = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (v, c) => (v == null ? '' : fmtNum(v, c).replace(/\./g, ''));
  const linhas = regs.map((r) => [
    fmtData(r.d), fmtHora(r.d), r.inspetor, r.idRelatorio, r.tipoRel, r.rel ? r.rel.objeto : '', r.eixo, r.estaca,
    num(r.estacaM, 3), num(r.lat, 7), num(r.lon, 7), num(r.precisao, 0), num(r.distancia, 1), r.situacao, r.cat,
    r.descricao, r.pacote, r.segmento, r.cidade, r.infra, r.super, r.oae, linkFoto(r.fotoCom), linkFoto(r.fotoSem), r.id,
  ].map(cel).join(';'));
  baixar(`﻿${[cab.join(';'), ...linhas].join('\r\n')}`, `${nomeBase}.csv`, 'text/csv;charset=utf-8');
}

/** #RRGGBB -> aabbggrr (formato do KML) */
const corKML = (hex) => `ff${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toLowerCase();

export function exportarKML(regs, nomeBase, modoCor) {
  const estilos = new Map();
  regs.forEach((r) => {
    const c = corRegistro(r, modoCor);
    if (!estilos.has(c)) estilos.set(c, `s${estilos.size}`);
  });
  const xml = (s) => esc(s);
  const pontos = regs.filter((r) => r.temPos).map((r) => {
    const desc = [
      `<b>${fmtData(r.d)} ${fmtHora(r.d)}</b> – ${esc(r.inspetor)}`,
      `Categoria: ${esc(r.cat)}`,
      r.descricao ? esc(r.descricao) : '',
      r.fora ? `<b>Fora da faixa de domínio</b> (${fmtNum(r.distancia, 0)} m)` : '',
      r.idRelatorio ? `Relatório: ${esc(r.idRelatorio)}` : 'Foto individual',
      r.fotoCom ? `<a href="${linkFoto(r.fotoCom)}">Abrir foto com legenda</a>` : '',
      r.fotoSem ? `<a href="${linkFoto(r.fotoSem)}">Abrir foto sem legenda</a>` : '',
    ].filter(Boolean).join('<br>');
    return `<Placemark><name>${xml(`EST ${r.estaca || '—'}`)}</name><styleUrl>#${estilos.get(corRegistro(r, modoCor))}</styleUrl>`
      + `<description><![CDATA[${desc}]]></description>`
      + `<TimeStamp><when>${r.d ? r.d.toISOString() : ''}</when></TimeStamp>`
      + `<Point><coordinates>${r.lon},${r.lat},0</coordinates></Point></Placemark>`;
  });
  const est = [...estilos].map(([c, id]) => `<Style id="${id}"><IconStyle><color>${corKML(c)}</color><scale>0.9</scale>`
    + '<Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle><LabelStyle><scale>0.7</scale></LabelStyle></Style>').join('');
  const doc = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(nomeBase)}</name>${est}
${pontos.join('\n')}
</Document></kml>`;
  baixar(doc, `${nomeBase}.kml`, 'application/vnd.google-earth.kml+xml');
}
