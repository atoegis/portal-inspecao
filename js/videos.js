// Aba Vídeos: carregar vídeos de inspeção (vídeo + legenda .srt do app) e assistir com a legenda e o percurso.
import { chamar, cacheLer, cacheGravar, local } from './api.js';
import { fmtNum, fmtData, fmtHora, fmtDataHora, esc, normalizar, plural, fmtLatLon } from './formatos.js';
import { lerLegenda, resumirLegenda, srtParaVtt } from './legenda.js';

/* global L */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const CHAVE_EQUIPE = 'portal-inspecao:codigoEquipe';
const PARTE = 8 * 1024 * 1024;
const MSG_SEM_SCRIPT = 'O script do Google ainda não tem o arquivo Videos.gs. Siga o passo a passo para adicioná-lo e publicar uma nova versão.';

export function criarVideos(ctx) {
  // ctx: { dados(): estado.dados do portal, avisar(msg, erro) }
  const st = {
    lista: null, carregando: false, compartilhado: true, pasta: '',
    up: null, // envio em andamento
  };

  // -------------------------------------------------------------- dados
  async function carregar(forcar) {
    if (st.carregando) return;
    if (!st.lista) {
      const cache = await cacheLer('kv', 'videos');
      if (cache) usar(cache);
    }
    if (st.lista && !forcar && st.carregadoEm && Date.now() - st.carregadoEm < 60000) return;
    st.carregando = true;
    $('#v-estado').textContent = st.lista ? 'Atualizando…' : 'Carregando vídeos…';
    try {
      const resp = await chamar('videos');
      cacheGravar('kv', 'videos', resp);
      usar(resp);
      st.carregadoEm = Date.now();
      $('#v-estado').textContent = '';
    } catch (e) {
      $('#v-estado').textContent = e.codigo === 'ACAO_DESCONHECIDA' ? MSG_SEM_SCRIPT : e.message;
      if (!st.lista) usar({ campos: [], videos: [] });
    } finally {
      st.carregando = false;
    }
  }

  function usar(resp) {
    const campos = resp.campos || [];
    const rels = ctx.dados() ? ctx.dados().relPorId : new Map();
    st.lista = (resp.videos || []).map((l) => {
      const o = {};
      campos.forEach((c, i) => { o[c] = l[i]; });
      o.d = o.inicio ? new Date(o.inicio) : (o.carregadoEm ? new Date(o.carregadoEm) : null);
      o.rel = o.idRelatorio ? rels.get(o.idRelatorio) || null : null;
      o.trecho = o.estIni ? (o.estIni === o.estFim ? `EST ${o.estIni}` : `EST ${o.estIni} a ${o.estFim}`) : '';
      if (o.trecho && o.eixo && o.eixo !== 'Linha principal') o.trecho += ` (${o.eixo})`;
      const d = ctx.dados();
      o.nomeEquipe = d && d.nomeEquipe ? (d.nomeEquipe.get(o.equipe) || o.equipe || '') : '';
      o.busca = normalizar([o.descricao, o.inspetor, o.trecho, o.categoria, o.nome, o.idRelatorio, o.rel && o.rel.objeto, d && d.master ? o.nomeEquipe : ''].join(' '));
      return o;
    });
    st.compartilhado = resp.compartilhado !== false;
    st.pasta = resp.pasta || '';
    render();
  }

  // -------------------------------------------------------------- lista
  function render() {
    if (!st.lista) return;
    const vids = st.lista;
    const seg = vids.reduce((s, v) => s + (v.duracao || 0), 0);
    const mb = vids.reduce((s, v) => s + (v.tamanhoMB || 0), 0);
    const insp = new Set(vids.map((v) => v.inspetor).filter(Boolean)).size;
    $('#v-numeros').innerHTML = [
      [plural(vids.length, 'vídeo', 'vídeos'), vids.length ? `último em ${fmtData(vids.reduce((m, v) => (v.d && v.d > m ? v.d : m), new Date(0)))}` : 'nenhum carregado ainda'],
      [duracaoLonga(seg), 'de gravação'],
      [mb >= 1024 ? `${fmtNum(mb / 1024, 1)} GB` : `${fmtNum(mb, 0)} MB`, 'no Drive'],
      [plural(insp, 'inspetor', 'inspetores'), st.pasta ? `<a href="${esc(st.pasta)}" target="_blank" rel="noopener">Abrir pasta de vídeos</a>` : ''],
    ].map(([a, b]) => `<div><strong>${a}</strong><span>${b}</span></div>`).join('');

    const relSel = $('#v-rel');
    const atual = relSel.value;
    const relsComVideo = [...new Set(vids.map((v) => v.idRelatorio).filter(Boolean))];
    relSel.innerHTML = `<option value="">Todos os relatórios</option><option value="__sem">Vídeos avulsos</option>${relsComVideo.map((id) => {
      const r = ctx.dados() && ctx.dados().relPorId.get(id);
      return `<option value="${esc(id)}">${esc(r ? [fmtData(r.dInicio), r.tipo, r.objeto].filter(Boolean).join(' – ') : id)}</option>`;
    }).join('')}`;
    if ([...relSel.options].some((o) => o.value === atual)) relSel.value = atual;

    const txt = normalizar($('#v-texto').value);
    const rel = relSel.value;
    const filtrados = vids
      .filter((v) => (!txt || txt.split(/\s+/).every((t) => v.busca.includes(t)))
        && (!rel || (rel === '__sem' ? !v.idRelatorio : v.idRelatorio === rel)))
      .sort((a, b) => (b.d || 0) - (a.d || 0));

    const grade = $('#v-grade');
    const vazio = $('#v-vazio');
    if (!filtrados.length) {
      grade.innerHTML = '';
      vazio.hidden = false;
      vazio.innerHTML = vids.length
        ? '<strong>Nenhum vídeo com esses filtros.</strong>'
        : '<strong>Ainda não há vídeos.</strong><span>Grave no app (modo Vídeo), salve no celular e carregue aqui o vídeo e o arquivo de legenda (.srt).</span>';
      return;
    }
    vazio.hidden = true;
    grade.innerHTML = filtrados.map((v) => `<button class="v-cartao" data-vid="${esc(v.id)}">
      <span class="v-mini">${v.miniatura ? `<img src="${esc(v.miniatura)}" alt="">` : '<i></i>'}<b>${duracaoCurta(v.duracao)}</b></span>
      <span class="v-txt">
        <strong>${esc(v.trecho || 'Sem estaca')}</strong>
        <span>${v.d ? `${fmtData(v.d)} ${fmtHora(v.d)}` : ''}${v.inspetor ? ` · ${esc(v.inspetor)}` : ''}</span>
        <span class="v-desc">${esc(v.descricao) || '<span class="sem">Sem descrição</span>'}</span>
        <span class="v-tags">${ctx.dados() && ctx.dados().master && v.nomeEquipe ? `<em class="tag-equipe">${esc(v.nomeEquipe)}</em>` : ''}${v.rel ? `<em>${esc(v.rel.objeto || v.rel.tipo)}</em>` : ''}${v.categoria ? `<em>${esc(v.categoria)}</em>` : ''}${v.foraSeg ? `<em class="tag-fora">${fmtNum(v.foraSeg)} s fora da faixa</em>` : ''}</span>
      </span>
    </button>`).join('');
  }

  // -------------------------------------------------------------- player
  let mapaPlayer = null;
  let marcadorAgora = null;
  let urlTrilha = null;
  let legAtual = null;
  let pedidoPlayer = 0;

  async function abrir(id) {
    const v = st.lista && st.lista.find((x) => x.id === id);
    if (!v) return;
    const meu = ++pedidoPlayer;
    const dlg = $('#dlg-video');
    dlg.hidden = false;
    document.body.classList.add('com-modal');
    $('#pv-titulo').textContent = v.trecho || 'Vídeo sem estaca';
    $('#pv-sub').textContent = [v.d ? `${fmtData(v.d)} às ${fmtHora(v.d)}` : '', duracaoCurta(v.duracao), v.resolucao, v.tamanhoMB ? `${fmtNum(v.tamanhoMB, 1)} MB` : ''].filter(Boolean).join(' · ');
    $('#pv-desc').innerHTML = v.descricao ? esc(v.descricao) : '<span class="sem">Sem descrição</span>';
    const linhas = [
      ['Inspetor', esc(v.inspetor)],
      ['Relatório', v.rel ? esc([fmtData(v.rel.dInicio), v.rel.tipo, v.rel.objeto].filter(Boolean).join(' – ')) : (v.idRelatorio ? esc(v.idRelatorio) : 'Vídeo avulso')],
      ['Categoria', esc(v.categoria)],
      ['Fora da faixa', v.foraSeg ? `${fmtNum(v.foraSeg)} s do vídeo` : ''],
      ['Início', isFinite(v.latIni) && v.latIni !== null && v.latIni !== '' ? fmtLatLon(v.latIni, v.lonIni) : ''],
      ['Arquivo', esc(v.nome)],
    ].filter(([, x]) => x);
    $('#pv-campos').innerHTML = linhas.map(([k, x]) => `<dt>${k}</dt><dd>${x}</dd>`).join('');
    $('#pv-drive').href = v.arquivo ? `https://drive.google.com/file/d/${v.arquivo}/view` : '#';
    $('#pv-agora').innerHTML = '';
    $('#pv-linha').innerHTML = '<li class="cinza">Carregando a legenda…</li>';
    $('#pv-aviso').hidden = true;
    $('#pv-baixar-leg').hidden = !v.legenda;
    montarVideo(v);
    montarMapa(v);

    legAtual = null;
    if (v.legenda) {
      try {
        const r = await chamar('videoLegenda', { id: v.id });
        if (meu !== pedidoPlayer) return;
        legAtual = { ...lerLegenda(r.texto), bruto: r.texto, nome: (v.nome || 'video').replace(/\.[^.]+$/, '') + '.srt' };
        aplicarLegenda(v);
      } catch (e) {
        $('#pv-linha').innerHTML = `<li class="cinza">${esc(e.message)}</li>`;
      }
    } else {
      $('#pv-linha').innerHTML = '<li class="cinza">Este vídeo foi carregado sem o arquivo de legenda.</li>';
    }
  }

  function urlDireta(id) {
    const base = (window.PORTAL_CONFIG && window.PORTAL_CONFIG.videoDireto) || 'https://drive.usercontent.google.com/download?export=download&confirm=t&id=';
    return `${base}${encodeURIComponent(id)}`;
  }

  function montarVideo(v) {
    const caixa = $('#pv-midia');
    caixa.innerHTML = '';
    if (!v.arquivo) { caixa.innerHTML = '<div class="pv-falha">Arquivo de vídeo não encontrado.</div>'; return; }
    if (!st.compartilhado) {
      usarIframe(v, 'Os vídeos estão como privados (aba Config). Se o vídeo não abrir aqui, use “Abrir no Drive”.');
      return;
    }
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.id = 'pv-video';
    video.src = urlDireta(v.arquivo);
    caixa.appendChild(video);
    let ok = false;
    const desistir = () => { if (!ok && $('#pv-video') === video) usarIframe(v, 'A legenda sincronizada e o ponto no mapa não estão disponíveis neste modo; a linha do tempo mostra as estacas.'); };
    video.addEventListener('loadedmetadata', () => { ok = true; });
    video.addEventListener('error', desistir);
    setTimeout(desistir, 12000);
    video.addEventListener('timeupdate', () => atualizarAgora(video.currentTime));
    video.addEventListener('seeked', () => atualizarAgora(video.currentTime));
  }

  function usarIframe(v, aviso) {
    const caixa = $('#pv-midia');
    caixa.innerHTML = `<iframe src="https://drive.google.com/file/d/${encodeURIComponent(v.arquivo)}/preview" allow="autoplay; fullscreen" allowfullscreen title="Vídeo"></iframe>`;
    caixa.dataset.modo = 'drive';
    const el = $('#pv-aviso');
    el.textContent = aviso;
    el.hidden = false;
  }

  function aplicarLegenda(v) {
    const video = $('#pv-video');
    if (video && legAtual) {
      if (urlTrilha) URL.revokeObjectURL(urlTrilha);
      urlTrilha = URL.createObjectURL(new Blob([srtParaVtt(legAtual.bruto)], { type: 'text/vtt' }));
      const tr = document.createElement('track');
      tr.kind = 'subtitles';
      tr.label = 'Legenda da inspeção';
      tr.srclang = 'pt';
      tr.src = urlTrilha;
      tr.default = true;
      video.appendChild(tr);
      tr.addEventListener('load', () => { try { tr.track.mode = 'showing'; } catch (e) { /* ok */ } });
    }
    // linha do tempo: um item a cada 20 m percorridos, a cada 15 s, ou quando entra/sai da faixa
    const itens = [];
    let ult = null;
    const trs = legAtual.trechos;
    trs.forEach((t, i) => {
      const andou = ult && t.estacaM != null && ult.estacaM != null ? Math.abs(t.estacaM - ult.estacaM) >= 20 : false;
      if (!ult || andou || t.ini - ult.ini >= 15 || t.fora !== ult.fora || (t.estacaM == null) !== (ult.estacaM == null) || i === trs.length - 1) {
        itens.push(t);
        ult = t;
      }
    });
    const podeSaltar = !!$('#pv-video');
    $('#pv-linha').innerHTML = itens.map((t) => `<li><button data-t="${t.ini}" ${podeSaltar ? '' : 'disabled'}>
      <time>${duracaoCurta(t.ini)}</time>
      <b>${t.estaca ? `EST ${esc(t.estaca)}` : 'Sem estaca'}</b>
      <span>${t.dist != null ? `${fmtNum(t.dist, t.dist < 10 ? 1 : 0)} m` : ''}${t.fora ? ' <em class="tag-fora">Fora da faixa</em>' : ''}</span>
    </button></li>`).join('') || '<li class="cinza">A legenda não tem posições.</li>';
    if (!v.trilha || !v.trilha.length) montarMapa({ ...v, trilha: resumirLegenda(legAtual).trilha });
    atualizarAgora(0);
  }

  function trechoEm(seg) {
    if (!legAtual) return null;
    const tr = legAtual.trechos;
    let melhor = null;
    for (const t of tr) {
      if (t.ini <= seg + 0.05) melhor = t; else break;
    }
    return melhor || tr[0] || null;
  }

  function atualizarAgora(seg) {
    const t = trechoEm(seg);
    if (!t) return;
    $('#pv-agora').innerHTML = `<b>${t.estaca ? `EST ${esc(t.estaca)}` : 'Sem estaca'}</b>${t.eixo && t.eixo !== 'Linha principal' ? ` <small>${esc(t.eixo)}</small>` : ''}
      <span>${(t.texto.match(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/) || [''])[0]}${t.dist != null ? ` · a ${fmtNum(t.dist, t.dist < 10 ? 1 : 0)} m do eixo` : ''}</span>
      ${t.fora ? '<span class="tag-fora">Fora da faixa de domínio</span>' : ''}`;
    $$('#pv-linha button').forEach((b) => b.classList.toggle('agora', Number(b.dataset.t) === t.ini));
    if (marcadorAgora && isFinite(t.lat) && isFinite(t.lon)) marcadorAgora.setLatLng([t.lat, t.lon]);
  }

  function montarMapa(v) {
    const el = $('#pv-mapa');
    if (mapaPlayer) { mapaPlayer.remove(); mapaPlayer = null; }
    const pts = (v.trilha || []).map((p) => [p[0] / 1e6, p[1] / 1e6]);
    el.hidden = !pts.length;
    if (!pts.length || typeof L === 'undefined') return;
    mapaPlayer = L.map(el, { zoomControl: true, attributionControl: true, maxZoom: 20 });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 19, maxZoom: 20, attribution: 'Imagens © Esri',
    }).addTo(mapaPlayer);
    mapaPlayer.attributionControl.setPrefix(false);
    L.polyline(pts, { color: '#17191C', weight: 7, opacity: 0.6 }).addTo(mapaPlayer);
    L.polyline(pts, { color: '#B57BFF', weight: 4 }).addTo(mapaPlayer);
    L.circleMarker(pts[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#2BB673', fillOpacity: 1 }).bindTooltip('Início').addTo(mapaPlayer);
    L.circleMarker(pts[pts.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#E5484D', fillOpacity: 1 }).bindTooltip('Fim').addTo(mapaPlayer);
    marcadorAgora = L.circleMarker(pts[0], { radius: 8, color: '#17191C', weight: 3, fillColor: '#B8F34A', fillOpacity: 1 }).addTo(mapaPlayer);
    const b = L.latLngBounds(pts);
    setTimeout(() => {
      if (!mapaPlayer) return;
      mapaPlayer.invalidateSize();
      if (pts.length === 1) mapaPlayer.setView(pts[0], 18); else mapaPlayer.fitBounds(b, { padding: [24, 24], maxZoom: 18 });
    }, 60);
  }

  function fechar() {
    pedidoPlayer++;
    const video = $('#pv-video');
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    $('#pv-midia').innerHTML = '';
    delete $('#pv-midia').dataset.modo;
    if (mapaPlayer) { mapaPlayer.remove(); mapaPlayer = null; }
    if (urlTrilha) { URL.revokeObjectURL(urlTrilha); urlTrilha = null; }
    $('#dlg-video').hidden = true;
    document.body.classList.remove('com-modal');
  }

  // -------------------------------------------------------------- carregar vídeo
  function abrirCarga() {
    if (st.up && st.up.ativo) { $('#dlg-carregar').hidden = false; return; }
    st.up = { video: null, legenda: null, leg: null, resumo: null, info: null, ativo: false };
    $('#up-form').reset();
    $('#up-escolhidos').innerHTML = '';
    $('#up-detalhes').hidden = true;
    $('#up-progresso').hidden = true;
    $('#up-erro').hidden = true;
    $('#up-ok').hidden = true;
    $('#up-codigo-campo').hidden = true;
    $('#up-enviar').disabled = true;
    $('#up-enviar').hidden = false;
    $('#up-cancelar').textContent = 'Cancelar';
    preencherSelects();
    $('#dlg-carregar').hidden = false;
    document.body.classList.add('com-modal');
  }

  function preencherSelects() {
    const d = ctx.dados();
    const cats = d ? (d.listas.categorias || []) : [];
    $('#up-cat').innerHTML = `<option value="">Sem categoria</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}`;
    const master = !!(d && d.master);
    $('#up-equipe-campo').hidden = !master;
    if (master) {
      const atualEq = $('#up-equipe').value;
      const eqs = d.equipes.filter((e) => e.ativa !== false).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      $('#up-equipe').innerHTML = `<option value="">Escolha a equipe</option>${eqs.map((e) => `<option value="${esc(e.id)}">${esc(e.nome)}</option>`).join('')}`;
      if (eqs.length === 1) $('#up-equipe').value = eqs[0].id;
      else if (eqs.some((e) => e.id === atualEq)) $('#up-equipe').value = atualEq;
    }
    const eqSel = master ? $('#up-equipe').value : '';
    const rels = d ? [...d.relatorios].filter((r) => !master || r.equipe === eqSel).sort((a, b) => (b.dInicio || 0) - (a.dInicio || 0)) : [];
    $('#up-rel').innerHTML = `<option value="">Nenhum (vídeo avulso)</option>${rels.map((r) => `<option value="${esc(r.id)}">${esc([fmtData(r.dInicio), r.tipo, r.objeto].filter(Boolean).join(' – '))}</option>`).join('')}`;
  }

  async function escolherArquivos(arquivos) {
    for (const f of arquivos) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (ext === 'srt' || ext === 'vtt') st.up.legenda = f;
      else if (f.type.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v', '3gp', 'mkv'].includes(ext)) st.up.video = f;
    }
    if (st.up.legenda) {
      try {
        st.up.leg = lerLegenda(await st.up.legenda.text());
        st.up.resumo = resumirLegenda(st.up.leg);
      } catch (e) {
        st.up.leg = null;
        st.up.resumo = null;
      }
    }
    if (st.up.video) st.up.info = await lerVideo(st.up.video);
    mostrarEscolhidos();
  }

  function mostrarEscolhidos() {
    const u = st.up;
    const nomeBase = (f) => (f ? f.name.replace(/\.[^.]+$/, '') : '');
    const parDiferente = u.video && u.legenda && nomeBase(u.video) !== nomeBase(u.legenda);
    $('#up-escolhidos').innerHTML = `
      <li class="${u.video ? 'ok' : 'falta'}"><b>Vídeo</b><span>${u.video ? `${esc(u.video.name)} · ${tamanho(u.video.size)}${u.info && u.info.duracao ? ` · ${duracaoCurta(u.info.duracao)}` : ''}` : 'Escolha o arquivo de vídeo'}</span></li>
      <li class="${u.legenda ? (u.leg && u.leg.trechos.length ? 'ok' : 'falta') : 'opcional'}"><b>Legenda</b><span>${u.legenda ? `${esc(u.legenda.name)}${u.leg ? ` · ${plural(u.leg.trechos.length, 'trecho', 'trechos')}` : ' · não foi possível ler'}` : 'Opcional, mas recomendada: o arquivo .srt com o mesmo nome do vídeo'}</span></li>
      ${parDiferente ? '<li class="aviso-par">Os nomes do vídeo e da legenda são diferentes. Confira se são da mesma gravação.</li>' : ''}`;
    const r = u.resumo || {};
    $('#up-detalhes').hidden = !u.video;
    if (!u.video) { $('#up-enviar').disabled = true; return; }
    $('#up-resumo').innerHTML = [
      ['Início', r.inicio ? fmtDataHora(new Date(r.inicio)) : (u.video.lastModified ? `${fmtDataHora(new Date(u.video.lastModified))} (data do arquivo)` : '')],
      ['Trecho', r.estIni ? (r.estIni === r.estFim ? `EST ${r.estIni}` : `EST ${r.estIni} a ${r.estFim}`) + (r.eixo && r.eixo !== 'Linha principal' ? ` (${r.eixo})` : '') : 'Sem estaca (sem legenda)'],
      ['Fora da faixa', r.foraSeg ? `${fmtNum(r.foraSeg)} s` : ''],
      ['Resolução', u.info && u.info.altura ? `${Math.min(u.info.largura, u.info.altura)}p` : ''],
    ].filter(([, x]) => x).map(([k, x]) => `<dt>${k}</dt><dd>${esc(x)}</dd>`).join('');
    if (!$('#up-desc').value && r.descricao) $('#up-desc').value = r.descricao;
    if (!$('#up-insp').value && r.inspetor) $('#up-insp').value = r.inspetor;
    if (r.categoria && [...$('#up-cat').options].some((o) => o.value === r.categoria.split('; ')[0])) $('#up-cat').value = r.categoria.split('; ')[0];
    if (r.idRelatorio) {
      if (![...$('#up-rel').options].some((o) => o.value === r.idRelatorio)) {
        $('#up-rel').insertAdjacentHTML('beforeend', `<option value="${esc(r.idRelatorio)}">${esc(r.idRelatorio)} (ainda não sincronizado)</option>`);
      }
      $('#up-rel').value = r.idRelatorio;
    }
    $('#up-enviar').disabled = false;
  }

  function lerVideo(f) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(f);
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.playsInline = true;
      let feito = false;
      const fim = (info) => { if (feito) return; feito = true; URL.revokeObjectURL(url); resolve(info); };
      setTimeout(() => fim({}), 15000);
      v.onerror = () => fim({});
      v.onloadedmetadata = () => {
        const info = { duracao: isFinite(v.duration) ? v.duration : null, largura: v.videoWidth, altura: v.videoHeight };
        v.currentTime = Math.min(1, (v.duration || 2) / 2);
        v.onseeked = () => {
          try {
            const lado = 320;
            const e = Math.min(1, lado / Math.max(v.videoWidth, v.videoHeight));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(v.videoWidth * e));
            c.height = Math.max(1, Math.round(v.videoHeight * e));
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            info.miniatura = c.toDataURL('image/jpeg', 0.72);
          } catch (err) { /* sem miniatura */ }
          fim(info);
        };
      };
      v.src = url;
    });
  }

  async function chamarEquipe(action, dados, timeout) {
    const cod = local.ler(CHAVE_EQUIPE);
    const d = ctx.dados();
    const eq = d && d.master ? $('#up-equipe').value : '';
    return chamar(action, { ...dados, ...(cod ? { codigo: cod } : {}), ...(eq ? { equipe: eq } : {}) }, timeout);
  }

  function blobBase64(b) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(b);
    });
  }

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  async function enviar() {
    const u = st.up;
    if (!u || !u.video || u.ativo) return;
    if (ctx.dados() && ctx.dados().master && !$('#up-equipe').value) {
      $('#up-erro').textContent = 'Escolha a equipe do vídeo.';
      $('#up-erro').hidden = false;
      $('#up-equipe').focus();
      return;
    }
    const campoCod = $('#up-codigo');
    if (!$('#up-codigo-campo').hidden) {
      const c = campoCod.value.trim();
      if (!c) { campoCod.focus(); return; }
      local.gravar(CHAVE_EQUIPE, c);
    }
    u.ativo = true;
    u.cancelado = false;
    $('#up-erro').hidden = true;
    $('#up-progresso').hidden = false;
    $('#up-enviar').disabled = true;
    $('#up-cancelar').textContent = 'Cancelar envio';
    $$('#up-form input, #up-form select, #up-form textarea').forEach((x) => { x.disabled = true; });
    window.addEventListener('beforeunload', segurarSaida);
    const f = u.video;
    const total = f.size;
    const r = u.resumo || {};
    const info = u.info || {};
    try {
      progresso(0, total, 'Preparando…');
      const tipo = f.type || (f.name.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4');
      let ini = await chamarEquipe('videoIniciar', { nome: f.name, tipo, tamanho: total, inicio: r.inicio || f.lastModified || Date.now() });
      if (ini.duplicado) {
        const quando = ini.duplicado.carregadoEm ? ` em ${fmtDataHora(new Date(ini.duplicado.carregadoEm))}` : '';
        if (!confirm(`Este vídeo já foi carregado${quando}. Carregar de novo assim mesmo?`)) throw new Error('Envio cancelado: o vídeo já estava no portal.');
        ini = await chamarEquipe('videoIniciar', { nome: f.name, tipo, tamanho: total, inicio: r.inicio || f.lastModified || Date.now(), forcar: true });
      }
      const sessao = ini.sessao;
      const parte = ini.parte || PARTE;
      let pos = 0;
      let idArquivo = null;
      const t0 = Date.now();
      while (pos < total && !idArquivo) {
        if (u.cancelado) throw new Error('Envio cancelado.');
        const fim = Math.min(pos + parte, total);
        const dados = await blobBase64(f.slice(pos, fim));
        let resp = null;
        for (let tent = 1; ; tent++) {
          try {
            resp = await chamarEquipe('videoParte', { sessao, inicio: pos, total, dados }, 240000);
            break;
          } catch (e) {
            if (e.codigo === 'SESSAO_EXPIRADA' || e.codigo === 'CODIGO_INVALIDO' || e.codigo === 'SOMENTE_EQUIPE' || tent >= 6 || u.cancelado) throw e;
            progresso(pos, total, `Conexão instável, tentando de novo (${tent}/5)…`);
            await esperar(Math.min(30000, 2000 * 2 ** (tent - 1)));
            try {
              const s2 = await chamarEquipe('videoParte', { sessao, total }, 60000);
              if (s2.concluido) { resp = s2; break; }
              if (s2.recebido !== pos) { resp = s2; break; }
            } catch (e2) { /* tenta de novo a mesma parte */ }
          }
        }
        if (resp.concluido) { idArquivo = resp.id; pos = total; } else pos = resp.recebido != null ? resp.recebido : fim;
        const seg = (Date.now() - t0) / 1000;
        const vel = pos / Math.max(seg, 0.5);
        const falta = vel > 0 ? (total - pos) / vel : 0;
        progresso(pos, total, `${tamanho(pos)} de ${tamanho(total)} · ${tamanho(vel)}/s · faltam ${duracaoLonga(falta)}`);
      }
      progresso(total, total, 'Registrando no portal…');
      const meta = {
        ...r,
        inicio: r.inicio || f.lastModified || null,
        duracao: info.duracao || r.duracao || null,
        inspetor: $('#up-insp').value.trim() || r.inspetor || '',
        idRelatorio: $('#up-rel').value,
        descricao: $('#up-desc').value.trim(),
        categoria: $('#up-cat').value,
        resolucao: info.altura ? `${Math.min(info.largura, info.altura)}p` : '',
      };
      meta.fim = meta.inicio && meta.duracao ? meta.inicio + meta.duracao * 1000 : null;
      const fimResp = await chamarEquipe('videoConcluir', {
        id: idArquivo,
        meta,
        legenda: u.legenda ? await u.legenda.text() : '',
        nomeLegenda: u.legenda ? u.legenda.name : '',
        miniatura: info.miniatura || '',
      }, 120000);
      $('#up-progresso').hidden = true;
      $('#up-ok').hidden = false;
      $('#up-ok').innerHTML = `<strong>Vídeo carregado.</strong><span>${fimResp.compartilhado === false ? 'Ele ficou privado no Drive (a conta não permite compartilhar por link).' : 'Ele já aparece na lista de vídeos.'}</span>`;
      $('#up-enviar').hidden = true;
      $('#up-cancelar').textContent = 'Fechar';
      u.ativo = false;
      st.carregadoEm = 0;
      carregar(true);
    } catch (e) {
      u.ativo = false;
      let msg = e.message;
      if (e.codigo === 'SOMENTE_EQUIPE' || (e.codigo === 'CODIGO_INVALIDO' && local.ler(CHAVE_EQUIPE))) {
        local.apagar(CHAVE_EQUIPE);
        $('#up-codigo-campo').hidden = false;
        msg = e.codigo === 'SOMENTE_EQUIPE'
          ? 'Para carregar vídeos é preciso o código da equipe (o código do portal só consulta). Informe abaixo e toque em Carregar.'
          : 'Código da equipe não reconhecido. Confira e tente de novo.';
      } else if (e.codigo === 'ACAO_DESCONHECIDA') {
        msg = MSG_SEM_SCRIPT;
      } else if (e.codigo === 'SESSAO_EXPIRADA') {
        msg = 'A sessão de envio expirou. Toque em Carregar para começar de novo.';
      }
      $('#up-erro').textContent = msg;
      $('#up-erro').hidden = false;
      $('#up-progresso').hidden = true;
      $('#up-enviar').disabled = false;
      $('#up-cancelar').textContent = 'Fechar';
      $$('#up-form input, #up-form select, #up-form textarea').forEach((x) => { x.disabled = false; });
    } finally {
      window.removeEventListener('beforeunload', segurarSaida);
    }
  }

  function segurarSaida(ev) { ev.preventDefault(); ev.returnValue = ''; }

  function progresso(pos, total, txt) {
    $('#up-barra').style.width = `${total ? Math.round((pos / total) * 100) : 0}%`;
    $('#up-pct').textContent = `${total ? Math.floor((pos / total) * 100) : 0}%`;
    $('#up-txt').textContent = txt;
  }

  function fecharCarga() {
    const u = st.up;
    if (u && u.ativo) {
      if (!confirm('Cancelar o envio do vídeo?')) return;
      u.cancelado = true;
      return;
    }
    $('#dlg-carregar').hidden = true;
    document.body.classList.remove('com-modal');
  }

  // -------------------------------------------------------------- ligações
  $('#v-carregar').addEventListener('click', abrirCarga);
  $('#up-equipe').addEventListener('change', () => {
    const rel = $('#up-rel').value;
    preencherSelects();
    if ([...$('#up-rel').options].some((o) => o.value === rel)) $('#up-rel').value = rel;
  });
  $('#v-texto').addEventListener('input', () => render());
  $('#v-rel').addEventListener('change', () => render());
  $('#v-grade').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-vid]');
    if (b) abrir(b.dataset.vid);
  });
  $('#pv-fechar').addEventListener('click', fechar);
  $('#dlg-video').addEventListener('click', (ev) => { if (ev.target.id === 'dlg-video') fechar(); });
  $('#pv-linha').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-t]');
    const video = $('#pv-video');
    if (b && video) { video.currentTime = Number(b.dataset.t); video.play().catch(() => {}); }
  });
  $('#pv-baixar-leg').addEventListener('click', () => {
    if (!legAtual) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([legAtual.bruto], { type: 'application/x-subrip' }));
    a.download = legAtual.nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!$('#dlg-video').hidden) fechar();
    else if (!$('#dlg-carregar').hidden) fecharCarga();
  });

  const zona = $('#up-zona');
  $('#up-arquivos').addEventListener('change', (ev) => escolherArquivos([...ev.target.files]));
  ['dragenter', 'dragover'].forEach((t) => zona.addEventListener(t, (ev) => { ev.preventDefault(); zona.classList.add('sobre'); }));
  ['dragleave', 'drop'].forEach((t) => zona.addEventListener(t, () => zona.classList.remove('sobre')));
  zona.addEventListener('drop', (ev) => { ev.preventDefault(); escolherArquivos([...ev.dataTransfer.files]); });
  $('#up-form').addEventListener('submit', (ev) => { ev.preventDefault(); enviar(); });
  $('#up-cancelar').addEventListener('click', fecharCarga);
  $('#up-fechar').addEventListener('click', fecharCarga);

  return {
    entrar() { carregar(false); },
    atualizar() { if (st.lista) carregar(true); },
    rerender() { if (st.lista) render(); },
  };
}

// -------------------------------------------------------------- formatos
function duracaoCurta(seg) {
  const s = Math.max(0, Math.round(seg || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
}

function duracaoLonga(seg) {
  const s = Math.round(seg || 0);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

function tamanho(b) {
  const mb = (b || 0) / 1048576;
  if (mb >= 1024) return `${fmtNum(mb / 1024, 1)} GB`;
  if (mb >= 1) return `${fmtNum(mb, mb < 10 ? 1 : 0)} MB`;
  return `${fmtNum((b || 0) / 1024, 0)} KB`;
}
