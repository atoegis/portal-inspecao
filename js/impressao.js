// Relatório fotográfico: monta uma página para imprimir ou salvar em PDF pelo navegador.
import { foto, reduzir } from './fotos.js';
import {
  fmtEstaca, fmtData, fmtHora, fmtDataHora, fmtNum, fmtLatLon, fmtUTM, esc,
} from './formatos.js';
import { corCategoria } from './cores.js';

/* global L */

export async function gerarRelatorioFotografico({ registros, relatorio, descricaoFiltros, limite, eixos, progresso, cancelado }) {
  const raiz = document.getElementById('impressao');
  raiz.innerHTML = '';
  raiz.classList.add('preparando');

  // 1) fotos (sem legenda quando houver; a legenda vai escrita embaixo)
  const imagens = new Array(registros.length).fill(null);
  let feitas = 0;
  let proximo = 0;
  const total = registros.length;
  progresso(`Carregando fotos: 0 de ${fmtNum(total)}`, 0);
  async function trabalhador() {
    while (proximo < total) {
      if (cancelado()) return;
      const i = proximo++;
      const r = registros[i];
      const id = r.fotoSem || r.fotoCom;
      if (id) {
        try {
          const f = await foto(id);
          imagens[i] = await reduzir(f.url, 1600, 0.85);
        } catch (e) {
          imagens[i] = null;
        }
      }
      feitas++;
      progresso(`Carregando fotos: ${fmtNum(feitas)} de ${fmtNum(total)}`, (feitas / total) * 0.9);
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
  if (cancelado()) { limpar(raiz); return; }

  // 2) página
  const datas = registros.map((r) => r.d).filter(Boolean).sort((a, b) => a - b);
  const periodo = datas.length
    ? (fmtData(datas[0]) === fmtData(datas[datas.length - 1]) ? fmtData(datas[0]) : `${fmtData(datas[0])} a ${fmtData(datas[datas.length - 1])}`)
    : '';
  const inspetores = [...new Set(registros.map((r) => r.inspetor).filter(Boolean))].join(', ');
  const comM = registros.filter((r) => r.estacaM != null);
  const trecho = comM.length
    ? `${fmtEstaca(Math.min(...comM.map((r) => r.estacaM)))} a ${fmtEstaca(Math.max(...comM.map((r) => r.estacaM)))}`
    : '';
  const fora = registros.filter((r) => r.fora).length;
  const titulo = relatorio ? (relatorio.objeto || relatorio.tipo || 'Relatório de inspeção') : 'Registro fotográfico';
  const equipes = [...new Set(registros.map((r) => r.nomeEquipe).filter(Boolean))].join(', ');
  const dados = [
    ['Equipe', equipes],
    relatorio && ['Tipo', relatorio.tipo],
    relatorio && ['Relatório', relatorio.id],
    ['Inspetor', inspetores],
    ['Período', periodo],
    ['Trecho', trecho],
    ['Fotos', `${fmtNum(total)}${fora ? ` (${fmtNum(fora)} fora da faixa de domínio)` : ''}`],
    relatorio && relatorio.status && ['Situação', relatorio.status],
    ['Gerado em', fmtDataHora(new Date())],
  ].filter((x) => x && x[1]);

  raiz.innerHTML = `
    <section class="imp-capa">
      <p class="imp-marca">Relatório fotográfico de inspeção</p>
      <h1>${esc(titulo)}</h1>
      <dl class="imp-dados">${dados.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      ${relatorio && relatorio.observacoes ? `<p class="imp-obs"><b>Observações:</b> ${esc(relatorio.observacoes)}</p>` : ''}
      ${descricaoFiltros ? `<p class="imp-filtros">${esc(descricaoFiltros)}</p>` : ''}
      <div class="imp-mapa" id="imp-mapa"></div>
      <p class="imp-mapa-leg">Números no mapa correspondem às fotos. Faixa de domínio considerada: ${fmtNum(limite)} m da estaca mais próxima.</p>
    </section>
    <section class="imp-fotos">
      ${registros.map((r, i) => figura(r, i, imagens[i])).join('')}
    </section>`;

  // 3) mapa de localização
  progresso('Montando o mapa…', 0.93);
  await montarMapa(registros, eixos);
  if (cancelado()) { limpar(raiz); return; }

  // 4) imprimir
  progresso('Abrindo a impressão…', 1);
  const tituloAntes = document.title;
  document.title = `Relatório fotográfico – ${titulo} – ${periodo.replace(/\//g, '-')}`.slice(0, 120);
  raiz.classList.remove('preparando');
  document.body.classList.add('imprimindo');
  await esperar(250);
  const depois = () => {
    window.removeEventListener('afterprint', depois);
    document.title = tituloAntes;
    document.body.classList.remove('imprimindo');
    limpar(raiz);
  };
  window.addEventListener('afterprint', depois);
  window.print();
  // alguns navegadores não disparam afterprint
  setTimeout(() => { if (document.body.classList.contains('imprimindo')) depois(); }, 120000);
}

function figura(r, i, img) {
  const linhas = [
    `${fmtData(r.d)} às ${fmtHora(r.d)}${r.inspetor ? `, ${esc(r.inspetor)}` : ''}`,
    `<i class="ponto" style="--c:${corCategoria(r.cat)}"></i>${esc(r.cat)}${r.eixo && r.eixo !== 'Linha principal' ? `, ${esc(r.eixo)}` : ''}`,
    r.descricao ? `<span class="imp-desc">${esc(r.descricao)}</span>` : '',
    r.temPos ? `${fmtLatLon(r.lat, r.lon)} (${fmtUTM(r.lat, r.lon)})` : '',
    r.fora ? `<span class="imp-fora">Fora da faixa de domínio: ${fmtNum(r.distancia, 0)} m da estaca mais próxima</span>` : '',
    [r.infra, r.super, r.oae].filter(Boolean).map(esc).join('; '),
  ].filter(Boolean);
  return `<figure class="imp-foto">
    <div class="imp-img">${img ? `<img src="${img}" alt="">` : '<span>Foto indisponível</span>'}</div>
    <figcaption><b><span class="imp-n">${i + 1}</span> EST ${esc(r.estaca || '—')}</b>${linhas.map((l) => `<span>${l}</span>`).join('')}</figcaption>
  </figure>`;
}

let mapaImp = null;
function montarMapa(registros, eixos) {
  return new Promise((resolve) => {
    const el = document.getElementById('imp-mapa');
    const comPos = registros.map((r, i) => ({ r, i })).filter(({ r }) => r.temPos);
    if (!el || !comPos.length || !window.L) { if (el) el.remove(); resolve(); return; }
    mapaImp = L.map(el, { zoomControl: false, attributionControl: true, fadeAnimation: false, zoomAnimation: false, inertia: false });
    mapaImp.attributionControl.setPrefix(false);
    const base = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 19, maxZoom: 19, attribution: 'Imagens © Esri, Maxar, Earthstar Geographics',
    }).addTo(mapaImp);
    eixos.forEach((e) => {
      if (e.latlngs.length < 2) return;
      L.polyline(e.latlngs, { color: '#17191C', weight: 6, opacity: 0.7 }).addTo(mapaImp);
      L.polyline(e.latlngs, { color: '#B8F34A', weight: 2.5 }).addTo(mapaImp);
    });
    comPos.forEach(({ r, i }) => {
      L.marker([r.lat, r.lon], {
        icon: L.divIcon({ className: 'imp-pin-wrap', html: `<span class="imp-pin${r.fora ? ' imp-pin-fora' : ''}">${i + 1}</span>`, iconSize: [20, 20], iconAnchor: [10, 10] }),
      }).addTo(mapaImp);
    });
    const b = L.latLngBounds(comPos.map(({ r }) => [r.lat, r.lon]));
    mapaImp.fitBounds(b, { padding: [28, 28], maxZoom: 17 });
    let pronto = false;
    const fim = () => { if (!pronto) { pronto = true; resolve(); } };
    base.on('load', () => setTimeout(fim, 200));
    setTimeout(fim, 9000);
  });
}

function limpar(raiz) {
  if (mapaImp) { mapaImp.remove(); mapaImp = null; }
  raiz.innerHTML = '';
  raiz.classList.remove('preparando');
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
