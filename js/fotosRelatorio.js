// Fotos de um relatório (aba Relatórios): lista com as informações de cada foto, que podem ser editadas.
// Editar exige o código do app da equipe ou o master; o código do portal só consulta.
import { chamar, cacheLer, cacheGravar, local } from './api.js';
import { fmtNum, fmtData, fmtHora, fmtDataHora, esc, fmtLatLon } from './formatos.js';
import { observarMiniaturas, foto } from './fotos.js';
import { lerCoordenada } from './coordenadas.js';
import { BaseEstacas } from './estacas.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const CHAVE_EQUIPE = 'portal-inspecao:codigoEquipe';
const pad = (n) => String(n).padStart(2, '0');
const paraInput = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '');
const fmtDist = (m) => (m < 10 ? fmtNum(m, 1) : fmtNum(Math.round(m), 0));

export function criarFotosRelatorio(ctx) {
  const st = { rel: null, edicoes: new Map(), salvas: new Set(), salvando: false, base: null };

  function dados() { return ctx.dados(); }
  function podeEditarDireto() {
    const d = dados();
    return d && (d.acesso.perfil === 'equipe' || d.acesso.perfil === 'master');
  }
  function precisaCodigo() { return !podeEditarDireto() && !local.ler(CHAVE_EQUIPE); }

  async function chamarEquipe(action, payload, timeout) {
    const cod = podeEditarDireto() ? '' : local.ler(CHAVE_EQUIPE);
    return chamar(action, cod ? { ...payload, codigo: cod } : payload, timeout);
  }

  // -------------------------------------------------------------- abrir
  function abrir(relId) {
    const d = dados();
    const rel = d && d.relPorId.get(relId);
    if (!rel) return;
    st.rel = rel;
    st.edicoes = new Map();
    st.salvas = new Set();
    $('#fr-titulo').textContent = rel.objeto || rel.tipo || rel.id;
    $('#fr-sub').textContent = [d.master ? rel.nomeEquipe : '', rel.tipo, rel.inspetor,
      rel.dInicio ? `${fmtData(rel.dInicio)}${rel.dFim ? ` a ${fmtData(rel.dFim)}` : ''}` : '', rel.id].filter(Boolean).join(' · ');
    $('#fr-codigo-campo').hidden = !precisaCodigo();
    $('#fr-erro').hidden = true;
    render();
    $('#dlg-fotos').hidden = false;
    document.body.classList.add('com-modal');
  }

  function fotosDoRelatorio() {
    const d = dados();
    if (!d || !st.rel) return [];
    return d.registros.filter((r) => r.idRelatorio === st.rel.id).sort((a, b) => (a.d || 0) - (b.d || 0));
  }

  function opcoesCategoria(atual) {
    const d = dados();
    const cats = [...new Set([...(d.listas.categorias || []), atual].filter(Boolean))];
    return `<option value="">Sem categoria</option>${cats.map((c) => `<option${c === atual ? ' selected' : ''}>${esc(c)}</option>`).join('')}`;
  }

  function linhaEstaca(r, e) {
    const x = e || r;
    if (!x.estaca) return '<span class="cinza">Sem estaca</span>';
    const eixo = x.eixo && x.eixo !== 'Linha principal' ? ` (${esc(x.eixo)})` : '';
    const dist = x.distancia != null && x.distancia !== '' ? ` · a ${fmtDist(Number(x.distancia))} m` : '';
    const fora = x.situacao === 'Fora da faixa de domínio';
    return `<span class="${fora ? 'fr-fora' : ''}"><b>EST ${esc(x.estaca)}</b>${eixo}${dist}${fora ? ' · fora da faixa' : ''}</span>`;
  }

  function render() {
    const lista = fotosDoRelatorio();
    const ul = $('#fr-lista');
    if (!lista.length) {
      ul.innerHTML = '<li class="fr-vazio">Nenhuma foto neste relatório.</li>';
      atualizarRodape();
      return;
    }
    ul.innerHTML = lista.map((r, i) => {
      const ed = st.edicoes.get(r.id) || {};
      const v = (k, padrao) => (k in ed ? ed[k] : padrao);
      const coord = 'coordTexto' in ed ? ed.coordTexto : (r.temPos ? `${Number(r.lat).toFixed(6)}, ${Number(r.lon).toFixed(6)}` : '');
      const idMini = r.fotoSem || r.fotoCom;
      const salva = st.salvas.has(r.id) && !st.edicoes.has(r.id);
      return `<li class="fr-item${st.edicoes.has(r.id) ? ' alterada' : ''}${salva ? ' salva' : ''}" data-id="${esc(r.id)}">
        <button type="button" class="fr-thumb" data-ver title="Ver a foto">${idMini ? `<img data-mini="${esc(idMini)}" alt="">` : ''}<span>${i + 1}</span></button>
        <div class="fr-dados">
          <div class="fr-linha1">
            <span class="fr-est" data-est>${linhaEstaca(r, ed.estacaCalc)}</span>
            <span class="fr-status" data-status>${salva ? 'Salva ✓' : ''}</span>
            ${r.temPos ? '<button type="button" class="btn-link fr-mapa" data-mapa>Ver no mapa</button>' : ''}
          </div>
          <div class="fr-grade">
            <label class="largo"><span>Descrição</span><textarea rows="2" data-campo="descricao" placeholder="O que a foto mostra">${esc(v('descricao', r.descricao || ''))}</textarea></label>
            <label><span>Categoria</span><select data-campo="categoria">${opcoesCategoria(v('categoria', r.categoria || ''))}</select></label>
            <label><span>Data e hora</span><input type="datetime-local" step="1" data-campo="data" value="${paraInput('data' in ed ? new Date(ed.data) : r.d)}"></label>
            <label><span>Inspetor</span><input data-campo="inspetor" value="${esc(v('inspetor', r.inspetor || ''))}"></label>
            <label><span>Coordenada <em>lat, lon · GMS · UTM</em></span><input data-campo="coord" value="${esc(coord)}" spellcheck="false" autocomplete="off" placeholder="-14.0603, -49.2363"></label>
          </div>
        </div>
      </li>`;
    }).join('');
    observarMiniaturas(ul);
    atualizarRodape();
  }

  function atualizarRodape() {
    const n = st.edicoes.size;
    $('#fr-resumo').textContent = n ? `${n} ${n === 1 ? 'foto alterada' : 'fotos alteradas'}, não salva${n === 1 ? '' : 's'}` : '';
    $('#fr-salvar').disabled = !n || st.salvando;
    $('#fr-salvar').textContent = st.salvando ? 'Salvando…' : n ? `Salvar alterações (${n})` : 'Salvar alterações';
  }

  // -------------------------------------------------------------- edição
  function registro(id) { return dados().registros.find((r) => r.id === id); }

  async function obterBase() {
    if (st.base) return st.base;
    const versao = dados().versaoEstacas;
    const salvo = await cacheLer('kv', 'estacas');
    if (salvo && salvo.r && (!versao || String(salvo.v) === String(versao))) { st.base = new BaseEstacas(salvo); return st.base; }
    const r = await chamarEquipe('estacas', {}, 180000);
    cacheGravar('kv', 'estacas', r.estacas);
    st.base = new BaseEstacas(r.estacas);
    return st.base;
  }

  async function aoMudar(ev) {
    const campo = ev.target.dataset.campo;
    const li = ev.target.closest('[data-id]');
    if (!campo || !li) return;
    const r = registro(li.dataset.id);
    if (!r) return;
    const ed = st.edicoes.get(r.id) || {};
    const valor = ev.target.value;
    if (campo === 'descricao' || campo === 'categoria' || campo === 'inspetor') {
      if (valor === (r[campo] || '')) delete ed[campo]; else ed[campo] = valor;
    } else if (campo === 'data' && ev.type === 'change') {
      const d = valor ? new Date(valor.length === 16 ? `${valor}:00` : valor) : null;
      if (d && !isNaN(d) && (!r.d || Math.abs(d - r.d) >= 1000)) ed.data = d.getTime(); else delete ed.data;
    } else if (campo === 'coord' && ev.type === 'change') {
      delete ed.lat; delete ed.lon; delete ed.estacaCalc; delete ed.coordInvalida;
      ed.coordTexto = valor;
      const t = valor.trim();
      const atual = r.temPos ? `${Number(r.lat).toFixed(6)}, ${Number(r.lon).toFixed(6)}` : '';
      if (t === atual) {
        delete ed.coordTexto;
      } else if (!t) {
        ed.lat = ''; ed.lon = ''; ed.estacaCalc = { estaca: '', eixo: '', distancia: '', situacao: '' };
      } else {
        const c = lerCoordenada(t);
        if (!c) {
          ed.coordInvalida = true;
        } else {
          ed.lat = Number(c.lat.toFixed(7));
          ed.lon = Number(c.lon.toFixed(7));
          try {
            const base = await obterBase();
            const e = base.maisProxima(c.lat, c.lon);
            const limite = dados().limite || 40;
            ed.estacaCalc = e ? {
              eixo: e.eixo, estaca: e.estaca, estacaM: e.estacaM, distancia: Math.round(e.distancia * 10) / 10,
              situacao: e.distancia > limite ? 'Fora da faixa de domínio' : 'Dentro da faixa',
              pacote: e.pacote, segmento: e.segmento, cidade: e.cidade, infra: e.infra, super: e.super, oae: e.oae,
            } : null;
          } catch (e) {
            ed.estacaCalc = null;
            mostrarErro(e.codigo === 'SOMENTE_EQUIPE' || e.codigo === 'CODIGO_INVALIDO'
              ? 'Para recalcular a estaca é preciso o código do app da equipe. Informe abaixo.'
              : `Não foi possível recalcular a estaca: ${e.message}`);
            if (e.codigo === 'SOMENTE_EQUIPE' || e.codigo === 'CODIGO_INVALIDO') { local.apagar(CHAVE_EQUIPE); $('#fr-codigo-campo').hidden = false; }
          }
        }
      }
      const est = li.querySelector('[data-est]');
      est.innerHTML = ed.coordInvalida ? '<span class="fr-fora">Coordenada não reconhecida</span>' : linhaEstaca(r, ed.estacaCalc);
    }
    const sobra = Object.keys(ed).filter((k) => !['status'].includes(k));
    if (sobra.length) { st.edicoes.set(r.id, ed); li.classList.add('alterada'); } else { st.edicoes.delete(r.id); li.classList.remove('alterada'); }
    atualizarRodape();
  }

  function camposParaEnviar(ed) {
    const c = {};
    ['descricao', 'categoria', 'inspetor', 'data'].forEach((k) => { if (k in ed) c[k] = ed[k]; });
    if ('lat' in ed) {
      c.lat = ed.lat; c.lon = ed.lon; c.precisao = '';
      const e = ed.estacaCalc;
      if (e) Object.assign(c, e);
      else Object.assign(c, { eixo: '', estaca: '', estacaM: '', distancia: '', situacao: '', pacote: '', segmento: '', cidade: '', infra: '', super: '', oae: '' });
    }
    return c;
  }

  function mostrarErro(msg) {
    const e = $('#fr-erro');
    e.textContent = msg;
    e.hidden = !msg;
  }

  async function salvar() {
    if (st.salvando || !st.edicoes.size) return;
    if (!$('#fr-codigo-campo').hidden) {
      const c = $('#fr-codigo').value.trim();
      if (!c) { mostrarErro('Informe o código do app da equipe para salvar.'); $('#fr-codigo').focus(); return; }
      local.gravar(CHAVE_EQUIPE, c);
    }
    const invalidas = [...st.edicoes.values()].filter((e) => e.coordInvalida).length;
    if (invalidas) { mostrarErro('Há coordenada que não foi possível entender. Corrija ou volte ao valor anterior.'); return; }
    mostrarErro('');
    st.salvando = true;
    atualizarRodape();
    let ok = 0;
    let falhas = 0;
    const autor = (local.ler('portal-inspecao:inspetor') || '').trim();
    for (const [id, ed] of [...st.edicoes]) {
      const li = $(`#fr-lista [data-id="${CSS.escape(id)}"]`);
      const status = li && li.querySelector('[data-status]');
      if (status) status.textContent = 'Salvando…';
      try {
        await chamarEquipe('editarRegistro', { id, campos: camposParaEnviar(ed), autor }, 60000);
        st.edicoes.delete(id);
        st.salvas.add(id);
        ok++;
        if (li) { li.classList.remove('alterada'); li.classList.add('salva'); }
        if (status) status.textContent = 'Salva ✓';
      } catch (e) {
        falhas++;
        if (status) status.textContent = 'Falhou';
        if (e.codigo === 'SOMENTE_EQUIPE' || e.codigo === 'CODIGO_INVALIDO') {
          local.apagar(CHAVE_EQUIPE);
          $('#fr-codigo-campo').hidden = false;
          mostrarErro(local.ler(CHAVE_EQUIPE) ? 'Código não reconhecido.' : 'Para editar é preciso o código do app da equipe (o código do portal só consulta). Informe abaixo e salve de novo.');
          break;
        }
        mostrarErro(e.codigo === 'ACAO_DESCONHECIDA' ? 'O script do Google ainda não tem a edição de fotos. Atualize o Código.gs e publique uma nova versão.' : `Não foi possível salvar: ${e.message}`);
      }
    }
    st.salvando = false;
    atualizarRodape();
    if (ok) {
      ctx.avisar(`${ok} ${ok === 1 ? 'foto atualizada' : 'fotos atualizadas'}.`);
      await ctx.atualizar();
      if (!$('#dlg-fotos').hidden && st.rel) { st.rel = dados().relPorId.get(st.rel.id) || st.rel; render(); }
    }
    return falhas === 0;
  }

  function fechar() {
    if (st.salvando) return;
    if (st.edicoes.size && !confirm('Há alterações não salvas. Fechar mesmo assim?')) return;
    $('#dlg-fotos').hidden = true;
    document.body.classList.remove('com-modal');
    fecharPrevia();
    st.edicoes = new Map();
  }

  // -------------------------------------------------------------- ver a foto
  async function verFoto(r) {
    const id = r.fotoCom || r.fotoSem;
    if (!id) return;
    const caixa = $('#fr-previa');
    caixa.hidden = false;
    $('#fr-previa-img').removeAttribute('src');
    $('#fr-previa-txt').textContent = 'Carregando a foto…';
    try {
      const f = await foto(id);
      $('#fr-previa-img').src = f.url;
      $('#fr-previa-txt').textContent = [r.estaca ? `EST ${r.estaca}` : '', r.d ? fmtDataHora(r.d) : '', r.temPos ? fmtLatLon(r.lat, r.lon) : ''].filter(Boolean).join(' · ');
    } catch (e) {
      $('#fr-previa-txt').textContent = `Não foi possível abrir a foto: ${e.message}`;
    }
  }
  function fecharPrevia() { $('#fr-previa').hidden = true; $('#fr-previa-img').removeAttribute('src'); }

  // -------------------------------------------------------------- ligações
  $('#fr-lista').addEventListener('input', aoMudar);
  $('#fr-lista').addEventListener('change', aoMudar);
  $('#fr-lista').addEventListener('click', (ev) => {
    const li = ev.target.closest('[data-id]');
    if (!li) return;
    const r = registro(li.dataset.id);
    if (!r) return;
    if (ev.target.closest('[data-ver]')) verFoto(r);
    else if (ev.target.closest('[data-mapa]')) {
      if (st.edicoes.size && !confirm('Há alterações não salvas. Sair mesmo assim?')) return;
      st.edicoes = new Map();
      $('#dlg-fotos').hidden = true;
      document.body.classList.remove('com-modal');
      ctx.verNoMapa(r.id, st.rel.id);
    }
  });
  $('#fr-salvar').addEventListener('click', salvar);
  $('#fr-fechar').addEventListener('click', fechar);
  $('#fr-cancelar').addEventListener('click', fechar);
  $('#fr-previa').addEventListener('click', fecharPrevia);
  $('#dlg-fotos').addEventListener('click', (ev) => { if (ev.target.id === 'dlg-fotos') fechar(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || $('#dlg-fotos').hidden) return;
    if (!$('#fr-previa').hidden) fecharPrevia(); else fechar();
  });

  return { abrir };
}
