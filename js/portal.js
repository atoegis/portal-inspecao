// Portal de Inspeção: mapa das fotos, filtros, régua do trecho, relatórios e exportação.
import { chamar, definirCodigo, cacheLer, cacheGravar, cacheLimpar, local } from './api.js';
import {
  fmtNum, fmtEstaca, lerEstaca, paraData, fmtData, fmtHora, fmtDataHora, diaISO, hojeISO,
  plural, fmtLatLon, fmtUTM, esc, normalizar,
} from './formatos.js';
import { corCategoria, corRegistro, SEM_CATEGORIA, COR_DENTRO, COR_FORA } from './cores.js';
import { observarMiniaturas, foto } from './fotos.js';
import { criarMapa } from './mapa.js';
import { criarRegua } from './regua.js';
import { gerarRelatorioFotografico } from './impressao.js';
import { exportarCSV, exportarKML } from './exportar.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const CHAVE_CODIGO = 'portal-inspecao:codigo';
const CHAVE_COR = 'portal-inspecao:cor';
const SO_INDIVIDUAIS = '__individuais';

const estado = {
  dados: null,          // { registros, relatorios, relPorId, listas, limite, pastaFotos, geradoEm }
  eixos: [],
  filtrados: [],
  selecionado: null,    // id do registro aberto no detalhe
  versao: 'sem',        // 'com' ou 'sem' legenda no detalhe
  corPor: local.ler(CHAVE_COR) || 'categoria',
  ordem: 'data-desc',
  aba: 'mapa',
  limiteLista: 150,
  relOrdem: { campo: 'inicio', desc: true },
};

const filtrosVazios = () => ({
  texto: '', de: '', ate: '', relatorio: '', cats: new Set(), situacao: '',
  tipo: '', inspetor: '', eixo: '', segmento: '', cidade: '', pacote: '',
  estDe: null, estAte: null, elemento: '',
});
let filtros = filtrosVazios();

let mapa = null;
let regua = null;

// ================================================================ início
iniciar();

async function iniciar() {
  ligarEntrada();
  const salvo = local.ler(CHAVE_CODIGO);
  if (!salvo) { mostrarEntrada(); return; }
  definirCodigo(salvo);
  // mostra o que já está no navegador enquanto busca as novidades
  const cache = await cacheLer('kv', 'portal');
  if (cache) {
    abrirPortal(cache, true);
    atualizar(true);
  } else {
    try {
      mostrarCarregando('Carregando fotos e relatórios…', 0.2);
      const dados = await chamar('portal');
      cacheGravar('kv', 'portal', dados);
      abrirPortal(dados, false);
    } catch (e) {
      esconderCarregando();
      if (e.codigo === 'CODIGO_INVALIDO') { local.apagar(CHAVE_CODIGO); mostrarEntrada(e.message); return; }
      mostrarEntrada(e.message);
    }
  }
}

function ligarEntrada() {
  $('#form-entrada').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const cod = $('#campo-codigo').value.trim();
    if (!cod) return;
    const btn = $('#btn-entrar');
    btn.disabled = true;
    btn.textContent = 'Conferindo…';
    $('#erro-entrada').hidden = true;
    definirCodigo(cod);
    try {
      const dados = await chamar('portal');
      local.gravar(CHAVE_CODIGO, cod);
      cacheGravar('kv', 'portal', dados);
      $('#tela-entrada').hidden = true;
      abrirPortal(dados, false);
    } catch (e) {
      mostrarEntrada(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
}

function mostrarEntrada(msg) {
  esconderCarregando();
  $('#tela-portal').hidden = true;
  $('#tela-entrada').hidden = false;
  const erro = $('#erro-entrada');
  erro.hidden = !msg;
  erro.textContent = msg || '';
  setTimeout(() => $('#campo-codigo').focus(), 50);
}

// ================================================================ dados
function prepararDados(resp) {
  const relatorios = (resp.relatorios || []).map((l) => {
    const o = {};
    resp.camposRelatorio.forEach((c, i) => { o[c] = l[i]; });
    o.dInicio = paraData(o.inicio);
    o.dFim = paraData(o.encerramento);
    return o;
  });
  const relPorId = new Map(relatorios.map((r) => [r.id, r]));
  const registros = (resp.registros || []).map((l) => {
    const o = {};
    resp.camposRegistro.forEach((c, i) => { o[c] = l[i]; });
    o.d = paraData(o.data);
    o.dia = diaISO(o.d);
    o.cat = o.categoria || SEM_CATEGORIA;
    o.fora = o.situacao === 'Fora da faixa de domínio';
    o.rel = o.idRelatorio ? relPorId.get(o.idRelatorio) || null : null;
    o.tipoRel = o.rel ? o.rel.tipo : '';
    o.temPos = isFinite(o.lat) && isFinite(o.lon) && o.lat != null && o.lon != null && (o.lat !== 0 || o.lon !== 0);
    o.elementos = normalizar([o.infra, o.super, o.oae].join(' '));
    o.busca = normalizar([o.descricao, o.estaca, o.inspetor, o.categoria, o.infra, o.super, o.oae,
      o.cidade, o.segmento, o.idRelatorio, o.rel && o.rel.objeto].join(' '));
    return o;
  });
  // números de cada relatório calculados pelas fotos
  relatorios.forEach((r) => { r.regs = []; });
  registros.forEach((g) => { if (g.rel) g.rel.regs.push(g); });
  relatorios.forEach((r) => {
    r.nfotos = r.regs.length;
    r.nfora = r.regs.filter((g) => g.fora).length;
    const ms = r.regs.filter((g) => g.estacaM != null);
    if (ms.length) {
      const eixosRel = new Set(ms.map((g) => g.eixo));
      const min = Math.min(...ms.map((g) => g.estacaM));
      const max = Math.max(...ms.map((g) => g.estacaM));
      r.trechoM = min;
      r.trecho = min === max ? fmtEstaca(min) : `${fmtEstaca(min)} a ${fmtEstaca(max)}`;
      if (eixosRel.size === 1) {
        const e = [...eixosRel][0];
        if (e && e !== 'Linha principal') r.trecho += ` (${e})`;
      }
    } else {
      r.trechoM = null;
      r.trecho = '';
    }
  });
  return {
    registros, relatorios, relPorId,
    listas: resp.listas || { tipos: [], categorias: [] },
    limite: resp.limite || 40,
    pastaFotos: resp.pastaFotos || '',
    geradoEm: resp.geradoEm || Date.now(),
    versaoEstacas: resp.versaoEstacas || '',
  };
}

let primeiraAbertura = true;

function abrirPortal(resp, doCache) {
  estado.dados = prepararDados(resp);
  $('#tela-entrada').hidden = true;
  $('#tela-portal').hidden = false;
  esconderCarregando();
  if (primeiraAbertura) {
    primeiraAbertura = false;
    montarInterface();
    lerHash();
    carregarEixos();
  }
  preencherOpcoes();
  aplicarFiltrosNaTela();
  recalcular({ enquadrar: true });
  renderRelatorios();
  mostrarEstadoDados(doCache);
}

async function atualizar(silencioso) {
  const btn = $('#btn-atualizar');
  btn.classList.add('girando');
  try {
    const resp = await chamar('portal');
    const antes = estado.dados ? estado.dados.registros.length : 0;
    cacheGravar('kv', 'portal', resp);
    estado.dados = prepararDados(resp);
    if (estado.dados.versaoEstacas && estado.eixosVersao && estado.dados.versaoEstacas !== estado.eixosVersao) carregarEixos(true);
    preencherOpcoes();
    aplicarFiltrosNaTela();
    recalcular({ enquadrar: false });
    renderRelatorios();
    mostrarEstadoDados(false);
    const novas = estado.dados.registros.length - antes;
    if (!silencioso || novas > 0) avisar(novas > 0 ? `${plural(novas, 'foto nova', 'fotos novas')}.` : 'Nenhuma foto nova.');
  } catch (e) {
    if (e.codigo === 'CODIGO_INVALIDO') {
      local.apagar(CHAVE_CODIGO);
      mostrarEntrada('O código de acesso mudou. Informe o novo código.');
      return;
    }
    mostrarEstadoDados(true, e.message);
    if (!silencioso) avisar(e.message, true);
  } finally {
    btn.classList.remove('girando');
  }
}

function mostrarEstadoDados(doCache, erro) {
  const el = $('#estado-dados');
  const d = new Date(estado.dados.geradoEm);
  el.textContent = erro
    ? `Sem conexão. Mostrando dados de ${fmtDataHora(d)}`
    : doCache ? `Atualizando… dados de ${fmtHora(d)}` : `Atualizado às ${fmtHora(d)}`;
  el.classList.toggle('estado-erro', !!erro);
}

async function carregarEixos(forcar) {
  const versao = estado.dados && estado.dados.versaoEstacas;
  const salvo = await cacheLer('kv', 'eixos');
  if (salvo && !forcar && (!versao || salvo.v === versao)) {
    usarEixos(salvo);
    return;
  }
  try {
    const resp = await chamar('eixo', {}, 120000);
    cacheGravar('kv', 'eixos', { v: resp.v, eixos: resp.eixos });
    usarEixos(resp);
  } catch (e) {
    if (salvo) usarEixos(salvo);
    console.warn('Traçado indisponível:', e.message);
  }
}

function usarEixos(resp) {
  estado.eixos = (resp.eixos || []).map((e) => ({
    ...e,
    latlngs: e.pts.map((p) => [p[0] / 1e6, p[1] / 1e6]),
    ms: e.pts.map((p) => p[2]),
  }));
  estado.eixosVersao = resp.v;
  mapa.definirEixos(estado.eixos);
  preencherSelectReguaEixo();
  regua.definirEixos(estado.eixos);
  atualizarRegua();
  if (!estado.filtrados.length) mapa.enquadrarEixos();
}

// ================================================================ interface
function montarInterface() {
  mapa = criarMapa($('#mapa'), {
    aoSelecionar: (id) => selecionar(id, { centralizar: false }),
  });
  regua = criarRegua($('#regua-svg'), {
    aoSelecionarTrecho: (eixo, de, ate) => {
      filtros.eixo = eixo;
      filtros.estDe = de;
      filtros.estAte = ate;
      aplicarFiltrosNaTela();
      recalcular({ enquadrar: true });
    },
  });

  // abas
  window.addEventListener('hashchange', () => lerHash(true));
  $$('.aba').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    irPara(a.dataset.aba);
  }));

  $('#btn-atualizar').addEventListener('click', () => atualizar(false));
  $('#btn-sair').addEventListener('click', async () => {
    if (!confirm('Sair do portal neste computador? O código será pedido de novo.')) return;
    local.apagar(CHAVE_CODIGO);
    await cacheLimpar();
    location.hash = '';
    location.reload();
  });
  const minutos = (window.PORTAL_CONFIG && window.PORTAL_CONFIG.atualizarMinutos) || 5;
  setInterval(() => { if (document.visibilityState === 'visible') atualizar(true); }, minutos * 60000);

  // filtros
  const aoDigitar = adiar(() => { lerFiltrosDaTela(); recalcular({}); }, 220);
  $('#f-texto').addEventListener('input', aoDigitar);
  ['#f-de', '#f-ate', '#f-relatorio', '#f-tipo', '#f-inspetor', '#f-eixo', '#f-segmento', '#f-cidade', '#f-pacote']
    .forEach((s) => $(s).addEventListener('change', () => {
      lerFiltrosDaTela();
      recalcular({ enquadrar: s === '#f-relatorio' || s === '#f-eixo' || s === '#f-segmento' || s === '#f-cidade' });
    }));
  ['#f-est-de', '#f-est-ate', '#f-elemento'].forEach((s) => $(s).addEventListener('change', () => {
    lerFiltrosDaTela();
    recalcular({ enquadrar: s !== '#f-elemento' });
  }));
  $('#f-elemento').addEventListener('input', aoDigitar);

  $$('#f-periodo-rapido button').forEach((b) => b.addEventListener('click', () => {
    const dias = b.dataset.dias;
    filtros.de = dias === '' ? '' : hojeISO(Number(dias));
    filtros.ate = '';
    aplicarFiltrosNaTela();
    recalcular({});
  }));
  $$('#f-situacao button').forEach((b) => b.addEventListener('click', () => {
    filtros.situacao = b.dataset.v;
    aplicarFiltrosNaTela();
    recalcular({});
  }));
  $('#btn-limpar').addEventListener('click', () => {
    filtros = filtrosVazios();
    aplicarFiltrosNaTela();
    recalcular({ enquadrar: true });
  });

  // cor dos pontos
  $$('#cor-por button').forEach((b) => b.addEventListener('click', () => {
    estado.corPor = b.dataset.v;
    local.gravar(CHAVE_COR, estado.corPor);
    marcarSegmentado('#cor-por', estado.corPor);
    mapa.definirCor(estado.corPor);
    renderLegenda();
  }));
  marcarSegmentado('#cor-por', estado.corPor);
  $('#btn-enquadrar').addEventListener('click', () => mapa.enquadrar());

  // lista
  $('#ordem').addEventListener('change', (ev) => {
    estado.ordem = ev.target.value;
    ordenar();
    renderLista();
  });
  $('#lista').addEventListener('click', (ev) => {
    const mais = ev.target.closest('[data-mais]');
    if (mais) { estado.limiteLista += 300; renderLista(); return; }
    const li = ev.target.closest('[data-id]');
    if (li) selecionar(li.dataset.id, { centralizar: true });
  });
  $('#lista').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const li = ev.target.closest('[data-id]');
    if (li) { ev.preventDefault(); selecionar(li.dataset.id, { centralizar: true }); }
  });

  // exportar
  const menu = $('#menu-exportar');
  const botaoMenu = menu.querySelector('button');
  const itens = menu.querySelector('.menu-itens');
  botaoMenu.addEventListener('click', (ev) => {
    ev.stopPropagation();
    itens.hidden = !itens.hidden;
    botaoMenu.setAttribute('aria-expanded', String(!itens.hidden));
  });
  document.addEventListener('click', () => { itens.hidden = true; botaoMenu.setAttribute('aria-expanded', 'false'); });
  itens.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-exp]');
    if (!b) return;
    exportar(b.dataset.exp, estado.filtrados, descreverFiltros());
  });

  // régua
  $('#regua-eixo').addEventListener('change', (ev) => {
    if (filtros.eixo && filtros.eixo !== ev.target.value) {
      filtros.eixo = '';
      filtros.estDe = null;
      filtros.estAte = null;
      aplicarFiltrosNaTela();
      recalcular({});
    }
    regua.definirEixoAtual(ev.target.value);
    atualizarRegua();
  });
  $('#regua-limpar').addEventListener('click', () => {
    filtros.estDe = null;
    filtros.estAte = null;
    aplicarFiltrosNaTela();
    recalcular({ enquadrar: true });
  });
  window.addEventListener('resize', adiar(() => atualizarRegua(), 120));

  // detalhe
  $('#d-fechar').addEventListener('click', () => selecionar(null));
  $('#d-ant').addEventListener('click', () => vizinho(-1));
  $('#d-prox').addEventListener('click', () => vizinho(1));
  $$('#d-versao button').forEach((b) => b.addEventListener('click', () => {
    estado.versao = b.dataset.v;
    renderDetalhe();
  }));
  $('#d-zoom').addEventListener('click', () => {
    const r = registroPorId(estado.selecionado);
    if (r && r.temPos) mapa.aproximar(r, 18);
  });
  $('#d-baixar').addEventListener('click', baixarFotoAtual);
  document.addEventListener('keydown', (ev) => {
    if (estado.aba !== 'mapa' || !estado.selecionado) return;
    if (ev.target.closest('input, select, textarea')) return;
    if (ev.key === 'Escape') selecionar(null);
    else if (ev.key === 'ArrowLeft') vizinho(-1);
    else if (ev.key === 'ArrowRight') vizinho(1);
  });

  // painel no celular
  $$('.painel-abas-movel button').forEach((b) => b.addEventListener('click', () => {
    $$('.painel-abas-movel button').forEach((x) => x.classList.toggle('ativo', x === b));
    $('#painel').dataset.movel = b.dataset.movel;
    if (b.dataset.movel === 'mapa') setTimeout(() => { mapa.redimensionar(); atualizarRegua(); }, 50);
  }));
  $('#painel').dataset.movel = 'filtros';

  // relatórios
  $('#r-texto').addEventListener('input', adiar(renderRelatorios, 200));
  $('#r-tipo').addEventListener('change', renderRelatorios);
  $('#r-status').addEventListener('change', renderRelatorios);
  $$('#tabela-rel th.ord').forEach((th) => th.addEventListener('click', () => {
    const c = th.dataset.ord;
    estado.relOrdem = { campo: c, desc: estado.relOrdem.campo === c ? !estado.relOrdem.desc : c === 'inicio' };
    renderRelatorios();
  }));
  $('#tabela-rel tbody').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-acao]');
    if (!b) return;
    const rel = estado.dados.relPorId.get(b.closest('tr').dataset.id);
    if (!rel) return;
    if (b.dataset.acao === 'mapa') {
      filtros = filtrosVazios();
      filtros.relatorio = rel.id;
      aplicarFiltrosNaTela();
      irPara('mapa');
      recalcular({ enquadrar: true });
    } else if (b.dataset.acao === 'pdf') {
      exportar('relatorio', rel.regs, null, rel);
    }
  });
}

function irPara(aba) {
  estado.aba = aba;
  $$('.aba').forEach((a) => a.classList.toggle('ativa', a.dataset.aba === aba));
  $$('.aba').forEach((a) => (a.dataset.aba === aba ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#aba-mapa').hidden = aba !== 'mapa';
  $('#aba-relatorios').hidden = aba !== 'relatorios';
  if (aba === 'mapa') setTimeout(() => { mapa.redimensionar(); atualizarRegua(); }, 30);
  escreverHash();
}

// ================================================================ opções dos filtros
function preencherOpcoes() {
  const regs = estado.dados.registros;
  const unicos = (f) => [...new Set(regs.map(f).filter((v) => v !== '' && v != null))]
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true }));

  opcoes('#f-tipo', 'Todos', unicos((r) => r.tipoRel));
  opcoes('#f-inspetor', 'Todos', unicos((r) => r.inspetor));
  opcoes('#f-eixo', 'Todos', unicos((r) => r.eixo));
  opcoes('#f-segmento', 'Todos', unicos((r) => r.segmento));
  opcoes('#f-cidade', 'Todas', unicos((r) => r.cidade));
  opcoes('#f-pacote', 'Todos', unicos((r) => r.pacote));

  // relatórios: mais recentes primeiro
  const rels = [...estado.dados.relatorios].sort((a, b) => (b.dInicio || 0) - (a.dInicio || 0));
  const sel = $('#f-relatorio');
  const temIndividuais = regs.some((r) => !r.idRelatorio);
  sel.innerHTML = `<option value="">Todos</option>${temIndividuais ? `<option value="${SO_INDIVIDUAIS}">Só fotos individuais (sem relatório)</option>` : ''}${
    rels.map((r) => `<option value="${esc(r.id)}">${esc(rotuloRelatorio(r))}</option>`).join('')}`;

  // categorias: as da lista oficial e as que aparecem nos registros
  const cats = [...new Set([...(estado.dados.listas.categorias || []), ...regs.map((r) => r.cat)])];
  const cont = contar(regs, (r) => r.cat);
  $('#f-categorias').innerHTML = cats.filter((c) => cont[c] || (estado.dados.listas.categorias || []).includes(c))
    .map((c) => `<button data-cat="${esc(c)}" style="--c:${corCategoria(c)}"><i></i>${esc(c)} <small>${fmtNum(cont[c] || 0)}</small></button>`)
    .join('');
  $$('#f-categorias button').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.cat;
    if (filtros.cats.has(c)) filtros.cats.delete(c); else filtros.cats.add(c);
    aplicarFiltrosNaTela();
    recalcular({});
  }));

  // relatórios (aba)
  opcoes('#r-tipo', 'Todos os tipos', [...new Set(estado.dados.relatorios.map((r) => r.tipo).filter(Boolean))].sort());
  opcoes('#r-status', 'Abertos e encerrados', [...new Set(estado.dados.relatorios.map((r) => r.status).filter(Boolean))].sort());
}

function opcoes(sel, todos, valores) {
  const el = $(sel);
  const atual = el.value;
  el.innerHTML = `<option value="">${esc(todos)}</option>${valores.map((v) => `<option>${esc(v)}</option>`).join('')}`;
  if (valores.map(String).includes(atual)) el.value = atual;
}

function preencherSelectReguaEixo() {
  const sel = $('#regua-eixo');
  sel.innerHTML = estado.eixos.map((e) => `<option>${esc(e.nome)}</option>`).join('');
  sel.parentElement.classList.toggle('um-eixo', estado.eixos.length <= 1);
}

function rotuloRelatorio(r) {
  const partes = [fmtData(r.dInicio), r.tipo, r.objeto].filter(Boolean);
  return partes.join(' – ') || r.id;
}

// ================================================================ filtros
function lerFiltrosDaTela() {
  filtros.texto = $('#f-texto').value.trim();
  filtros.de = $('#f-de').value;
  filtros.ate = $('#f-ate').value;
  filtros.relatorio = $('#f-relatorio').value;
  filtros.tipo = $('#f-tipo').value;
  filtros.inspetor = $('#f-inspetor').value;
  filtros.eixo = $('#f-eixo').value;
  filtros.segmento = $('#f-segmento').value;
  filtros.cidade = $('#f-cidade').value;
  filtros.pacote = $('#f-pacote').value;
  filtros.estDe = lerEstaca($('#f-est-de').value);
  filtros.estAte = lerEstaca($('#f-est-ate').value);
  filtros.elemento = $('#f-elemento').value.trim();
  aplicarFiltrosNaTela(true);
}

function aplicarFiltrosNaTela(soEstado) {
  if (!soEstado) {
    $('#f-texto').value = filtros.texto;
    $('#f-de').value = filtros.de;
    $('#f-ate').value = filtros.ate;
    garantirOpcao('#f-relatorio', filtros.relatorio);
    $('#f-tipo').value = filtros.tipo;
    $('#f-inspetor').value = filtros.inspetor;
    garantirOpcao('#f-eixo', filtros.eixo);
    $('#f-segmento').value = filtros.segmento;
    $('#f-cidade').value = filtros.cidade;
    $('#f-pacote').value = filtros.pacote;
    $('#f-est-de').value = filtros.estDe != null ? fmtEstaca(filtros.estDe) : '';
    $('#f-est-ate').value = filtros.estAte != null ? fmtEstaca(filtros.estAte) : '';
    $('#f-elemento').value = filtros.elemento;
  }
  $$('#f-categorias button').forEach((b) => b.classList.toggle('ativo', filtros.cats.has(b.dataset.cat)));
  $('#f-categorias').classList.toggle('alguma', filtros.cats.size > 0);
  marcarSegmentado('#f-situacao', filtros.situacao);
  const hoje = hojeISO(0);
  $$('#f-periodo-rapido button').forEach((b) => {
    const d = b.dataset.dias;
    const alvo = d === '' ? '' : hojeISO(Number(d));
    b.classList.toggle('ativo', !filtros.ate && filtros.de === alvo && (d !== '' || !filtros.de) || (d === '0' && filtros.de === hoje && filtros.ate === hoje));
  });
  const mais = ['tipo', 'inspetor', 'eixo', 'segmento', 'cidade', 'pacote', 'elemento'].filter((k) => filtros[k]).length
    + (filtros.estDe != null || filtros.estAte != null ? 1 : 0);
  $('#mais-cont').textContent = mais ? `(${mais})` : '';
  if (mais) $('#mais-filtros').open = true;
  $('#btn-limpar').hidden = !temFiltro();
}

function garantirOpcao(sel, valor) {
  const el = $(sel);
  if (valor && !Array.from(el.options).some((o) => o.value === valor)) {
    el.insertAdjacentHTML('beforeend', `<option value="${esc(valor)}">${esc(valor)}</option>`);
  }
  el.value = valor;
}

function temFiltro() {
  const f = filtros;
  return !!(f.texto || f.de || f.ate || f.relatorio || f.cats.size || f.situacao || f.tipo || f.inspetor || f.eixo
    || f.segmento || f.cidade || f.pacote || f.estDe != null || f.estAte != null || f.elemento);
}

function passa(r, f, ignorarTrecho) {
  if (f.de && (!r.dia || r.dia < f.de)) return false;
  if (f.ate && (!r.dia || r.dia > f.ate)) return false;
  if (f.relatorio === SO_INDIVIDUAIS) { if (r.idRelatorio) return false; } else if (f.relatorio && r.idRelatorio !== f.relatorio) return false;
  if (f.cats.size && !f.cats.has(r.cat)) return false;
  if (f.situacao === 'fora' && !r.fora) return false;
  if (f.situacao === 'dentro' && (r.fora || !r.situacao)) return false;
  if (f.tipo && r.tipoRel !== f.tipo) return false;
  if (f.inspetor && r.inspetor !== f.inspetor) return false;
  if (f.segmento && String(r.segmento) !== f.segmento) return false;
  if (f.cidade && r.cidade !== f.cidade) return false;
  if (f.pacote && String(r.pacote) !== f.pacote) return false;
  if (!ignorarTrecho) {
    if (f.eixo && r.eixo !== f.eixo) return false;
    if (f.estDe != null && (r.estacaM == null || r.estacaM < f.estDe)) return false;
    if (f.estAte != null && (r.estacaM == null || r.estacaM > f.estAte)) return false;
  }
  if (f.elemento && !r.elementos.includes(normalizar(f.elemento))) return false;
  if (f.texto) {
    const termos = normalizar(f.texto).split(/\s+/).filter(Boolean);
    if (!termos.every((t) => r.busca.includes(t))) return false;
  }
  return true;
}

function recalcular({ enquadrar }) {
  if (!estado.dados) return;
  estado.filtrados = estado.dados.registros.filter((r) => passa(r, filtros, false));
  ordenar();
  estado.limiteLista = 150;
  if (estado.selecionado && !estado.filtrados.some((r) => r.id === estado.selecionado)) selecionar(null);
  renderLista();
  mapa.definirRegistros(estado.filtrados, estado.corPor, estado.selecionado);
  if (enquadrar) mapa.enquadrar();
  renderLegenda();
  atualizarRegua();
  escreverHash();
}

function ordenar() {
  const o = estado.ordem;
  const t = (r) => (r.d ? r.d.getTime() : 0);
  if (o === 'data-desc') estado.filtrados.sort((a, b) => t(b) - t(a));
  else if (o === 'data-asc') estado.filtrados.sort((a, b) => t(a) - t(b));
  else {
    const ordemEixo = (e) => { const i = estado.eixos.findIndex((x) => x.nome === e); return i < 0 ? 99 : i; };
    estado.filtrados.sort((a, b) => ordemEixo(a.eixo) - ordemEixo(b.eixo) || (a.estacaM ?? 1e12) - (b.estacaM ?? 1e12) || t(a) - t(b));
  }
}

function descreverFiltros() {
  const f = filtros;
  const p = [];
  if (f.relatorio === SO_INDIVIDUAIS) p.push('fotos individuais');
  else if (f.relatorio) { const r = estado.dados.relPorId.get(f.relatorio); p.push(`relatório ${r ? rotuloRelatorio(r) : f.relatorio}`); }
  if (f.de || f.ate) p.push(`período ${f.de ? fmtData(paraData(`${f.de.split('-').reverse().join('/')}`)) : 'início'} a ${f.ate ? fmtData(paraData(`${f.ate.split('-').reverse().join('/')}`)) : 'hoje'}`);
  if (f.cats.size) p.push(`categoria ${[...f.cats].join(', ')}`);
  if (f.situacao) p.push(f.situacao === 'fora' ? 'fora da faixa de domínio' : 'dentro da faixa de domínio');
  if (f.tipo) p.push(`tipo ${f.tipo}`);
  if (f.inspetor) p.push(`inspetor ${f.inspetor}`);
  if (f.eixo) p.push(`eixo ${f.eixo}`);
  if (f.estDe != null || f.estAte != null) p.push(`estacas ${f.estDe != null ? fmtEstaca(f.estDe) : 'início'} a ${f.estAte != null ? fmtEstaca(f.estAte) : 'fim'}`);
  if (f.segmento) p.push(`segmento ${f.segmento}`);
  if (f.cidade) p.push(f.cidade);
  if (f.pacote) p.push(`pacote ${f.pacote}`);
  if (f.elemento) p.push(`elemento "${f.elemento}"`);
  if (f.texto) p.push(`busca "${f.texto}"`);
  return p.length ? `Filtros: ${p.join('; ')}.` : 'Todas as fotos.';
}

// ================================================================ hash (link compartilhável)
function escreverHash() {
  const q = new URLSearchParams();
  const f = filtros;
  if (f.texto) q.set('q', f.texto);
  if (f.de) q.set('de', f.de);
  if (f.ate) q.set('ate', f.ate);
  if (f.relatorio) q.set('rel', f.relatorio);
  if (f.cats.size) q.set('cat', [...f.cats].join('|'));
  if (f.situacao) q.set('faixa', f.situacao);
  ['tipo', 'inspetor', 'eixo', 'segmento', 'cidade', 'pacote', 'elemento'].forEach((k) => { if (f[k]) q.set(k, f[k]); });
  if (f.estDe != null) q.set('est_de', String(f.estDe));
  if (f.estAte != null) q.set('est_ate', String(f.estAte));
  if (estado.aba === 'mapa' && estado.selecionado) q.set('foto', estado.selecionado);
  const s = `#${estado.aba}${q.toString() ? `?${q}` : ''}`;
  if (location.hash !== s) history.replaceState(null, '', s);
}

function lerHash(deEvento) {
  const h = location.hash.slice(1);
  const [aba, qs] = h.split('?');
  const q = new URLSearchParams(qs || '');
  if (!deEvento || qs) {
    filtros = filtrosVazios();
    filtros.texto = q.get('q') || '';
    filtros.de = q.get('de') || '';
    filtros.ate = q.get('ate') || '';
    filtros.relatorio = q.get('rel') || '';
    filtros.cats = new Set((q.get('cat') || '').split('|').filter(Boolean));
    filtros.situacao = q.get('faixa') || '';
    ['tipo', 'inspetor', 'eixo', 'segmento', 'cidade', 'pacote', 'elemento'].forEach((k) => { filtros[k] = q.get(k) || ''; });
    filtros.estDe = q.has('est_de') ? Number(q.get('est_de')) : null;
    filtros.estAte = q.has('est_ate') ? Number(q.get('est_ate')) : null;
    if (q.get('foto')) estado.selecionadoInicial = q.get('foto');
  }
  irPara(aba === 'relatorios' ? 'relatorios' : 'mapa');
  if (deEvento && estado.dados) {
    aplicarFiltrosNaTela();
    recalcular({ enquadrar: true });
  }
}

// ================================================================ lista
function renderLista() {
  const n = estado.filtrados.length;
  const total = estado.dados.registros.length;
  $('#cont-fotos').textContent = n === total ? plural(n, 'foto', 'fotos') : `${fmtNum(n)} de ${plural(total, 'foto', 'fotos')}`;
  const lista = $('#lista');
  const vazio = $('#lista-vazia');
  lista.hidden = !n;
  if (!n) {
    lista.innerHTML = '';
    vazio.hidden = false;
    vazio.innerHTML = total
      ? '<strong>Nenhuma foto com esses filtros.</strong><span>Tire algum filtro ou use “Limpar filtros”.</span>'
      : '<strong>Ainda não há fotos enviadas.</strong><span>As fotos tiradas pelo app aparecem aqui assim que chegam ao Drive.</span>';
    return;
  }
  vazio.hidden = true;
  const mostrar = estado.filtrados.slice(0, estado.limiteLista);
  lista.innerHTML = mostrar.map((r) => itemLista(r)).join('')
    + (n > mostrar.length ? `<li class="mais-itens"><button class="btn btn-sec" data-mais>Mostrar mais ${fmtNum(Math.min(300, n - mostrar.length))} de ${fmtNum(n - mostrar.length)}</button></li>` : '');
  observarMiniaturas(lista);
  marcarSelecionadoNaLista();
}

function itemLista(r) {
  const idFoto = r.fotoSem || r.fotoCom;
  const eixo = r.eixo && r.eixo !== 'Linha principal' ? `<em>${esc(r.eixo)}</em>` : '';
  return `<li class="item" data-id="${esc(r.id)}" tabindex="0">
    <span class="mini">${idFoto ? `<img data-mini="${esc(idFoto)}" alt="">` : ''}</span>
    <span class="item-txt">
      <span class="item-l1"><b>${r.estaca ? `EST ${esc(r.estaca)}` : 'Sem estaca'}</b>${eixo}<time>${fmtData(r.d)} ${fmtHora(r.d)}</time></span>
      <span class="item-l2"><i style="--c:${corCategoria(r.cat)}"></i>${esc(r.cat)}${r.fora ? '<span class="tag-fora">Fora da faixa</span>' : ''}</span>
      <span class="item-desc">${esc(r.descricao) || '<span class="sem">Sem descrição</span>'}</span>
    </span>
  </li>`;
}

function marcarSelecionadoNaLista() {
  $$('#lista .item').forEach((li) => li.classList.toggle('sel', li.dataset.id === estado.selecionado));
}

function renderLegenda() {
  const el = $('#legenda-mapa');
  if (!estado.filtrados.length) { el.innerHTML = ''; return; }
  let itens;
  if (estado.corPor === 'situacao') {
    const fora = estado.filtrados.filter((r) => r.fora).length;
    itens = [[COR_DENTRO, 'Dentro da faixa', estado.filtrados.length - fora], [COR_FORA, `Fora da faixa (> ${fmtNum(estado.dados.limite)} m)`, fora]];
  } else {
    const c = contar(estado.filtrados, (r) => r.cat);
    itens = Object.keys(c).sort((a, b) => c[b] - c[a]).map((k) => [corCategoria(k), k, c[k]]);
  }
  el.innerHTML = itens.map(([cor, nome, n]) => `<span><i style="--c:${cor}"></i>${esc(nome)} <small>${fmtNum(n)}</small></span>`).join('');
}

// ================================================================ régua
function atualizarRegua() {
  if (!regua || !estado.dados || !estado.eixos.length) return;
  const eixoAtual = filtros.eixo && estado.eixos.some((e) => e.nome === filtros.eixo)
    ? filtros.eixo : ($('#regua-eixo').value || estado.eixos[0].nome);
  $('#regua-eixo').value = eixoAtual;
  regua.definirEixoAtual(eixoAtual);
  const base = estado.dados.registros.filter((r) => r.eixo === eixoAtual && r.estacaM != null && passa(r, filtros, true));
  const sel = filtros.eixo === eixoAtual || (!filtros.eixo && (filtros.estDe != null || filtros.estAte != null))
    ? { de: filtros.estDe, ate: filtros.estAte } : { de: null, ate: null };
  const r = registroPorId(estado.selecionado);
  regua.desenhar(base, sel, r && r.eixo === eixoAtual ? r.estacaM : null);
  const temSel = sel.de != null || sel.ate != null;
  $('#regua-limpar').hidden = !temSel;
  $('#regua-dica').textContent = temSel
    ? `Trecho ${sel.de != null ? fmtEstaca(sel.de) : 'início'} a ${sel.ate != null ? fmtEstaca(sel.ate) : 'fim'}`
    : 'Arraste na régua para filtrar um trecho';
}

// ================================================================ detalhe
function registroPorId(id) {
  if (!id || !estado.dados) return null;
  return estado.dados.registros.find((r) => r.id === id) || null;
}

function selecionar(id, { centralizar } = {}) {
  estado.selecionado = id;
  mapa.marcarSelecionado(id);
  marcarSelecionadoNaLista();
  const det = $('#detalhe');
  if (!id) {
    det.hidden = true;
    document.body.classList.remove('com-detalhe');
    escreverHash();
    atualizarRegua();
    return;
  }
  const r = registroPorId(id);
  if (!r) { selecionar(null); return; }
  estado.versao = r.fotoSem ? estado.versao : 'com';
  if (!r.fotoCom) estado.versao = 'sem';
  det.hidden = false;
  document.body.classList.add('com-detalhe');
  renderDetalhe();
  if (centralizar && r.temPos) mapa.mostrar(r);
  const li = $(`#lista .item[data-id="${CSS.escape(id)}"]`);
  if (li) li.scrollIntoView({ block: 'nearest' });
  escreverHash();
  atualizarRegua();
}

function vizinho(passo) {
  const i = estado.filtrados.findIndex((r) => r.id === estado.selecionado);
  if (i < 0) return;
  const j = i + passo;
  if (j < 0 || j >= estado.filtrados.length) return;
  selecionar(estado.filtrados[j].id, { centralizar: true });
}

function renderDetalhe() {
  const r = registroPorId(estado.selecionado);
  if (!r) return;
  const i = estado.filtrados.findIndex((x) => x.id === r.id);
  $('#d-pos').textContent = i >= 0 ? `${fmtNum(i + 1)} de ${fmtNum(estado.filtrados.length)}` : '';
  $('#d-ant').disabled = i <= 0;
  $('#d-prox').disabled = i < 0 || i >= estado.filtrados.length - 1;
  $('#d-estaca').innerHTML = r.estaca ? `EST ${esc(r.estaca)}` : 'Sem estaca';
  $('#d-sub').textContent = [r.eixo, `${fmtData(r.d)} às ${fmtHora(r.d)}`].filter(Boolean).join(', ');

  const ambas = r.fotoCom && r.fotoSem;
  $('#d-versao').hidden = !ambas;
  marcarSegmentado('#d-versao', estado.versao);
  const idFoto = estado.versao === 'sem' ? (r.fotoSem || r.fotoCom) : (r.fotoCom || r.fotoSem);
  carregarFotoDetalhe(idFoto, r.fotoSem || r.fotoCom);

  const fora = $('#d-fora');
  fora.hidden = !r.fora;
  if (r.fora) fora.textContent = `Fora da faixa de domínio: a ${fmtNum(r.distancia, r.distancia < 10 ? 1 : 0)} m da estaca mais próxima (limite ${fmtNum(estado.dados.limite)} m).`;

  $('#d-desc').innerHTML = r.descricao ? esc(r.descricao) : '<span class="sem">Sem descrição</span>';
  const rel = r.rel;
  const linhas = [
    ['Categoria', `<i class="ponto" style="--c:${corCategoria(r.cat)}"></i>${esc(r.cat)}`],
    ['Inspetor', esc(r.inspetor)],
    ['Relatório', rel ? `<a href="#" data-ver-rel="${esc(rel.id)}">${esc(rotuloRelatorio(rel))}</a>` : (r.idRelatorio ? esc(r.idRelatorio) : 'Foto individual')],
    ['Distância à estaca', r.distancia != null ? `${fmtNum(r.distancia, r.distancia < 10 ? 1 : 0)} m${r.fora ? '' : ' (dentro da faixa)'}` : ''],
    ['Coordenadas', r.temPos ? `${fmtLatLon(r.lat, r.lon)}<br><span class="cinza">${fmtUTM(r.lat, r.lon)}</span>` : ''],
    ['Precisão do GPS', r.precisao != null ? `± ${fmtNum(r.precisao)} m` : ''],
    ['Segmento', esc(r.segmento)],
    ['Cidade', esc(r.cidade)],
    ['Pacote', esc(r.pacote)],
    ['Infraestrutura', esc(r.infra)],
    ['Superestrutura', esc(r.super)],
    ['OAE', esc(r.oae)],
  ].filter(([, v]) => v);
  $('#d-campos').innerHTML = linhas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const a = $('#d-campos [data-ver-rel]');
  if (a) a.addEventListener('click', (ev) => {
    ev.preventDefault();
    filtros = filtrosVazios();
    filtros.relatorio = a.dataset.verRel;
    aplicarFiltrosNaTela();
    recalcular({ enquadrar: true });
  });
  const drive = $('#d-drive');
  drive.href = idFoto ? `https://drive.google.com/file/d/${idFoto}/view` : '#';
  drive.hidden = !idFoto;
  $('#d-baixar').hidden = !idFoto;
  $('#d-zoom').hidden = !r.temPos;
}

let pedidoFoto = 0;
function carregarFotoDetalhe(id, idMini) {
  const img = $('#d-img');
  const fig = $('#d-foto');
  const aviso = $('#d-carregando');
  const meu = ++pedidoFoto;
  fig.classList.remove('foto-erro');
  if (!id) {
    img.removeAttribute('src');
    aviso.hidden = false;
    aviso.textContent = 'Foto não enviada ao Drive.';
    fig.classList.add('foto-erro');
    return;
  }
  aviso.hidden = false;
  aviso.textContent = 'Carregando foto…';
  fig.classList.add('foto-carregando-on');
  // mostra a miniatura enquanto a foto inteira chega
  const miniEl = document.querySelector(`img[data-mini="${CSS.escape(idMini || id)}"][data-ok]`);
  if (miniEl) img.src = miniEl.src; else img.removeAttribute('src');
  foto(id).then((f) => {
    if (meu !== pedidoFoto) return;
    img.src = f.url;
    img.alt = `Foto na estaca ${registroPorId(estado.selecionado)?.estaca || ''}`;
    aviso.hidden = true;
    fig.classList.remove('foto-carregando-on');
  }).catch((e) => {
    if (meu !== pedidoFoto) return;
    aviso.textContent = e.message || 'Não foi possível carregar a foto.';
    fig.classList.remove('foto-carregando-on');
    fig.classList.add('foto-erro');
  });
}

async function baixarFotoAtual() {
  const r = registroPorId(estado.selecionado);
  if (!r) return;
  const id = estado.versao === 'sem' ? (r.fotoSem || r.fotoCom) : (r.fotoCom || r.fotoSem);
  try {
    const f = await foto(id);
    const a = document.createElement('a');
    a.href = f.url;
    a.download = f.nome || `foto_${r.estaca || r.id}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    avisar(e.message, true);
  }
}

// ================================================================ relatórios
function renderRelatorios() {
  const d = estado.dados;
  const regs = d.registros;
  const fora = regs.filter((r) => r.fora).length;
  const abertos = d.relatorios.filter((r) => r.status === 'Aberto').length;
  const ultima = regs.reduce((m, r) => (r.d && (!m || r.d > m) ? r.d : m), null);
  const inspetores = new Set(regs.map((r) => r.inspetor).filter(Boolean)).size;
  $('#numeros').innerHTML = [
    [plural(regs.length, 'foto', 'fotos'), ultima ? `última em ${fmtData(ultima)} às ${fmtHora(ultima)}` : 'nenhuma enviada ainda'],
    [plural(d.relatorios.length, 'relatório', 'relatórios'), abertos ? `${plural(abertos, 'aberto', 'abertos')}` : 'todos encerrados'],
    [plural(fora, 'foto fora da faixa', 'fotos fora da faixa'), `limite de ${fmtNum(d.limite)} m da estaca`],
    [plural(inspetores, 'inspetor', 'inspetores'), d.pastaFotos ? `<a href="${esc(d.pastaFotos)}" target="_blank" rel="noopener">Abrir pasta do Drive</a>` : ''],
  ].map(([a, b]) => `<div><strong>${a}</strong><span>${b}</span></div>`).join('');

  const txt = normalizar($('#r-texto').value);
  const tipo = $('#r-tipo').value;
  const st = $('#r-status').value;
  let lista = d.relatorios.filter((r) => (!tipo || r.tipo === tipo) && (!st || r.status === st)
    && (!txt || normalizar([r.id, r.tipo, r.objeto, r.inspetor, r.observacoes, r.trecho].join(' ')).includes(txt)));
  const { campo, desc } = estado.relOrdem;
  const val = (r) => {
    if (campo === 'inicio') return r.dInicio ? r.dInicio.getTime() : 0;
    if (campo === 'trecho') return r.trechoM ?? 1e12;
    if (campo === 'nfotos' || campo === 'nfora') return r[campo] || 0;
    return normalizar(r[campo]);
  };
  lista.sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR');
    return desc ? -c : c;
  });
  $$('#tabela-rel th.ord').forEach((th) => {
    th.classList.toggle('ord-ativa', th.dataset.ord === campo);
    th.setAttribute('aria-sort', th.dataset.ord === campo ? (desc ? 'descending' : 'ascending') : 'none');
  });
  const tbody = $('#tabela-rel tbody');
  const vazio = $('#rel-vazio');
  if (!lista.length) {
    tbody.innerHTML = '';
    vazio.hidden = false;
    vazio.innerHTML = d.relatorios.length
      ? '<strong>Nenhum relatório com esses filtros.</strong>'
      : '<strong>Ainda não há relatórios.</strong><span>Os relatórios de inspeção abertos no app aparecem aqui.</span>';
    return;
  }
  vazio.hidden = true;
  tbody.innerHTML = lista.map((r) => `<tr data-id="${esc(r.id)}">
    <td class="nowrap">${r.dInicio ? `${fmtData(r.dInicio)}<small>${fmtHora(r.dInicio)}${r.dFim ? ` a ${fmtData(r.dFim) === fmtData(r.dInicio) ? fmtHora(r.dFim) : fmtDataHora(r.dFim)}` : ''}</small>` : ''}</td>
    <td>${esc(r.tipo)}</td>
    <td class="objeto"><b>${esc(r.objeto) || '<span class="sem">Sem objeto</span>'}</b><small>${esc(r.id)}${r.observacoes ? ` – ${esc(r.observacoes)}` : ''}</small></td>
    <td>${esc(r.inspetor)}</td>
    <td class="nowrap">${esc(r.trecho)}</td>
    <td class="num">${fmtNum(r.nfotos)}</td>
    <td class="num">${r.nfora ? `<span class="tag-fora">${fmtNum(r.nfora)}</span>` : '<span class="cinza">0</span>'}</td>
    <td><span class="status status-${normalizar(r.status) || 'nd'}">${esc(r.status || '—')}</span></td>
    <td class="acoes nowrap">
      <button class="btn btn-sec btn-peq" data-acao="mapa" ${r.nfotos ? '' : 'disabled'}>Ver no mapa</button>
      <button class="btn btn-sec btn-peq" data-acao="pdf" ${r.nfotos ? '' : 'disabled'}>Relatório PDF</button>
      ${r.pasta ? `<a class="btn btn-sec btn-peq" href="${esc(r.pasta)}" target="_blank" rel="noopener">Pasta</a>` : ''}
    </td>
  </tr>`).join('');
}

// ================================================================ exportar
async function exportar(tipo, regs, descricao, relatorio) {
  if (!regs.length) { avisar('Não há fotos para exportar com esses filtros.', true); return; }
  const nomeBase = relatorio ? `relatorio_${relatorio.id}` : `fotos_${hojeISO(0)}`;
  if (tipo === 'csv') { exportarCSV(regs, nomeBase); return; }
  if (tipo === 'kml') { exportarKML(regs, nomeBase, estado.corPor); return; }
  if (regs.length > 120 && !confirm(`O relatório terá ${fmtNum(regs.length)} fotos e pode demorar alguns minutos para montar. Continuar?`)) return;
  let cancelado = false;
  mostrarCarregando('Preparando o relatório fotográfico…', 0, () => { cancelado = true; });
  try {
    await gerarRelatorioFotografico({
      registros: [...regs].sort((a, b) => (a.d || 0) - (b.d || 0)),
      relatorio: relatorio || (filtros.relatorio && filtros.relatorio !== SO_INDIVIDUAIS ? estado.dados.relPorId.get(filtros.relatorio) : null),
      descricaoFiltros: descricao,
      limite: estado.dados.limite,
      eixos: estado.eixos,
      progresso: (txt, frac) => mostrarCarregando(txt, frac, () => { cancelado = true; }),
      cancelado: () => cancelado,
    });
  } catch (e) {
    if (!cancelado) avisar(e.message || 'Não foi possível montar o relatório.', true);
  } finally {
    esconderCarregando();
  }
}

// ================================================================ utilidades
function marcarSegmentado(sel, valor) {
  $$(`${sel} button`).forEach((b) => {
    const on = b.dataset.v === valor;
    b.classList.toggle('ativo', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function contar(lista, f) {
  const c = {};
  lista.forEach((x) => { const k = f(x); c[k] = (c[k] || 0) + 1; });
  return c;
}

function adiar(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let avisoTimer;
function avisar(msg, erro) {
  const el = $('#aviso');
  el.textContent = msg;
  el.classList.toggle('aviso-erro', !!erro);
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.hidden = true; }, erro ? 7000 : 3500);
}

function mostrarCarregando(txt, frac, aoCancelar) {
  $('#carregando').hidden = false;
  $('#carregando-texto').textContent = txt;
  $('#carregando-barra').style.width = `${Math.round((frac || 0) * 100)}%`;
  const b = $('#carregando-cancelar');
  b.hidden = !aoCancelar;
  b.onclick = aoCancelar || null;
}
function esconderCarregando() { $('#carregando').hidden = true; }

// abre a foto indicada no link, depois que o mapa estiver pronto
setTimeout(function abrirFotoDoLink() {
  if (!estado.dados) { setTimeout(abrirFotoDoLink, 300); return; }
  if (estado.selecionadoInicial) {
    const id = estado.selecionadoInicial;
    estado.selecionadoInicial = null;
    if (registroPorId(id)) selecionar(id, { centralizar: true });
  }
}, 300);
