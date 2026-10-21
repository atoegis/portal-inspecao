// Mapa (Leaflet): traçado da obra, marcação de quilômetros, pontos das fotos agrupados por proximidade.
import { corRegistro } from './cores.js';
import { fmtEstaca, fmtData, fmtHora, esc } from './formatos.js';
import { observarMiniaturas } from './fotos.js';

/* global L */

const ZOOM_SEM_GRUPO = 16;

export function criarMapa(el, { aoSelecionar }) {
  const map = L.map(el, { zoomControl: false, preferCanvas: false, maxZoom: 20, minZoom: 5 })
    .setView([-14.2, -49.6], 8);
  L.control.zoom({ position: 'topleft', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);

  const satelite = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 19, maxZoom: 20, attribution: 'Imagens © Esri, Maxar, Earthstar Geographics',
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 19, maxZoom: 20, opacity: 0.85,
    }),
  ]);
  const ruas = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19, maxZoom: 20, attribution: '© colaboradores do OpenStreetMap',
  });
  const camadasBase = { 'Satélite': satelite, 'Mapa': ruas };
  let baseAtual = 'Satélite';
  try { baseAtual = localStorage.getItem('portal-inspecao:base') || 'Satélite'; } catch (e) { /* sem armazenamento */ }
  (camadasBase[baseAtual] || satelite).addTo(map);
  L.control.layers(camadasBase, null, { position: 'topright' }).addTo(map);
  map.on('baselayerchange', (ev) => {
    el.dataset.base = ev.name;
    try { localStorage.setItem('portal-inspecao:base', ev.name); } catch (e) { /* sem armazenamento */ }
  });
  el.dataset.base = camadasBase[baseAtual] ? baseAtual : 'Satélite';

  const camadaEixo = L.layerGroup().addTo(map);
  const camadaKm = L.layerGroup().addTo(map);
  const camadaPontos = L.layerGroup().addTo(map);

  let eixos = [];
  let registros = [];
  let modoCor = 'categoria';
  let selecionado = null;

  // ------------------------------------------------------------ traçado
  function definirEixos(lista) {
    eixos = lista;
    camadaEixo.clearLayers();
    eixos.forEach((e) => {
      if (e.latlngs.length < 2) return;
      L.polyline(e.latlngs, { color: '#17191C', weight: 7, opacity: 0.7, interactive: false }).addTo(camadaEixo);
      L.polyline(e.latlngs, { color: '#B8F34A', weight: 3, opacity: 1, interactive: false }).addTo(camadaEixo);
      const alvo = L.polyline(e.latlngs, { color: '#000', weight: 18, opacity: 0, className: 'eixo-alvo' }).addTo(camadaEixo);
      alvo.bindTooltip('', { sticky: true, direction: 'top', offset: [0, -6], className: 'dica-eixo' });
      alvo.on('mousemove', (ev) => {
        const i = maisProximo(e, ev.latlng);
        alvo.setTooltipContent(`${esc(e.nome)}: EST ${fmtEstaca(e.ms[i])}`);
      });
    });
    desenharKm();
  }

  function maisProximo(e, ll) {
    let melhor = 0;
    let dmin = Infinity;
    const k = Math.cos((ll.lat * Math.PI) / 180);
    for (let i = 0; i < e.latlngs.length; i++) {
      const dy = e.latlngs[i][0] - ll.lat;
      const dx = (e.latlngs[i][1] - ll.lng) * k;
      const d = dx * dx + dy * dy;
      if (d < dmin) { dmin = d; melhor = i; }
    }
    return melhor;
  }

  // escolhe o intervalo de marcação para os rótulos ficarem a pelo menos ~110 px um do outro
  function passoKm(z) {
    const lat = map.getCenter().lat;
    const mPorPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
    return [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000].find((p) => p / mPorPx >= 110) || 200000;
  }

  function desenharKm() {
    camadaKm.clearLayers();
    if (!eixos.length) return;
    const z = map.getZoom();
    const passo = passoKm(z);
    const visivel = map.getBounds().pad(0.2);
    const maior = eixos.reduce((a, b) => ((b.ate - b.de) > (a.ate - a.de) ? b : a));
    eixos.forEach((e) => {
      if (e !== maior) {
        // eixos secundários: só o nome, no meio
        if (z >= 11 && e.latlngs.length) {
          const meio = e.latlngs[Math.floor(e.latlngs.length / 2)];
          if (visivel.contains(meio)) {
            L.marker(meio, { icon: L.divIcon({ className: 'km-wrap', html: `<span class="km km-nome">${esc(e.nome)}</span>`, iconSize: null }), interactive: false, keyboard: false }).addTo(camadaKm);
          }
        }
        return;
      }
      for (let i = 1; i < e.ms.length; i++) {
        const m0 = e.ms[i - 1];
        const m1 = e.ms[i];
        const k0 = Math.ceil(m0 / passo);
        const k1 = Math.floor(m1 / passo);
        for (let k = k0; k <= k1; k++) {
          const m = k * passo;
          if (m === m0 && i > 1) continue;
          const t = m1 === m0 ? 0 : (m - m0) / (m1 - m0);
          const ll = [e.latlngs[i - 1][0] + t * (e.latlngs[i][0] - e.latlngs[i - 1][0]),
            e.latlngs[i - 1][1] + t * (e.latlngs[i][1] - e.latlngs[i - 1][1])];
          if (!visivel.contains(ll)) continue;
          const txt = passo >= 1000 ? `km ${m / 1000}` : fmtEstaca(m);
          L.marker(ll, { icon: L.divIcon({ className: 'km-wrap', html: `<span class="km">${txt}</span>`, iconSize: null }), interactive: false, keyboard: false }).addTo(camadaKm);
        }
      }
    });
  }

  function enquadrarEixos() {
    const todos = eixos.flatMap((e) => e.latlngs);
    if (todos.length) map.fitBounds(L.latLngBounds(todos), { padding: [30, 30] });
  }

  // ------------------------------------------------------------ pontos
  function definirRegistros(lista, cor, sel) {
    registros = lista.filter((r) => r.temPos);
    modoCor = cor;
    selecionado = sel;
    desenharPontos();
  }

  function desenharPontos() {
    camadaPontos.clearLayers();
    if (!registros.length) return;
    const z = map.getZoom();
    const grade = z >= ZOOM_SEM_GRUPO ? 16 : 54;
    const area = map.getBounds().pad(0.35);
    const grupos = new Map();
    registros.forEach((r) => {
      const ll = L.latLng(r.lat, r.lon);
      if (!area.contains(ll)) return;
      const p = map.project(ll, z);
      const chave = `${Math.floor(p.x / grade)}:${Math.floor(p.y / grade)}`;
      let g = grupos.get(chave);
      if (!g) { g = []; grupos.set(chave, g); }
      g.push(r);
    });
    grupos.forEach((g) => {
      if (g.length === 1) camadaPontos.addLayer(marcador(g[0]));
      else camadaPontos.addLayer(marcadorGrupo(g));
    });
  }

  function marcador(r) {
    const sel = r.id === selecionado;
    const icone = L.divIcon({
      className: 'pin-wrap',
      html: `<span class="pin${r.fora ? ' pin-fora' : ''}${sel ? ' pin-sel' : ''}" style="--c:${corRegistro(r, modoCor)}"></span>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    const m = L.marker([r.lat, r.lon], {
      icon: icone, keyboard: true, riseOnHover: true, zIndexOffset: sel ? 1000 : 0,
      title: `Estaca ${r.estaca || '—'}, ${fmtData(r.d)}`,
    });
    m.bindTooltip(`<b>EST ${esc(r.estaca || '—')}</b> ${esc(r.cat)}<br>${fmtData(r.d)} ${fmtHora(r.d)}${r.fora ? '<br><span class="dica-fora">Fora da faixa</span>' : ''}`,
      { direction: 'top', offset: [0, -10], className: 'dica-pin' });
    m.on('click', () => aoSelecionar(r.id));
    return m;
  }

  function marcadorGrupo(g) {
    const cont = {};
    g.forEach((r) => { const c = corRegistro(r, modoCor); cont[c] = (cont[c] || 0) + 1; });
    let acum = 0;
    const fatias = Object.entries(cont).sort((a, b) => b[1] - a[1]).map(([c, n]) => {
      const de = (acum / g.length) * 100;
      acum += n;
      return `${c} ${de.toFixed(2)}% ${((acum / g.length) * 100).toFixed(2)}%`;
    }).join(', ');
    const temSel = g.some((r) => r.id === selecionado);
    const lado = g.length < 10 ? 34 : g.length < 100 ? 40 : 48;
    const lat = g.reduce((s, r) => s + r.lat, 0) / g.length;
    const lon = g.reduce((s, r) => s + r.lon, 0) / g.length;
    const icone = L.divIcon({
      className: 'agrupado-wrap',
      html: `<span class="agrupado${temSel ? ' agrupado-sel' : ''}" style="--fatias:conic-gradient(${fatias});width:${lado}px;height:${lado}px"><b>${g.length}</b></span>`,
      iconSize: [lado, lado],
      iconAnchor: [lado / 2, lado / 2],
    });
    const m = L.marker([lat, lon], { icon: icone, keyboard: true, title: `${g.length} fotos aqui`, zIndexOffset: temSel ? 900 : 100 });
    m.on('click', () => {
      const b = L.latLngBounds(g.map((r) => [r.lat, r.lon]));
      const p1 = map.project(b.getNorthWest(), 19);
      const p2 = map.project(b.getSouthEast(), 19);
      const espalhado = Math.max(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
      if (map.getZoom() >= 19 || espalhado < 28) abrirListaGrupo(m, g);
      else map.fitBounds(b, { padding: [70, 70], maxZoom: 19 });
    });
    return m;
  }

  function abrirListaGrupo(m, g) {
    const ord = [...g].sort((a, b) => (b.d || 0) - (a.d || 0));
    const html = `<div class="pilha"><div class="pilha-tit">${g.length} fotos no mesmo local</div><ul>${ord.slice(0, 40).map((r) => {
      const idf = r.fotoSem || r.fotoCom;
      return `<li><button data-id="${esc(r.id)}"><span class="mini">${idf ? `<img data-mini="${esc(idf)}" alt="">` : ''}</span><span><b>EST ${esc(r.estaca || '—')}</b> ${esc(r.cat)}<br><small>${fmtData(r.d)} ${fmtHora(r.d)}${r.descricao ? ` – ${esc(r.descricao.slice(0, 60))}` : ''}</small></span></button></li>`;
    }).join('')}</ul>${g.length > 40 ? `<p class="cinza">e mais ${g.length - 40}</p>` : ''}</div>`;
    const pop = L.popup({ maxWidth: 320, minWidth: 260, className: 'popup-pilha', autoPanPadding: [30, 30] })
      .setLatLng(m.getLatLng()).setContent(html).openOn(map);
    const raiz = pop.getElement();
    if (!raiz) return;
    observarMiniaturas(raiz);
    raiz.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-id]');
      if (b) aoSelecionar(b.dataset.id);
    });
  }

  map.on('moveend', () => { desenharPontos(); desenharKm(); });

  // ------------------------------------------------------------ navegação
  function deslocDetalhe() {
    return document.body.classList.contains('com-detalhe') && window.innerWidth > 860 ? 230 : 0;
  }

  function enquadrar() {
    const comPos = registros;
    if (!comPos.length) { enquadrarEixos(); return; }
    const b = L.latLngBounds(comPos.map((r) => [r.lat, r.lon]));
    const d = deslocDetalhe();
    map.fitBounds(b, { paddingTopLeft: [50, 60], paddingBottomRight: [50 + d * 2, 60], maxZoom: 17 });
  }

  function mostrar(r) {
    const z = Math.max(map.getZoom(), ZOOM_SEM_GRUPO + 1);
    const p = map.project([r.lat, r.lon], z).add([deslocDetalhe(), 0]);
    map.setView(map.unproject(p, z), z, { animate: true });
  }

  function aproximar(r, z) {
    const p = map.project([r.lat, r.lon], z).add([deslocDetalhe(), 0]);
    map.setView(map.unproject(p, z), z, { animate: true });
  }

  function marcarSelecionado(id) {
    selecionado = id;
    map.closePopup();
    desenharPontos();
  }

  return {
    leaflet: map,
    definirEixos,
    enquadrarEixos,
    definirRegistros,
    definirCor(c) { modoCor = c; desenharPontos(); },
    enquadrar,
    mostrar,
    aproximar,
    marcarSelecionado,
    redimensionar() { map.invalidateSize(); },
  };
}
