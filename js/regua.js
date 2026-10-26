// Régua do trecho: o eixo esticado em linha reta, com segmentos, quilômetros e quantidade de fotos.
// Arrastar sobre a régua filtra um trecho de estacas.
import { fmtEstaca, fmtNum, esc } from './formatos.js';

const NS = 'http://www.w3.org/2000/svg';
const PAD = 14;
// Estacas em ordem decrescente da esquerda para a direita, como aparecem no mapa
// (no traçado, os quilômetros crescem para a esquerda).
const DECRESCENTE = true;
const BARRA_TOPO = 4;
const FAIXA_H = 9;
// alturas calculadas a cada desenho, conforme o espaço disponível
let ALT = 78;
let FAIXA_Y = 48;
let BARRA_BASE = 44;

export function criarRegua(svg, { aoSelecionarTrecho }) {
  let eixos = [];
  let eixo = null;
  let ultimo = { regs: [], sel: { de: null, ate: null }, marca: null };
  let arrasto = null;

  function definirEixos(lista) { eixos = lista; if (!eixo && eixos.length) eixo = eixos[0]; }
  function definirEixoAtual(nome) { eixo = eixos.find((e) => e.nome === nome) || eixos[0] || null; }

  const largura = () => Math.max(200, svg.clientWidth || svg.parentElement.clientWidth || 600);
  const util = () => largura() - PAD * 2;
  const fracao = (m) => (m - eixo.de) / (eixo.ate - eixo.de || 1);
  const xDe = (m) => PAD + (DECRESCENTE ? 1 - fracao(m) : fracao(m)) * util();
  const mDe = (x) => {
    const f = (Math.min(Math.max(x, PAD), PAD + util()) - PAD) / util();
    return eixo.de + (DECRESCENTE ? 1 - f : f) * (eixo.ate - eixo.de);
  };

  function el(nome, attrs, pai) {
    const e = document.createElementNS(NS, nome);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (pai) pai.appendChild(e);
    return e;
  }

  function passoBin() {
    const total = eixo.ate - eixo.de;
    const minimo = (total * 4) / util();
    return [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000].find((p) => p >= minimo) || 50000;
  }
  function passoKm() {
    const total = eixo.ate - eixo.de;
    const pxPorM = util() / total;
    return [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 25000, 50000].find((p) => p * pxPorM >= 72) || 100000;
  }

  function desenhar(regs, sel, marca) {
    ultimo = { regs, sel, marca };
    svg.innerHTML = '';
    const W = largura();
    ALT = Math.max(56, Math.round(svg.clientHeight || 78));
    FAIXA_Y = ALT - 30;
    BARRA_BASE = FAIXA_Y - 4;
    svg.setAttribute('viewBox', `0 0 ${W} ${ALT}`);
    if (!eixo) return;

    // barras (fotos por trecho)
    const bin = passoBin();
    const contagem = new Map();
    regs.forEach((r) => {
      const k = Math.floor((r.estacaM - eixo.de) / bin);
      contagem.set(k, (contagem.get(k) || 0) + 1);
    });
    const max = Math.max(1, ...contagem.values());
    const temSel = sel.de != null || sel.ate != null;
    const gBarras = el('g', { class: 'r-barras' }, svg);
    contagem.forEach((n, k) => {
      const m0 = eixo.de + k * bin;
      const m1 = Math.min(eixo.ate, m0 + bin);
      const x0 = Math.min(xDe(m0), xDe(m1));
      const w = Math.max(2, Math.abs(xDe(m1) - xDe(m0)) - 1);
      const h = 4 + (n / max) * (BARRA_BASE - BARRA_TOPO - 4);
      const dentro = !temSel || ((sel.de == null || m1 > sel.de) && (sel.ate == null || m0 < sel.ate));
      const r = el('rect', { x: x0, y: BARRA_BASE - h, width: w, height: h, class: dentro ? 'r-barra' : 'r-barra r-barra-fora' }, gBarras);
      el('title', {}, r).textContent = `${fmtEstaca(m0)} a ${fmtEstaca(m1)}: ${fmtNum(n)} ${n === 1 ? 'foto' : 'fotos'}`;
    });
    el('line', { x1: PAD, x2: PAD + util(), y1: BARRA_BASE + 0.5, y2: BARRA_BASE + 0.5, class: 'r-base' }, svg);

    // faixa de segmentos
    const gSeg = el('g', { class: 'r-segs' }, svg);
    const segs = [];
    (eixo.trechos || []).forEach((t) => {
      const ult = segs[segs.length - 1];
      if (ult && ult.seg === t.seg) { ult.ate = t.ate; if (!ult.cidades.includes(t.cidade)) ult.cidades.push(t.cidade); } else segs.push({ seg: t.seg, de: t.de, ate: t.ate, cidades: [t.cidade] });
    });
    segs.forEach((s, i) => {
      const x0 = Math.min(xDe(s.de), xDe(s.ate));
      const w = Math.max(1, Math.abs(xDe(s.ate) - xDe(s.de)));
      const r = el('rect', { x: x0, y: FAIXA_Y, width: w, height: FAIXA_H, class: i % 2 ? 'r-seg r-seg-b' : 'r-seg' }, gSeg);
      el('title', {}, r).textContent = `Segmento ${s.seg}: ${fmtEstaca(s.de)} a ${fmtEstaca(s.ate)}${s.cidades.filter(Boolean).length ? ` (${s.cidades.filter(Boolean).join(', ')})` : ''}`;
      if (s.seg && w > String(s.seg).length * 5.2 + 8) {
        const t = el('text', { x: x0 + w / 2, y: FAIXA_Y + FAIXA_H - 1.5, class: 'r-seg-txt' }, gSeg);
        t.textContent = s.seg;
      }
    });

    // quilômetros
    const passo = passoKm();
    const gKm = el('g', { class: 'r-km' }, svg);
    for (let m = Math.ceil(eixo.de / passo) * passo; m <= eixo.ate; m += passo) {
      const x = xDe(m);
      el('line', { x1: x, x2: x, y1: FAIXA_Y + FAIXA_H, y2: FAIXA_Y + FAIXA_H + 4, class: 'r-tick' }, gKm);
      const ancora = x < PAD + 18 ? 'start' : x > largura() - PAD - 18 ? 'end' : 'middle';
      const t = el('text', { x: ancora === 'start' ? Math.max(2, x - 2) : x, y: ALT - 4, class: 'r-km-txt', 'text-anchor': ancora }, gKm);
      t.textContent = passo >= 1000 ? `km ${fmtNum(m / 1000)}` : fmtEstaca(m);
    }

    // trecho selecionado
    if (temSel) {
      const x0 = xDe(sel.de != null ? Math.max(sel.de, eixo.de) : eixo.de);
      const x1 = xDe(sel.ate != null ? Math.min(sel.ate, eixo.ate) : eixo.ate);
      el('rect', { x: Math.min(x0, x1), y: 1, width: Math.max(2, Math.abs(x1 - x0)), height: FAIXA_Y + FAIXA_H, class: 'r-sel' }, svg);
    }

    // foto aberta no detalhe
    if (marca != null && marca >= eixo.de && marca <= eixo.ate) {
      const x = xDe(marca);
      el('path', { d: `M${x - 5},0 L${x + 5},0 L${x},7 Z`, class: 'r-marca' }, svg);
      el('line', { x1: x, x2: x, y1: 7, y2: BARRA_BASE, class: 'r-marca-linha' }, svg);
    }

    // cursor
    const cursor = el('g', { class: 'r-cursor', visibility: 'hidden' }, svg);
    el('line', { y1: 0, y2: FAIXA_Y + FAIXA_H, class: 'r-cursor-linha' }, cursor);
    el('rect', { class: 'r-cursor-fundo', y: 0, height: 15, rx: 3 }, cursor);
    el('text', { class: 'r-cursor-txt', y: 11 }, cursor);
    el('rect', { class: 'r-arrasto', y: 1, height: FAIXA_Y + FAIXA_H, visibility: 'hidden' }, svg);
  }

  function posX(ev) {
    const r = svg.getBoundingClientRect();
    return ((ev.clientX - r.left) / r.width) * largura();
  }

  function moverCursor(x) {
    const c = svg.querySelector('.r-cursor');
    if (!c || !eixo) return;
    const m = mDe(x);
    const xx = xDe(m);
    c.setAttribute('visibility', 'visible');
    c.querySelector('line').setAttribute('x1', xx);
    c.querySelector('line').setAttribute('x2', xx);
    const t = c.querySelector('text');
    t.textContent = fmtEstaca(Math.round(m));
    const w = t.getComputedTextLength ? t.getComputedTextLength() + 10 : 60;
    const xt = Math.min(Math.max(xx - w / 2, 0), largura() - w);
    t.setAttribute('x', xt + 5);
    const f = c.querySelector('rect');
    f.setAttribute('x', xt);
    f.setAttribute('width', w);
  }

  svg.addEventListener('pointermove', (ev) => {
    if (!eixo) return;
    const x = posX(ev);
    moverCursor(x);
    if (arrasto) {
      arrasto.x1 = x;
      const r = svg.querySelector('.r-arrasto');
      const a = Math.min(arrasto.x0, x);
      r.setAttribute('x', a);
      r.setAttribute('width', Math.max(1, Math.abs(x - arrasto.x0)));
      r.setAttribute('visibility', 'visible');
    }
  });
  svg.addEventListener('pointerleave', () => {
    const c = svg.querySelector('.r-cursor');
    if (c && !arrasto) c.setAttribute('visibility', 'hidden');
  });
  svg.addEventListener('pointerdown', (ev) => {
    if (!eixo || ev.button !== 0) return;
    svg.setPointerCapture(ev.pointerId);
    arrasto = { x0: posX(ev), x1: posX(ev) };
  });
  const fim = (ev) => {
    if (!arrasto) return;
    const { x0 } = arrasto;
    const x1 = posX(ev);
    arrasto = null;
    try { svg.releasePointerCapture(ev.pointerId); } catch (e) { /* já liberado */ }
    if (Math.abs(x1 - x0) < 5) {
      // clique: escolhe a barra sob o ponteiro
      const bin = passoBin();
      const k = Math.floor((mDe(x1) - eixo.de) / bin);
      const m0 = eixo.de + k * bin;
      const tem = ultimo.regs.some((r) => r.estacaM >= m0 && r.estacaM < m0 + bin);
      if (tem) aoSelecionarTrecho(eixo.nome, m0, Math.min(eixo.ate, m0 + bin));
      else desenhar(ultimo.regs, ultimo.sel, ultimo.marca);
      return;
    }
    const ma = mDe(x0);
    const mb = mDe(x1);
    const a = Math.round(Math.min(ma, mb) / 10) * 10;
    const b = Math.round(Math.max(ma, mb) / 10) * 10;
    aoSelecionarTrecho(eixo.nome, a, b);
  };
  svg.addEventListener('pointerup', fim);
  svg.addEventListener('pointercancel', () => { arrasto = null; desenhar(ultimo.regs, ultimo.sel, ultimo.marca); });

  return { definirEixos, definirEixoAtual, desenhar, esc };
}
