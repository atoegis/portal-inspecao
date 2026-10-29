// Importação de fotos em lote (fotos tiradas antes, de qualquer câmera ou celular).
// Segue a ordem do app: fotos → individuais ou relatório → dados → revisão foto a foto → envio.
// A coordenada vem do GPS gravado no arquivo (EXIF); sem ele, do texto escrito na foto (OCR).
import { chamar, cacheLer, cacheGravar, local } from './api.js';
import { fmtNum, fmtData, esc } from './formatos.js';
import { lerExif } from './exif.js';
import { lerCoordenada, lerDataHora, lerEstacaTexto } from './coordenadas.js';
import { lerTextoDaFoto, analiseDetalhada } from './ocr.js';
import { BaseEstacas } from './estacas.js';
import { renderizar, canvasParaBlob, carregarFonteCarimbo } from './carimbo.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const CHAVE_EQUIPE = 'portal-inspecao:codigoEquipe';
const CHAVE_INSPETOR = 'portal-inspecao:inspetor';
const CHAVE_OPCOES = 'portal-inspecao:importarOpcoes';
const LIMA = '#B8F34A';
const LARANJA = '#FF8A3D';
const TIPOS_PADRAO = ['Inspeção de rotina', 'Não conformidade', 'Medição / avanço', 'Segurança', 'Outro'];
const MAX_ORIGINAL = 6 * 1024 * 1024; // acima disso a foto original é recomprimida antes do envio
const ACEITOS = /\.(jpe?g|png|webp|heic|heif)$/i;

const pad = (n) => String(n).padStart(2, '0');
const fmtDataApp = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const carimboId = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const aleatorio = () => Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, 'X');
const paraInputData = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '');
const fmtDist = (m) => (m < 10 ? fmtNum(m, 1) : fmtNum(Math.round(m), 0));
const tamanho = (b) => (b >= 1048576 ? `${fmtNum(b / 1048576, 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function distM(a, b, c, d) {
  const k = Math.PI / 180;
  const x = (d - b) * k * Math.cos(((a + c) / 2) * k);
  const y = (c - a) * k;
  return Math.sqrt(x * x + y * y) * 6371008.8;
}

function blobBase64(b) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/** Abre a imagem já na orientação certa. Devolve { fonte, w, h, fechar }. */
async function abrirImagem(arquivo) {
  try {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    return { fonte: bmp, w: bmp.width, h: bmp.height, fechar: () => bmp.close() };
  } catch (e) {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (e2) {
      URL.revokeObjectURL(url);
      throw new Error('Formato de imagem não suportado pelo navegador.');
    }
    return { fonte: img, w: img.naturalWidth, h: img.naturalHeight, fechar: () => URL.revokeObjectURL(url) };
  }
}

function miniaturaDe(im, lado = 320) {
  const k = Math.min(1, lado / Math.max(im.w, im.h));
  const c = document.createElement('canvas');
  c.width = Math.round(im.w * k);
  c.height = Math.round(im.h * k);
  c.getContext('2d').drawImage(im.fonte, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}

export function criarImportacao(ctx) {
  const st = {
    passo: 1,
    arquivos: [],      // File[]
    itens: [],         // fotos lidas
    base: null,
    ativo: false,      // lendo ou enviando
    cancelar: false,
    relEnviado: false,
    relNovo: null,
    enviado: false,
  };
  let opcoes = { legenda: true, ocr: true };
  try { opcoes = { ...opcoes, ...(JSON.parse(local.ler(CHAVE_OPCOES) || '{}')) }; } catch (e) { /* padrão */ }

  // -------------------------------------------------------------- abrir / fechar
  function abrir() {
    if (st.ativo || (st.passo > 1 && !st.enviado && st.arquivos.length)) { mostrarModal(); return; }
    Object.assign(st, { passo: 1, arquivos: [], itens: [], ativo: false, cancelar: false, relEnviado: false, relNovo: null, enviado: false });
    $('#im-arquivos').value = '';
    $('#im-insp').value = local.ler(CHAVE_INSPETOR) || '';
    $('#im-objeto').value = '';
    $('#im-desc-geral').value = '';
    $('#im-legenda').checked = !!opcoes.legenda;
    $('#im-ocr').checked = !!opcoes.ocr;
    $$('input[name="im-modo"]').forEach((r) => { r.checked = false; });
    $('#im-codigo-campo').hidden = true;
    preencherSelects();
    mostrarEscolhidos();
    irPasso(1);
    mostrarModal();
  }

  function mostrarModal() {
    $('#dlg-importar').hidden = false;
    document.body.classList.add('com-modal');
  }

  function fechar() {
    if (st.ativo) {
      if (!confirm(st.passo === 4 ? 'Parar o envio? As fotos já enviadas ficam no portal.' : 'Parar a leitura das fotos?')) return;
      st.cancelar = true;
      return;
    }
    if (st.passo === 3 && st.itens.length && !confirm('Fechar sem enviar? As fotos lidas serão descartadas.')) return;
    $('#dlg-importar').hidden = true;
    document.body.classList.remove('com-modal');
    fecharPrevia();
    if (st.passo === 3 || st.enviado) {
      st.itens = [];
      st.arquivos = [];
      st.passo = 1;
    }
  }

  function preencherSelects() {
    const d = ctx.dados();
    const tipos = (d && d.listas.tipos && d.listas.tipos.length) ? d.listas.tipos : TIPOS_PADRAO;
    $('#im-tipo').innerHTML = tipos.map((t) => `<option>${esc(t)}</option>`).join('');
    const master = !!(d && d.master);
    $('#im-equipe-campo').hidden = !master;
    if (master) {
      const atual = $('#im-equipe').value;
      const eqs = d.equipes.filter((e) => e.ativa !== false).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      $('#im-equipe').innerHTML = `<option value="">Escolha a equipe</option>${eqs.map((e) => `<option value="${esc(e.id)}">${esc(e.nome)}</option>`).join('')}`;
      if (eqs.length === 1) $('#im-equipe').value = eqs[0].id;
      else if (eqs.some((e) => e.id === atual)) $('#im-equipe').value = atual;
    }
    preencherRelatorios();
    const cats = (d && d.listas.categorias) || [];
    $('#im-cat-geral').innerHTML = `<option value="">Sem categoria</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}`;
  }

  /** Relatórios para "Relatório já existente" (com o master, só os da equipe escolhida). */
  function preencherRelatorios() {
    const d = ctx.dados();
    const eq = d && d.master ? $('#im-equipe').value : '';
    const rels = d ? [...d.relatorios].filter((r) => !d.master || (eq && r.equipe === eq)).sort((a, b) => (b.dInicio || 0) - (a.dInicio || 0)) : [];
    $('#im-rel').innerHTML = rels.length
      ? rels.map((r) => `<option value="${esc(r.id)}">${esc([fmtData(r.dInicio), r.tipo, r.objeto, r.inspetor].filter(Boolean).join(' – '))}</option>`).join('')
      : `<option value="">${d && d.master && !eq ? 'Escolha a equipe primeiro' : 'Nenhum relatório desta equipe'}</option>`;
    $('#im-modo-existente').disabled = !rels.length;
    if (!rels.length && modoEscolhido() === 'existente') {
      $$('input[name="im-modo"]').forEach((r) => { r.checked = false; });
      mostrarCamposModo();
    }
  }

  function equipeEnvio() {
    const d = ctx.dados();
    return d && d.master ? $('#im-equipe').value : '';
  }

  // -------------------------------------------------------------- passos
  function irPasso(n) {
    st.passo = n;
    $$('#dlg-importar [data-passo]').forEach((s) => { s.hidden = Number(s.dataset.passo) !== n; });
    $$('#im-passos li').forEach((li) => {
      const p = Number(li.dataset.p);
      li.classList.toggle('feito', p < n);
      li.classList.toggle('atual', p === n);
    });
    $('#im-erro').hidden = true;
    atualizarRodape();
    $('#dlg-importar .im-corpo').scrollTop = 0;
  }

  function atualizarRodape() {
    const voltar = $('#im-voltar');
    const avancar = $('#im-avancar');
    voltar.hidden = st.passo === 1 || st.passo === 4 || st.ativo;
    avancar.hidden = false;
    avancar.disabled = st.ativo;
    let resumo = '';
    if (st.passo === 1) {
      avancar.textContent = 'Continuar';
      avancar.disabled = !st.arquivos.length;
      resumo = st.arquivos.length ? `${st.arquivos.length} ${st.arquivos.length === 1 ? 'foto' : 'fotos'} · ${tamanho(st.arquivos.reduce((s, f) => s + f.size, 0))}` : '';
    } else if (st.passo === 2) {
      avancar.textContent = st.ativo ? 'Lendo fotos…' : 'Ler fotos';
    } else if (st.passo === 3) {
      const inc = st.itens.filter((i) => i.incluir && !i.falhaLeitura);
      const semPos = inc.filter((i) => !i.pos).length;
      avancar.textContent = `Enviar ${inc.length} ${inc.length === 1 ? 'foto' : 'fotos'}`;
      avancar.disabled = !inc.length;
      resumo = semPos ? `${semPos} sem coordenada` : '';
    } else if (st.passo === 4) {
      const falhas = st.itens.filter((i) => i.incluir && i.envio === 'erro').length;
      if (st.ativo) {
        avancar.textContent = 'Enviando…';
        avancar.disabled = true;
      } else if (falhas) {
        avancar.textContent = `Tentar de novo (${falhas})`;
      } else {
        avancar.textContent = 'Concluir';
      }
    }
    $('#im-resumo').textContent = resumo;
    $('#im-fechar').title = st.ativo ? 'Parar' : 'Fechar';
  }

  function erro(msg) {
    const e = $('#im-erro');
    e.textContent = msg;
    e.hidden = !msg;
    if (msg) e.scrollIntoView({ block: 'nearest' });
  }

  async function avancar() {
    if (st.passo === 1) {
      if (st.arquivos.length) irPasso(2);
    } else if (st.passo === 2) {
      await lerFotos();
    } else if (st.passo === 3) {
      const inc = st.itens.filter((i) => i.incluir && !i.falhaLeitura);
      const semPos = inc.filter((i) => !i.pos).length;
      const ruins = inc.filter((i) => i.coordInvalida).length;
      if (ruins) { erro(`Há ${ruins === 1 ? 'uma coordenada digitada' : `${ruins} coordenadas digitadas`} que não foi possível entender. Corrija ou apague o campo.`); return; }
      if (semPos && !confirm(`${semPos === 1 ? 'Uma foto está' : `${semPos} fotos estão`} sem coordenada. Ela${semPos === 1 ? '' : 's'} entra${semPos === 1 ? '' : 'm'} no relatório, mas não aparece${semPos === 1 ? '' : 'm'} no mapa. Enviar assim mesmo?`)) return;
      irPasso(4);
      renderEnvio();
      await enviar();
    } else if (st.passo === 4) {
      if (st.itens.some((i) => i.incluir && i.envio === 'erro')) await enviar();
      else fechar();
    }
  }

  function voltar() {
    if (st.ativo) return;
    if (st.passo === 3 && st.itens.length && !confirm('Voltar descarta a revisão feita até aqui. Continuar?')) return;
    if (st.passo > 1) irPasso(st.passo - 1);
  }

  // -------------------------------------------------------------- passo 1: fotos
  function adicionarArquivos(lista) {
    const novos = [...lista].filter((f) => f.type.startsWith('image/') || ACEITOS.test(f.name));
    const chave = (f) => `${f.name}|${f.size}|${f.lastModified}`;
    const ja = new Set(st.arquivos.map(chave));
    novos.forEach((f) => { if (!ja.has(chave(f))) { st.arquivos.push(f); ja.add(chave(f)); } });
    st.arquivos.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    const ignorados = lista.length - novos.length;
    mostrarEscolhidos(ignorados);
  }

  function mostrarEscolhidos(ignorados = 0) {
    const ul = $('#im-escolhidos');
    const heic = st.arquivos.filter((f) => /\.(heic|heif)$/i.test(f.name) || /hei[cf]/i.test(f.type)).length;
    ul.innerHTML = st.arquivos.map((f, i) => `<li><span class="im-nome" title="${esc(f.name)}">${esc(f.name)}</span><span class="cinza">${tamanho(f.size)}</span><button type="button" class="btn-ico btn-ico-peq" data-tirar="${i}" title="Tirar da lista" aria-label="Tirar ${esc(f.name)} da lista"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></li>`).join('');
    const avisos = [];
    if (heic) avisos.push(`${heic === 1 ? 'Uma foto está' : `${heic} fotos estão`} em HEIC (iPhone). Se o navegador não conseguir abrir, exporte como JPEG ou, no iPhone, use Ajustes › Câmera › Formatos › Mais compatível.`);
    if (ignorados) avisos.push(`${ignorados === 1 ? 'Um arquivo foi ignorado' : `${ignorados} arquivos foram ignorados`} por não ser imagem.`);
    if (st.arquivos.length > 300) avisos.push('Lotes muito grandes demoram para ler e enviar. Se possível, importe em partes de até 300 fotos.');
    $('#im-aviso-arq').innerHTML = avisos.map((a) => `<p>${esc(a)}</p>`).join('');
    $('#im-aviso-arq').hidden = !avisos.length;
    $('#im-limpar').hidden = !st.arquivos.length;
    atualizarRodape();
  }

  // -------------------------------------------------------------- passo 2: destino e leitura
  function modoEscolhido() {
    const r = $('input[name="im-modo"]:checked');
    return r ? r.value : '';
  }

  function mostrarCamposModo() {
    const m = modoEscolhido();
    $('#im-campos-novo').hidden = m !== 'novo';
    $('#im-campos-existente').hidden = m !== 'existente';
    $('#im-campos-comuns').hidden = !m;
    $$('.im-modo').forEach((l) => l.classList.toggle('marcado', l.querySelector('input').checked));
  }

  async function chamarEquipe(action, dados, timeout) {
    const cod = local.ler(CHAVE_EQUIPE);
    const eq = equipeEnvio();
    const extra = { ...(cod ? { codigo: cod } : {}), ...(eq ? { equipe: eq } : {}) };
    return chamar(action, { ...dados, ...extra }, timeout);
  }

  function pedirCodigo(msg) {
    local.apagar(CHAVE_EQUIPE);
    $('#im-codigo-campo').hidden = false;
    erro(msg);
    $('#im-codigo').focus();
  }

  async function obterBase() {
    if (st.base) return st.base;
    const versao = ctx.dados() && ctx.dados().versaoEstacas;
    const salvo = await cacheLer('kv', 'estacas');
    if (salvo && salvo.r && (!versao || String(salvo.v) === String(versao))) {
      st.base = new BaseEstacas(salvo);
      return st.base;
    }
    progressoLeitura(0, 1, 'Baixando a base de estacas (só na primeira vez)…');
    const r = await chamarEquipe('estacas', {}, 180000);
    if (!r.estacas || !r.estacas.r) throw new Error('O servidor não devolveu a base de estacas.');
    cacheGravar('kv', 'estacas', r.estacas);
    st.base = new BaseEstacas(r.estacas);
    return st.base;
  }

  function progressoLeitura(i, n, txt) {
    $('#im-leitura').hidden = false;
    $('#im-leitura-barra').style.width = `${n ? Math.round((i / n) * 100) : 0}%`;
    $('#im-leitura-txt').textContent = txt;
  }

  async function lerFotos() {
    if (ctx.dados() && ctx.dados().master && !$('#im-equipe').value) { erro('Escolha a equipe das fotos.'); $('#im-equipe').focus(); return; }
    const modo = modoEscolhido();
    if (!modo) { erro('Escolha se as fotos são individuais ou de um relatório.'); return; }
    const insp = $('#im-insp').value.trim();
    if (!insp) { erro('Informe o nome de quem fez as fotos.'); $('#im-insp').focus(); return; }
    if (modo === 'existente' && !$('#im-rel').value) { erro('Escolha o relatório.'); return; }
    if (!$('#im-codigo-campo').hidden) {
      const c = $('#im-codigo').value.trim();
      if (!c) { erro('Informe o código da equipe.'); $('#im-codigo').focus(); return; }
      local.gravar(CHAVE_EQUIPE, c);
    }
    local.gravar(CHAVE_INSPETOR, insp);
    opcoes = { legenda: $('#im-legenda').checked, ocr: $('#im-ocr').checked };
    st.descGeral = $('#im-desc-geral').value.trim();
    st.catGeral = $('#im-cat-geral').value;
    local.gravar(CHAVE_OPCOES, JSON.stringify(opcoes));
    erro('');

    st.ativo = true;
    st.cancelar = false;
    window.addEventListener('beforeunload', segurarSaida);
    $$('#dlg-importar [data-passo="2"] input, #dlg-importar [data-passo="2"] select').forEach((x) => { x.disabled = true; });
    atualizarRodape();
    try {
      try {
        await obterBase();
      } catch (e) {
        if (e.codigo === 'SOMENTE_EQUIPE' || e.codigo === 'CODIGO_INVALIDO') {
          pedirCodigo(local.ler(CHAVE_EQUIPE) || !$('#im-codigo-campo').hidden
            ? 'Código da equipe não reconhecido. Confira e tente de novo.'
            : 'Para importar fotos é preciso o código da equipe (o mesmo usado no app). O código do portal só consulta.');
        } else if (e.codigo === 'ACAO_DESCONHECIDA') {
          erro('O script do Google não tem a ação de estacas. Confira se o Code.gs publicado é a versão atual.');
        } else {
          erro(`Não foi possível baixar a base de estacas: ${e.message}`);
        }
        return;
      }
      st.itens = [];
      const limite = (ctx.dados() && ctx.dados().limite) || 40;
      let n = 0;
      for (const f of st.arquivos) {
        if (st.cancelar) break;
        n++;
        progressoLeitura(n - 1, st.arquivos.length, `Lendo foto ${n} de ${st.arquivos.length}: ${f.name}`);
        st.itens.push(await lerUma(f, limite, (txt) => progressoLeitura(n - 0.5, st.arquivos.length, `Foto ${n} de ${st.arquivos.length}: ${txt}`)));
        await esperar(0);
      }
      if (st.cancelar) { st.itens = []; return; }
      progressoLeitura(1, 1, 'Pronto');
      st.itens.sort((a, b) => (a.data ? a.data.getTime() : Infinity) - (b.data ? b.data.getTime() : Infinity));
      marcarRepetidas();
      irPasso(3);
      renderRevisao();
    } finally {
      st.ativo = false;
      window.removeEventListener('beforeunload', segurarSaida);
      $$('#dlg-importar [data-passo="2"] input, #dlg-importar [data-passo="2"] select').forEach((x) => { x.disabled = false; });
      $('#im-modo-existente').disabled = !Array.from($('#im-rel').options).some((o) => o.value);
      $('#im-leitura').hidden = true;
      atualizarRodape();
    }
  }

  async function lerUma(arquivo, limite, aoEtapa) {
    const item = {
      uid: Math.random().toString(36).slice(2),
      arquivo,
      nome: arquivo.name,
      incluir: true,
      falhaLeitura: '',
      thumb: '',
      w: 0, h: 0,
      data: null, origemData: '',
      pos: null, origemPos: '', formatoTexto: '',
      precisao: null,
      jaTemLegenda: false,
      legenda: opcoes.legenda,
      estaca: null,
      descricao: st.descGeral || '',
      categoria: st.catGeral || '',
      textoLido: '',
      repetida: '',
      envio: '', envioErro: '',
    };
    const ex = await lerExif(arquivo);
    if (ex.data) { item.data = ex.data; item.origemData = 'Data da foto'; }
    if (ex.lat != null) {
      item.pos = { lat: ex.lat, lon: ex.lon };
      item.origemPos = 'gps';
      item.precisao = ex.precisao;
    }
    let im;
    try {
      im = await abrirImagem(arquivo);
    } catch (e) {
      item.falhaLeitura = e.message;
      item.incluir = false;
      return item;
    }
    try {
      item.w = im.w;
      item.h = im.h;
      item.thumb = miniaturaDe(im);
      if (!item.pos && opcoes.ocr) {
        aoEtapa('procurando a coordenada escrita na foto…');
        try {
          const texto = await lerTextoDaFoto(im.fonte, im.w, im.h, (t) => !!lerCoordenada(t, 22, distanciaAoTracado));
          item.textoLido = texto;
          const c = lerCoordenada(texto, 22, distanciaAoTracado);
          if (c) {
            item.pos = { lat: c.lat, lon: c.lon };
            item.origemPos = 'texto';
            item.formatoTexto = c.formato;
            item.jaTemLegenda = true;
            item.legenda = false; // a foto já tem legenda escrita; não escreve outra por cima
          }
          // sem coordenada, mas com a estaca escrita ("Km 120+420"): posição aproximada pelo ponto da estaca
          const est = lerEstacaTexto(texto);
          if (!item.pos && est && st.base) {
            const p = st.base.porEstaca(est.m, est.eixo);
            if (p) {
              item.pos = { lat: p.lat, lon: p.lon };
              item.origemPos = 'estaca';
              item.formatoTexto = 'estaca escrita na foto';
            }
          }
          // texto típico de legenda (data/hora ou estaca) mesmo sem coordenada legível: não escreve outra legenda por cima
          if (!item.jaTemLegenda && (lerDataHora(texto) || est)) {
            item.jaTemLegenda = true;
            item.legenda = false;
          }
          if (!item.data) {
            const d = lerDataHora(texto);
            if (d && !isNaN(d)) { item.data = d; item.origemData = 'Texto na foto'; }
          }
        } catch (e) {
          item.ocrErro = e.message;
        }
      }
    } finally {
      im.fechar();
    }
    if (!item.data) {
      item.data = new Date(arquivo.lastModified || Date.now());
      item.origemData = 'Data do arquivo';
    }
    calcularEstaca(item, limite);
    return item;
  }

  /** Distância (graus, aproximada) da coordenada ao traçado: usada para escolher o fuso UTM quando a foto não diz. */
  function distanciaAoTracado(lat, lon) {
    if (!st.base) return 0;
    const e = st.base.maisProxima(lat, lon);
    return e ? e.distancia : Infinity;
  }

  function calcularEstaca(item, limite = (ctx.dados() && ctx.dados().limite) || 40) {
    item.estaca = item.pos && st.base ? st.base.maisProxima(item.pos.lat, item.pos.lon) : null;
    item.fora = !!(item.estaca && item.estaca.distancia > limite);
  }

  /** Marca fotos que parecem já estar no portal (mesmo segundo e a menos de 5 m) ou repetidas no lote. */
  function marcarRepetidas() {
    const regs = (ctx.dados() && ctx.dados().registros) || [];
    const porSegundo = new Map();
    regs.forEach((r) => {
      if (!r.d) return;
      const s = Math.floor(r.d.getTime() / 1000);
      if (!porSegundo.has(s)) porSegundo.set(s, []);
      porSegundo.get(s).push(r);
    });
    const vistos = [];
    st.itens.forEach((it) => {
      it.repetida = '';
      // a data do arquivo (cópia, download) não serve para comparar
      if (it.falhaLeitura || !it.data || it.origemData === 'Data do arquivo') return;
      const s = Math.floor(it.data.getTime() / 1000);
      const perto = (lat, lon) => !it.pos || lat == null || distM(it.pos.lat, it.pos.lon, lat, lon) < 5;
      for (const k of [s - 1, s, s + 1]) {
        const r = (porSegundo.get(k) || []).find((g) => perto(g.lat, g.lon));
        if (r) { it.repetida = `Parece já estar no portal (${fmtDataApp(r.d)}${r.estaca ? `, estaca ${r.estaca}` : ''}).`; break; }
      }
      if (!it.repetida) {
        const outro = vistos.find((o) => Math.abs(o.data.getTime() - it.data.getTime()) < 1000
          && (o.pos && it.pos ? distM(o.pos.lat, o.pos.lon, it.pos.lat, it.pos.lon) < 5 : o.arquivo.size === it.arquivo.size));
        if (outro) it.repetida = `Parece repetida de ${outro.nome}.`;
      }
      if (it.repetida) it.incluir = false;
      vistos.push(it);
    });
  }

  // -------------------------------------------------------------- passo 3: revisão
  function rotuloOrigem(it) {
    if (!it.pos) return '<span class="im-orig im-orig-falta">Sem coordenada</span>';
    if (it.origemPos === 'gps') return '<span class="im-orig im-orig-gps">GPS da foto</span>';
    if (it.origemPos === 'texto') return `<span class="im-orig im-orig-texto" title="Lida no texto da foto (${esc(it.formatoTexto)}). Confira.">Texto na foto</span>`;
    if (it.origemPos === 'estaca') return '<span class="im-orig im-orig-estaca" title="A foto não tem coordenada, só a estaca escrita. A posição é a do ponto da estaca no eixo.">Estaca na foto</span>';
    return '<span class="im-orig im-orig-dig">Digitada</span>';
  }

  function linhaEstaca(it) {
    if (it.coordInvalida) return '<span class="im-est im-est-erro">Coordenada não reconhecida</span>';
    if (!it.pos && it.ocrErro) return '<span class="im-est im-est-erro">Não foi possível ler o texto da foto. Digite a coordenada, se souber.</span>';
    if (!it.pos) return '<span class="im-est cinza">Não aparecerá no mapa. Digite a coordenada, se souber.</span>';
    const e = it.estaca;
    if (!e) return '<span class="im-est cinza">Estaca não calculada</span>';
    const eixo = e.eixo && e.eixo !== 'Linha principal' ? ` (${esc(e.eixo)})` : '';
    if (it.origemPos === 'estaca') return `<span class="im-est"><b>EST ${esc(e.estaca)}</b>${eixo} · posição aproximada (ponto da estaca no eixo)${e.cidade ? ` · ${esc(e.cidade)}` : ''}</span>`;
    if (it.fora) return `<span class="im-est im-est-fora">Fora da faixa de domínio · estaca mais próxima ${esc(e.estaca)}${eixo} a ${fmtDist(e.distancia)} m</span>`;
    return `<span class="im-est"><b>EST ${esc(e.estaca)}</b>${eixo} · a ${fmtDist(e.distancia)} m${e.cidade ? ` · ${esc(e.cidade)}` : ''}</span>`;
  }

  function opcoesCategoria(sel) {
    const cats = (ctx.dados() && ctx.dados().listas.categorias) || [];
    return `<option value="">Sem categoria</option>${cats.map((c) => `<option${c === sel ? ' selected' : ''}>${esc(c)}</option>`).join('')}`;
  }

  function renderRevisao() {
    renderContagem();
    $('#im-todas-cat').innerHTML = opcoesCategoria('');
    const modo = modoEscolhido();
    const d = ctx.dados();
    let destino = 'Fotos individuais';
    if (modo === 'novo') destino = `Novo relatório: ${$('#im-tipo').value}${$('#im-objeto').value.trim() ? ` · ${$('#im-objeto').value.trim()}` : ''}`;
    if (modo === 'existente') {
      const r = d && d.relPorId.get($('#im-rel').value);
      destino = `Relatório: ${r ? [r.tipo, r.objeto].filter(Boolean).join(' · ') : $('#im-rel').value}`;
    }
    const eqNome = d && d.master ? d.nomeEquipe.get($('#im-equipe').value) : '';
    $('#im-destino').textContent = [eqNome, destino, $('#im-insp').value.trim()].filter(Boolean).join(' · ');
    $('#im-lista').innerHTML = st.itens.map((it, idx) => cartao(it, idx)).join('');
    atualizarRodape();
  }

  function renderContagem() {
    const lidas = st.itens.filter((i) => !i.falhaLeitura);
    const gps = lidas.filter((i) => i.origemPos === 'gps').length;
    const txt = lidas.filter((i) => i.origemPos === 'texto').length;
    const pelaEstaca = lidas.filter((i) => i.origemPos === 'estaca').length;
    const dig = lidas.filter((i) => i.origemPos === 'digitada' && i.pos).length;
    const sem = lidas.filter((i) => !i.pos).length;
    const falhas = st.itens.length - lidas.length;
    const semOcr = lidas.some((i) => !i.pos && i.ocrErro);
    const rep = st.itens.filter((i) => i.repetida).length;
    $('#im-contagem').innerHTML = [
      `<span><b>${lidas.length}</b> ${lidas.length === 1 ? 'foto lida' : 'fotos lidas'}</span>`,
      gps && `<span class="im-orig im-orig-gps">${gps} GPS da foto</span>`,
      txt && `<span class="im-orig im-orig-texto">${txt} texto na foto</span>`,
      pelaEstaca && `<span class="im-orig im-orig-estaca">${pelaEstaca} pela estaca</span>`,
      dig && `<span class="im-orig im-orig-dig">${dig} digitada${dig === 1 ? '' : 's'}</span>`,
      sem && `<span class="im-orig im-orig-falta">${sem} sem coordenada</span>`,
      rep && `<span class="im-orig im-orig-rep">${rep} possíve${rep === 1 ? 'l' : 'is'} repetida${rep === 1 ? '' : 's'}</span>`,
      falhas && `<span class="im-orig im-orig-falta">${falhas} não ${falhas === 1 ? 'abriu' : 'abriram'}</span>`,
    ].filter(Boolean).join('')
      + (sem && !st.redetectando ? `<button type="button" class="btn btn-sec btn-peq im-redetectar-todas" data-redetectar-todas title="Análise mais demorada e detalhada, que tenta vários tratamentos da imagem">Repetir detecção nas ${sem === 1 ? 'sem coordenada' : `${sem} sem coordenada`}</button>` : '')
      + (st.redetectando ? `<button type="button" class="btn btn-sec btn-peq im-redetectar-todas" data-parar-redeteccao>Parar (${esc(st.redetectando)})</button>` : '')
      + (semOcr ? '<p class="im-alerta im-alerta-largo">O leitor de texto não pôde ser carregado (ele vem da internet na primeira vez). As fotos sem GPS ficaram sem coordenada: digite-a ou tente de novo com a internet funcionando.</p>' : '');
  }

  function cartao(it, idx) {
    if (it.falhaLeitura) {
      return `<li class="im-item im-falha" data-uid="${it.uid}"><div class="im-thumb im-thumb-vazia"></div><div class="im-dados"><div class="im-linha1"><span class="im-nome">${esc(it.nome)}</span></div><p class="im-alerta">${esc(it.falhaLeitura)} A foto será ignorada.</p></div></li>`;
    }
    const coord = it.pos ? `${it.pos.lat.toFixed(6)}, ${it.pos.lon.toFixed(6)}` : (it.coordTexto || '');
    return `<li class="im-item${it.incluir ? '' : ' fora-do-envio'}" data-uid="${it.uid}">
      <button type="button" class="im-thumb" data-previa title="Ver como a foto vai ficar"><img src="${it.thumb}" alt=""><span>Ver</span></button>
      <div class="im-dados">
        <div class="im-linha1">
          <span class="im-num">${idx + 1}</span>
          <span class="im-nome" title="${esc(it.nome)}">${esc(it.nome)}</span>
          ${rotuloOrigem(it)}
          <label class="im-incluir"><input type="checkbox" data-campo="incluir"${it.incluir ? ' checked' : ''}> Enviar</label>
        </div>
        ${it.repetida ? `<p class="im-alerta">${esc(it.repetida)} Marque “Enviar” se quiser mandar mesmo assim.</p>` : ''}
        <div class="im-grade">
          <label><span>Data e hora <em class="im-orig-data${it.origemData === 'Data do arquivo' ? ' atencao' : ''}">${esc(it.origemData)}${it.origemData === 'Data do arquivo' ? ' · confira' : ''}</em></span>
            <input type="datetime-local" step="1" data-campo="data" value="${paraInputData(it.data)}"></label>
          <label><span>Coordenada <em>lat, lon · GMS · UTM</em></span>
            <input type="text" data-campo="coord" value="${esc(coord)}" placeholder="Ex.: -14.0603, -49.2363 ou E/N UTM" spellcheck="false" autocomplete="off"></label>
          <div class="im-estaca largo">${linhaEstaca(it)}</div>
          ${it.origemPos === 'gps' ? '' : `<div class="im-detectar largo">
            ${it.analisando ? `<span class="im-analisando"><i></i>${esc(it.analisando)}</span>` : `
            <button type="button" class="btn btn-sec btn-peq" data-redetectar title="Análise mais detalhada da foto inteira, com vários tratamentos da imagem">${it.pos ? 'Detectar de novo' : 'Repetir detecção'}</button>
            <button type="button" class="btn btn-sec btn-peq" data-marcar title="Desenhe um retângulo em volta do texto da coordenada">Marcar onde está o texto</button>`}
            ${it.redeteccaoMsg ? `<span class="im-detectar-msg">${esc(it.redeteccaoMsg)}</span>` : ''}
            ${it.textoLido && it.textoLido.trim() ? `<details class="im-texto-lido"><summary>Texto lido na foto</summary><pre>${esc(it.textoLido.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim())}</pre></details>` : ''}
          </div>`}
          <label class="largo"><span>Descrição do local</span>
            <span class="im-desc-linha"><textarea rows="2" data-campo="descricao" placeholder="O que a foto mostra">${esc(it.descricao)}</textarea>
            ${idx > 0 ? '<button type="button" class="btn btn-sec btn-peq" data-repetir title="Repetir a descrição da foto anterior">Repetir anterior</button>' : ''}</span></label>
          <label><span>Categoria</span><select data-campo="categoria">${opcoesCategoria(it.categoria)}</select></label>
          <label class="im-check"><input type="checkbox" data-campo="legenda"${it.legenda ? ' checked' : ''}> Escrever legenda na foto${it.jaTemLegenda ? ' <em>(já tem legenda)</em>' : ''}</label>
        </div>
      </div>
    </li>`;
  }

  function itemDe(el) {
    const li = el.closest('[data-uid]');
    return li ? { li, it: st.itens.find((i) => i.uid === li.dataset.uid) } : {};
  }

  function atualizarCartao(li, it) {
    const idx = st.itens.indexOf(it);
    const novo = document.createElement('template');
    novo.innerHTML = cartao(it, idx).trim();
    li.replaceWith(novo.content.firstChild);
  }

  function aoMudarCampo(ev) {
    const campo = ev.target.dataset.campo;
    if (!campo) return;
    const { li, it } = itemDe(ev.target);
    if (!it) return;
    if (campo === 'incluir') {
      it.incluir = ev.target.checked;
      li.classList.toggle('fora-do-envio', !it.incluir);
      atualizarRodape();
    } else if (campo === 'legenda') {
      it.legenda = ev.target.checked;
    } else if (campo === 'descricao') {
      it.descricao = ev.target.value;
    } else if (campo === 'categoria') {
      it.categoria = ev.target.value;
    } else if (campo === 'data' && ev.type === 'change') {
      const v = ev.target.value;
      if (v) {
        const d = new Date(v.length === 16 ? `${v}:00` : v);
        if (!isNaN(d)) { it.data = d; it.origemData = 'Ajustada'; }
      }
      const em = li.querySelector('.im-orig-data');
      if (em) { em.textContent = it.origemData; em.classList.remove('atencao'); }
    } else if (campo === 'coord' && ev.type === 'change') {
      const t = ev.target.value.trim();
      it.coordInvalida = false;
      it.coordTexto = '';
      if (!t) {
        it.pos = null;
        it.origemPos = '';
      } else {
        const c = lerCoordenada(t);
        if (c) {
          const mudou = !it.pos || Math.abs(c.lat - it.pos.lat) > 1e-7 || Math.abs(c.lon - it.pos.lon) > 1e-7;
          if (mudou) { it.pos = { lat: c.lat, lon: c.lon }; it.origemPos = 'digitada'; it.precisao = null; }
        } else {
          it.coordInvalida = true;
          it.coordTexto = t;
          it.pos = null;
        }
      }
      calcularEstaca(it);
      atualizarCartao(li, it);
      atualizarRodape();
    }
  }

  function aoClicarLista(ev) {
    const { li, it } = itemDe(ev.target);
    if (!it) return;
    if (ev.target.closest('[data-repetir]')) {
      const idx = st.itens.indexOf(it);
      const ant = st.itens.slice(0, idx).reverse().find((i) => !i.falhaLeitura && i.descricao);
      if (!ant) return;
      it.descricao = ant.descricao;
      li.querySelector('[data-campo="descricao"]').value = it.descricao;
    } else if (ev.target.closest('[data-previa]')) {
      mostrarPrevia(it);
    } else if (ev.target.closest('[data-redetectar]')) {
      redetectar(it, null);
    } else if (ev.target.closest('[data-marcar]')) {
      abrirMarcacao(it);
    }
  }

  // -------------------------------------------------------------- segunda análise (mais detalhada)
  function redesenharCartao(it) {
    const li = $(`#im-lista li[data-uid="${it.uid}"]`);
    if (li) atualizarCartao(li, it);
  }

  /** Análise detalhada da foto (ou só da região marcada). Atualiza coordenada, data e estaca se achar. */
  async function redetectar(it, regiao, cancelado = () => false) {
    if (it.analisando) return;
    it.analisando = regiao ? 'Lendo a área marcada…' : 'Analisando a foto…';
    it.redeteccaoMsg = '';
    redesenharCartao(it);
    let im;
    try {
      im = await abrirImagem(it.arquivo);
      const r = await analiseDetalhada(im.fonte, im.w, im.h, {
        regiao,
        avaliar: distanciaAoTracado,
        cancelado,
        aoProgresso: (i, n) => {
          it.analisando = `${regiao ? 'Lendo a área marcada' : 'Analisando a foto'}… ${Math.round((i / n) * 100)}%`;
          const el = $(`#im-lista li[data-uid="${it.uid}"] .im-analisando`);
          if (el) el.lastChild.textContent = it.analisando;
        },
      });
      it.textoLido = [r.texto, it.textoLido].filter(Boolean).join('\n');
      if (r.coord) {
        it.pos = { lat: r.coord.lat, lon: r.coord.lon };
        it.origemPos = 'texto';
        it.formatoTexto = `${r.coord.formato}, análise detalhada${r.votos > 1 ? ` (${r.votos} leituras iguais)` : ' (uma leitura: confira)'}`;
        it.precisao = null;
        it.coordInvalida = false;
        it.redeteccaoMsg = r.votos > 1 ? 'Coordenada encontrada.' : 'Coordenada encontrada em uma só leitura: confira.';
      } else {
        const est = lerEstacaTexto(r.texto);
        const p = est && st.base ? st.base.porEstaca(est.m, est.eixo) : null;
        if (p && (!it.pos || it.origemPos === 'estaca')) {
          it.pos = { lat: p.lat, lon: p.lon };
          it.origemPos = 'estaca';
          it.formatoTexto = 'estaca escrita na foto';
          it.redeteccaoMsg = 'Coordenada não encontrada; posição pela estaca escrita na foto.';
        } else {
          it.redeteccaoMsg = cancelado() ? 'Análise interrompida.' : regiao
            ? 'Não foi possível ler uma coordenada nessa área. Tente marcar só as linhas do texto, um pouco mais largo.'
            : 'Não foi possível ler a coordenada. Tente "Marcar onde está o texto" ou digite a coordenada.';
        }
      }
      if (r.texto && (r.coord || lerDataHora(r.texto) || lerEstacaTexto(r.texto))) { it.jaTemLegenda = true; it.legenda = false; }
      if (it.origemData === 'Data do arquivo') {
        const d = lerDataHora(r.texto);
        if (d && !isNaN(d)) { it.data = d; it.origemData = 'Texto na foto'; }
      }
      calcularEstaca(it);
    } catch (e) {
      it.redeteccaoMsg = `Não foi possível analisar: ${e.message}`;
    } finally {
      if (im) im.fechar();
      it.analisando = '';
      redesenharCartao(it);
      renderContagem();
      atualizarRodape();
    }
  }

  async function redetectarTodas() {
    if (st.redetectando) return;
    const fila = st.itens.filter((i) => !i.falhaLeitura && !i.pos && !i.analisando);
    if (!fila.length) return;
    st.pararRedeteccao = false;
    let n = 0;
    try {
      for (const it of fila) {
        if (st.pararRedeteccao) break;
        n++;
        st.redetectando = `${n} de ${fila.length}`;
        renderContagem();
        $(`#im-lista li[data-uid="${it.uid}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        await redetectar(it, null, () => st.pararRedeteccao);
      }
    } finally {
      st.redetectando = '';
      renderContagem();
      const achou = fila.filter((i) => i.pos).length;
      ctx.avisar(`Detecção repetida em ${n} ${n === 1 ? 'foto' : 'fotos'}: ${achou} com coordenada.`);
    }
  }

  // -------------------------------------------------------------- marcar a área do texto
  let marcacao = null;
  async function abrirMarcacao(it) {
    const caixa = $('#im-marcar');
    const img = $('#im-marcar-img');
    marcacao = { it, ret: null };
    $('#im-marcar-ler').disabled = true;
    $('#im-marcar-sel').hidden = true;
    caixa.hidden = false;
    let im;
    try {
      im = await abrirImagem(it.arquivo);
      const c = renderizar(im.fonte, im.w, im.h, null, { maxLado: 1600 });
      img.src = c.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      ctx.avisar(`Não foi possível abrir a foto: ${e.message}`, true);
      fecharMarcacao();
    } finally {
      if (im) im.fechar();
    }
  }
  function fecharMarcacao() {
    $('#im-marcar').hidden = true;
    $('#im-marcar-img').removeAttribute('src');
    marcacao = null;
  }
  function ligarMarcacao() {
    const area = $('#im-marcar-area');
    const sel = $('#im-marcar-sel');
    let ini = null;
    const pos = (ev) => {
      const r = $('#im-marcar-img').getBoundingClientRect();
      return { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)), r };
    };
    const desenhar = (a, b) => {
      const img = $('#im-marcar-img').getBoundingClientRect();
      const base = area.getBoundingClientRect();
      const x0 = Math.min(a.x, b.x); const y0 = Math.min(a.y, b.y);
      const x1 = Math.max(a.x, b.x); const y1 = Math.max(a.y, b.y);
      Object.assign(sel.style, {
        left: `${img.left - base.left + x0 * img.width}px`, top: `${img.top - base.top + y0 * img.height}px`,
        width: `${(x1 - x0) * img.width}px`, height: `${(y1 - y0) * img.height}px`,
      });
      sel.hidden = false;
      return { x0, y0, x1, y1 };
    };
    area.addEventListener('pointerdown', (ev) => {
      if (!marcacao || ev.target.closest('button')) return;
      ev.preventDefault();
      area.setPointerCapture(ev.pointerId);
      ini = pos(ev);
    });
    area.addEventListener('pointermove', (ev) => { if (ini && marcacao) marcacao.ret = desenhar(ini, pos(ev)); });
    area.addEventListener('pointerup', () => {
      if (!ini || !marcacao) return;
      ini = null;
      const r = marcacao.ret;
      const ok = r && (r.x1 - r.x0) > 0.03 && (r.y1 - r.y0) > 0.02;
      $('#im-marcar-ler').disabled = !ok;
      if (!ok) sel.hidden = true;
    });
    $('#im-marcar-cancelar').addEventListener('click', fecharMarcacao);
    $('#im-marcar-ler').addEventListener('click', () => {
      if (!marcacao || !marcacao.ret) return;
      const { it, ret } = marcacao;
      // folga em volta da marcação
      const fx = (ret.x1 - ret.x0) * 0.04; const fy = (ret.y1 - ret.y0) * 0.08;
      const regiao = { x0: Math.max(0, ret.x0 - fx), y0: Math.max(0, ret.y0 - fy), x1: Math.min(1, ret.x1 + fx), y1: Math.min(1, ret.y1 + fy) };
      fecharMarcacao();
      redetectar(it, regiao);
    });
  }

  function aplicarATodas() {
    const cat = $('#im-todas-cat').value;
    const desc = $('#im-todas-desc').value.trim();
    const soVazias = $('#im-todas-vazias').checked;
    if (!cat && !desc) { erro('Escolha a categoria ou escreva a descrição a aplicar.'); return; }
    erro('');
    st.itens.forEach((it) => {
      if (it.falhaLeitura) return;
      if (cat && (!soVazias || !it.categoria)) it.categoria = cat;
      if (desc && (!soVazias || !it.descricao)) it.descricao = desc;
    });
    renderRevisao();
  }

  // -------------------------------------------------------------- legenda (igual ao app)
  function linhasLegenda(it) {
    const L = [];
    const limite = (ctx.dados() && ctx.dados().limite) || 40;
    L.push({ texto: fmtDataApp(it.data) });
    if (it.pos) {
      const acc = it.precisao ? `  ±${Math.round(it.precisao)} m` : '';
      L.push({ texto: `Lat ${fmtNum(it.pos.lat, 6)}  Lon ${fmtNum(it.pos.lon, 6)}${acc}` });
    } else {
      L.push({ texto: 'Sem posição de GPS', cor: LARANJA });
    }
    const e = it.estaca;
    if (e) {
      const eixo = e.eixo && e.eixo !== 'Linha principal' ? ` (${e.eixo})` : '';
      if (it.origemPos === 'estaca') {
        L.push({ texto: `EST ${e.estaca}${eixo} (posição pela estaca)`, cor: LIMA, negrito: true });
      } else if (e.distancia > limite) {
        L.push({ texto: 'FORA DA FAIXA DE DOMÍNIO', cor: LARANJA, negrito: true });
        L.push({ texto: `Estaca mais próxima ${e.estaca}${eixo} a ${fmtDist(e.distancia)} m`, cor: LARANJA, negrito: true });
      } else {
        L.push({ texto: `EST ${e.estaca}${eixo} · a ${fmtDist(e.distancia)} m`, cor: LIMA, negrito: true });
      }
    }
    if (it.descricao) L.push({ texto: it.descricao });
    return L;
  }

  async function mostrarPrevia(it) {
    const caixa = $('#im-previa');
    caixa.hidden = false;
    $('#im-previa-img').removeAttribute('src');
    $('#im-previa-txt').textContent = 'Preparando…';
    let im;
    try {
      await carregarFonteCarimbo();
      im = await abrirImagem(it.arquivo);
      const c = renderizar(im.fonte, im.w, im.h, it.legenda ? linhasLegenda(it) : null, { maxLado: 1600 });
      $('#im-previa-img').src = c.toDataURL('image/jpeg', 0.85);
      $('#im-previa-txt').textContent = `${it.nome} · ${it.legenda ? 'com a legenda que será escrita' : it.jaTemLegenda ? 'a foto já tem legenda; será enviada como está' : 'sem legenda'}`;
    } catch (e) {
      $('#im-previa-txt').textContent = `Não foi possível mostrar: ${e.message}`;
    } finally {
      if (im) im.fechar();
    }
  }

  function fecharPrevia() { $('#im-previa').hidden = true; $('#im-previa-img').removeAttribute('src'); }

  // -------------------------------------------------------------- passo 4: envio
  function renderEnvio() {
    const inc = st.itens.filter((i) => i.incluir && !i.falhaLeitura);
    $('#im-envio-lista').innerHTML = inc.map((it) => `<li data-uid="${it.uid}"><img src="${it.thumb}" alt=""><span class="im-nome">${esc(it.nome)}</span><span class="im-env-est">${it.estaca ? `EST ${esc(it.estaca.estaca)}` : '—'}</span><span class="im-env-st" data-st></span></li>`).join('');
    inc.forEach(marcarEnvio);
    progressoEnvio();
  }

  function marcarEnvio(it) {
    const li = $(`#im-envio-lista li[data-uid="${it.uid}"]`);
    if (!li) return;
    const s = li.querySelector('[data-st]');
    const t = { '': 'Na fila', enviando: 'Enviando…', ok: 'Enviada', repetida: 'Já estava no portal', erro: 'Falhou' }[it.envio] || '';
    s.textContent = it.envio === 'erro' && it.envioErro ? `Falhou: ${it.envioErro}` : t;
    li.className = it.envio ? `st-${it.envio}` : '';
  }

  function progressoEnvio() {
    const inc = st.itens.filter((i) => i.incluir && !i.falhaLeitura);
    const prontas = inc.filter((i) => i.envio === 'ok' || i.envio === 'repetida').length;
    const falhas = inc.filter((i) => i.envio === 'erro').length;
    $('#im-env-barra').style.width = `${inc.length ? Math.round((prontas / inc.length) * 100) : 0}%`;
    $('#im-env-pct').textContent = `${prontas} de ${inc.length}`;
    $('#im-env-txt').textContent = st.ativo ? 'Enviando ao Drive…' : falhas ? `${falhas} ${falhas === 1 ? 'falhou' : 'falharam'}. Confira a conexão e tente de novo.` : 'Todas enviadas.';
  }

  function montarRelatorioNovo() {
    if (st.relNovo) return st.relNovo;
    const datas = st.itens.filter((i) => i.incluir && !i.falhaLeitura).map((i) => i.data.getTime());
    const ini = new Date(Math.min(...datas));
    const fim = new Date(Math.max(...datas));
    const existentes = (ctx.dados() && ctx.dados().relPorId) || new Map();
    let id = `REL-${carimboId(ini)}`;
    if (existentes.has(id)) id = `${id}-I${aleatorio().slice(0, 2)}`;
    st.relNovo = {
      id,
      tipo: $('#im-tipo').value,
      objeto: $('#im-objeto').value.trim(),
      inspetor: $('#im-insp').value.trim(),
      inicio: fmtDataApp(ini),
      inicioTs: ini.getTime(),
      encerramento: fmtDataApp(fim),
      encerramentoTs: fim.getTime(),
      status: 'Encerrado',
      nFotos: datas.length,
      origem: 'Importação pelo portal',
    };
    return st.relNovo;
  }

  async function prepararImagens(it) {
    await carregarFonteCarimbo();
    const im = await abrirImagem(it.arquivo);
    try {
      let imgCom = null;
      let imgSem = null;
      if (it.legenda) {
        imgCom = await canvasParaBlob(renderizar(im.fonte, im.w, im.h, linhasLegenda(it), { maxLado: 2560 }), 0.88);
      }
      const ehJpeg = /jpe?g$/i.test(it.arquivo.type) || /\.jpe?g$/i.test(it.nome);
      const original = ehJpeg && it.arquivo.size <= MAX_ORIGINAL
        ? it.arquivo
        : await canvasParaBlob(renderizar(im.fonte, im.w, im.h, null, { maxLado: 4096 }), 0.9);
      if (it.legenda) imgSem = original;
      else if (it.jaTemLegenda) imgCom = original; // já vem com a legenda escrita
      else imgSem = original;
      return { imgCom, imgSem };
    } finally {
      im.fechar();
    }
  }

  function montarRegistro(it, idRel, modo) {
    const e = it.estaca;
    if (!it.id) it.id = `R-${carimboId(it.data)}-${aleatorio()}`;
    return {
      id: it.id,
      criadoEm: it.data.getTime(),
      dataHora: fmtDataApp(it.data),
      inspetor: $('#im-insp').value.trim(),
      modo: modo === 'individual' ? 'Fotos individuais' : 'Relatório de inspeção',
      idRelatorio: idRel,
      lat: it.pos ? Number(it.pos.lat.toFixed(7)) : '',
      lon: it.pos ? Number(it.pos.lon.toFixed(7)) : '',
      precisao: it.precisao ? Math.round(it.precisao) : '',
      eixo: e ? e.eixo : '',
      estaca: e ? e.estaca : '',
      estacaM: e ? e.estacaM : '',
      distancia: e && it.origemPos !== 'estaca' ? Math.round(e.distancia * 10) / 10 : '',
      situacao: !e ? '' : it.origemPos === 'estaca' ? 'Posição pela estaca' : (it.fora ? 'Fora da faixa de domínio' : 'Dentro da faixa'),
      pacote: e ? e.pacote : '',
      segmento: e ? e.segmento : '',
      cidade: e ? e.cidade : '',
      infra: e ? e.infra : '',
      super: e ? e.super : '',
      oae: e ? e.oae : '',
      categoria: it.categoria,
      descricao: it.descricao.trim(),
      dispositivo: `Portal (importação) · ${it.origemPos === 'gps' ? 'GPS da foto' : it.origemPos === 'texto' ? 'coordenada lida na foto' : it.origemPos === 'estaca' ? 'posição pela estaca escrita na foto' : it.origemPos === 'digitada' ? 'coordenada digitada' : 'sem coordenada'}`,
      statusEnvio: 'Pendente',
    };
  }

  async function comRepeticao(fn, tentativas = 3) {
    let ultimo;
    for (let t = 0; t < tentativas; t++) {
      try {
        return await fn();
      } catch (e) {
        ultimo = e;
        if (e.codigo || st.cancelar) throw e; // erro do servidor: não adianta repetir
        await esperar(1500 * (t + 1));
      }
    }
    throw ultimo;
  }

  async function enviar() {
    if (st.ativo) return;
    st.ativo = true;
    st.cancelar = false;
    erro('');
    window.addEventListener('beforeunload', segurarSaida);
    atualizarRodape();
    progressoEnvio();
    const modo = modoEscolhido();
    let idRel = '';
    try {
      if (modo === 'novo') {
        const rel = montarRelatorioNovo();
        idRel = rel.id;
        if (!st.relEnviado) {
          await comRepeticao(() => chamarEquipe('relatorio', { relatorio: rel }, 60000));
          st.relEnviado = true;
        }
      } else if (modo === 'existente') {
        idRel = $('#im-rel').value;
      }
      const fila = st.itens.filter((i) => i.incluir && !i.falhaLeitura && i.envio !== 'ok' && i.envio !== 'repetida');
      for (const it of fila) {
        if (st.cancelar) break;
        it.envio = 'enviando';
        it.envioErro = '';
        marcarEnvio(it);
        $(`#im-envio-lista li[data-uid="${it.uid}"]`)?.scrollIntoView({ block: 'nearest' });
        try {
          const { imgCom, imgSem } = await prepararImagens(it);
          const payload = {
            registro: montarRegistro(it, idRel, modo),
            imgCom: imgCom ? await blobBase64(imgCom) : null,
            imgSem: imgSem ? await blobBase64(imgSem) : null,
          };
          const r = await comRepeticao(() => chamarEquipe('registro', payload, 180000));
          it.envio = r.repetido ? 'repetida' : 'ok';
        } catch (e) {
          it.envio = 'erro';
          it.envioErro = e.message;
          if (e.codigo === 'CODIGO_INVALIDO' || e.codigo === 'SOMENTE_EQUIPE') {
            marcarEnvio(it);
            local.apagar(CHAVE_EQUIPE);
            throw e;
          }
        }
        marcarEnvio(it);
        progressoEnvio();
      }
    } catch (e) {
      if (e.codigo === 'CODIGO_INVALIDO' || e.codigo === 'SOMENTE_EQUIPE') {
        erro('O código da equipe deixou de ser aceito. Feche, abra a importação de novo e informe o código atual.');
      } else {
        erro(`Não foi possível enviar: ${e.message}`);
      }
    } finally {
      st.ativo = false;
      window.removeEventListener('beforeunload', segurarSaida);
      const inc = st.itens.filter((i) => i.incluir && !i.falhaLeitura);
      const ok = inc.filter((i) => i.envio === 'ok').length;
      if (ok || st.relEnviado) {
        st.enviado = true;
        ctx.atualizar();
      }
      progressoEnvio();
      atualizarRodape();
      const falhas = inc.filter((i) => i.envio === 'erro').length;
      $('#im-env-fim').hidden = !!falhas || st.cancelar || !ok;
      if (!$('#im-env-fim').hidden) {
        $('#im-env-fim-txt').textContent = `${ok} ${ok === 1 ? 'foto enviada' : 'fotos enviadas'} ao Drive${idRel ? ' no relatório' : ' como fotos individuais'}.`;
        $('#im-ver-mapa').hidden = !idRel;
        $('#im-ver-mapa').dataset.rel = idRel;
      }
    }
  }

  function segurarSaida(ev) { ev.preventDefault(); ev.returnValue = ''; }

  // -------------------------------------------------------------- ligações
  $('#r-importar').addEventListener('click', abrir);
  $('#im-fechar').addEventListener('click', fechar);
  $('#im-avancar').addEventListener('click', () => { avancar().catch((e) => { console.error(e); erro(e.message); }); });
  $('#im-voltar').addEventListener('click', voltar);
  $('#im-arquivos').addEventListener('change', (ev) => { adicionarArquivos(ev.target.files); ev.target.value = ''; });
  $('#im-limpar').addEventListener('click', () => { st.arquivos = []; mostrarEscolhidos(); });
  $('#im-escolhidos').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tirar]');
    if (!b) return;
    st.arquivos.splice(Number(b.dataset.tirar), 1);
    mostrarEscolhidos();
  });
  const zona = $('#im-zona');
  ['dragenter', 'dragover'].forEach((t) => zona.addEventListener(t, (ev) => { ev.preventDefault(); zona.classList.add('sobre'); }));
  ['dragleave', 'drop'].forEach((t) => zona.addEventListener(t, () => zona.classList.remove('sobre')));
  zona.addEventListener('drop', (ev) => { ev.preventDefault(); if (ev.dataTransfer && ev.dataTransfer.files) adicionarArquivos(ev.dataTransfer.files); });
  $$('input[name="im-modo"]').forEach((r) => r.addEventListener('change', mostrarCamposModo));
  $('#im-equipe').addEventListener('change', preencherRelatorios);
  $('#im-lista').addEventListener('input', aoMudarCampo);
  $('#im-lista').addEventListener('change', aoMudarCampo);
  $('#im-lista').addEventListener('click', aoClicarLista);
  $('#im-todas-aplicar').addEventListener('click', aplicarATodas);
  $('#im-contagem').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-redetectar-todas]')) redetectarTodas();
    if (ev.target.closest('[data-parar-redeteccao]')) { st.pararRedeteccao = true; ev.target.closest('button').disabled = true; }
  });
  ligarMarcacao();
  $('#im-previa').addEventListener('click', fecharPrevia);
  $('#im-ver-mapa').addEventListener('click', (ev) => {
    const id = ev.currentTarget.dataset.rel;
    $('#dlg-importar').hidden = true;
    document.body.classList.remove('com-modal');
    st.itens = [];
    st.arquivos = [];
    st.passo = 1;
    ctx.verRelatorio(id);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || $('#dlg-importar').hidden) return;
    if (!$('#im-previa').hidden) { fecharPrevia(); return; }
    if (!$('#im-marcar').hidden) { fecharMarcacao(); return; }
    fechar();
  });

  return { abrir, _estado: st };
}
