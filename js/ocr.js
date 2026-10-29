// Leitura do texto escrito na foto (OCR) com Tesseract.js, carregado só quando necessário.
import { lerCoordenada } from './coordenadas.js';
const CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let promessaWorker = null;

function carregarScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Não foi possível carregar o leitor de texto (sem internet?).'));
    document.head.appendChild(s);
  });
}

function obterWorker() {
  if (!promessaWorker) {
    promessaWorker = (async () => {
      if (!window.Tesseract) await carregarScript((window.PORTAL_CONFIG && window.PORTAL_CONFIG.tesseractUrl) || CDN);
      const w = await window.Tesseract.createWorker('eng', 1);
      await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      return w;
    })();
    promessaWorker.catch(() => { promessaWorker = null; });
  }
  return promessaWorker;
}

/**
 * Recorta uma região da foto (frações da largura/altura), amplia e deixa só o texto claro (preto sobre branco).
 * branco = true: só pixels quase brancos (pouca cor), o que separa a legenda de céu claro, talude e vegetação seca.
 */
function regiao(img, w, h, { x0 = 0, y0, x1 = 1, y1, limiar = 185, branco = false, alvo }) {
  const sw = (x1 - x0) * w;
  const sh = (y1 - y0) * h;
  const k = (alvo || Math.min(2400, Math.max(1400, w * 1.6))) / sw;
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k);
  c.height = Math.round(sh * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x0 * w, y0 * h, sw, sh, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i]; const g = p[i + 1]; const b = p[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const texto = branco ? l > limiar && Math.max(r, g, b) - Math.min(r, g, b) < 60 : l > limiar;
    const v = texto ? 0 : 255;
    p[i] = v; p[i + 1] = v; p[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

// Onde procurar, em ordem. Para na primeira leitura em que `parar(texto)` for verdadeiro.
const PASSOS = [
  { x0: 0.35, y0: 0.70, y1: 1, limiar: 215, branco: true, alvo: 1800 }, // canto inferior direito, texto branco (apps de câmera)
  { y0: 0.62, y1: 1, limiar: 185 },                                      // faixa de baixo, texto claro de qualquer cor
  { y0: 0.62, y1: 1, limiar: 215, branco: true },                        // faixa de baixo, só branco
  { y0: 0, y1: 0.3, limiar: 185 },                                       // faixa de cima
];

/** Texto escrito na foto. `parar(textoAteAgora)` decide se já basta (ex.: achou a coordenada). */
export async function lerTextoDaFoto(img, w, h, parar) {
  const worker = await obterWorker();
  const partes = [];
  for (const passo of PASSOS) {
    const r = await worker.recognize(regiao(img, w, h, passo));
    partes.push(r.data.text || '');
    if (parar && parar(partes.join('\n'))) break;
  }
  return partes.join('\n');
}

// ------------------------------------------------------------------ análise detalhada (segunda tentativa)
/** Limiar local: texto é o que está bem mais claro que a vizinhança (separa a legenda de fundos claros). */
function binarizarAdaptativo(ctx, cw, ch, raio, delta, minimo, satMax) {
  const d = ctx.getImageData(0, 0, cw, ch);
  const p = d.data;
  const n = cw * ch;
  const L = new Float32Array(n);
  const S = new Uint8Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const r = p[i]; const g = p[i + 1]; const b = p[i + 2];
    L[j] = 0.299 * r + 0.587 * g + 0.114 * b;
    S[j] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  const W = cw + 1;
  const I = new Float64Array(W * (ch + 1));
  for (let y = 0; y < ch; y++) {
    let linha = 0;
    for (let x = 0; x < cw; x++) {
      linha += L[y * cw + x];
      I[(y + 1) * W + x + 1] = I[y * W + x + 1] + linha;
    }
  }
  for (let y = 0; y < ch; y++) {
    const y0 = Math.max(0, y - raio); const y1 = Math.min(ch, y + raio + 1);
    for (let x = 0; x < cw; x++) {
      const x0 = Math.max(0, x - raio); const x1 = Math.min(cw, x + raio + 1);
      const soma = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
      const media = soma / ((y1 - y0) * (x1 - x0));
      const j = y * cw + x;
      const v = L[j] > media + delta && L[j] > minimo && S[j] < satMax ? 0 : 255;
      const i = j * 4;
      p[i] = v; p[i + 1] = v; p[i + 2] = v;
    }
  }
  ctx.putImageData(d, 0, 0);
}

function regiaoDetalhada(img, w, h, reg, t) {
  const sw = (reg.x1 - reg.x0) * w;
  const sh = (reg.y1 - reg.y0) * h;
  const k = Math.min(4, t.alvo / sw);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, reg.x0 * w, reg.y0 * h, sw, sh, 0, 0, c.width, c.height);
  if (t.modo === 'adaptativo') {
    binarizarAdaptativo(ctx, c.width, c.height, t.raio, t.delta || 20, t.min || 150, t.sat || 90);
    return c;
  }
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i]; const g = p[i + 1]; const b = p[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    let texto;
    if (t.modo === 'branco') texto = l > t.limiar && sat < t.sat;
    else if (t.modo === 'escuro') texto = l < t.limiar;   // texto escuro sobre fundo claro
    else texto = l > t.limiar;                            // texto claro de qualquer cor
    const v = texto ? 0 : 255;
    p[i] = v; p[i + 1] = v; p[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

const REGIOES = {
  inferiorDireita: { x0: 0.35, y0: 0.65, x1: 1, y1: 1 },
  inferior: { x0: 0, y0: 0.55, x1: 1, y1: 1 },
  inferiorEsquerda: { x0: 0, y0: 0.65, x1: 0.65, y1: 1 },
  superior: { x0: 0, y0: 0, x1: 1, y1: 0.35 },
};
// Tratamentos tentados, do mais provável ao menos provável.
const TRATAMENTOS = [
  { regiao: 'inferior', modo: 'adaptativo', raio: 40, delta: 20, min: 150, sat: 90, alvo: 2600 },
  { regiao: 'inferiorDireita', modo: 'adaptativo', raio: 40, delta: 30, min: 170, sat: 70, alvo: 1800 },
  { regiao: 'inferior', modo: 'adaptativo', raio: 25, delta: 40, min: 180, sat: 60, alvo: 1800 },
  { regiao: 'inferiorDireita', modo: 'adaptativo', raio: 25, delta: 25, min: 190, sat: 60, alvo: 2600 },
  { regiao: 'inferiorDireita', modo: 'branco', limiar: 195, sat: 70, alvo: 2600 },
  { regiao: 'inferior', modo: 'claro', limiar: 170, alvo: 2400 },
  { regiao: 'inferiorEsquerda', modo: 'adaptativo', raio: 25, delta: 20, min: 150, sat: 90, alvo: 1800 },
  { regiao: 'superior', modo: 'adaptativo', raio: 25, delta: 20, min: 150, sat: 90, alvo: 2400 },
  { regiao: 'inferior', modo: 'adaptativo', raio: 40, delta: 20, min: 150, sat: 90, alvo: 2600, psm: 11 },
  { regiao: 'inferior', modo: 'escuro', limiar: 70, alvo: 2400 },
];
// Quando o usuário marca a área do texto.
const TRATAMENTOS_AREA = [
  { modo: 'adaptativo', raio: 40, delta: 20, min: 150, sat: 90, alvo: 1600 },
  { modo: 'branco', limiar: 205, sat: 70, alvo: 1600 },
  { modo: 'adaptativo', raio: 25, delta: 30, min: 170, sat: 70, alvo: 2000 },
  { modo: 'claro', limiar: 175, alvo: 1600 },
  { modo: 'adaptativo', raio: 25, delta: 40, min: 180, sat: 60, alvo: 2400 },
  { modo: 'branco', limiar: 225, sat: 50, alvo: 2400 },
  { modo: 'adaptativo', raio: 40, delta: 20, min: 150, sat: 90, alvo: 2400, psm: 11 },
  { modo: 'escuro', limiar: 80, alvo: 1600 },
];

function agruparCandidatos(cands) {
  const grupos = [];
  for (const c of cands) {
    const g = grupos.find((x) => Math.abs(x.lat - c.lat) < 0.0003 && Math.abs(x.lon - c.lon) < 0.0003);
    if (g) g.votos++; else grupos.push({ ...c, votos: 1 });
  }
  return grupos;
}

/**
 * Segunda análise, mais demorada: vários recortes e tratamentos da imagem, com votação entre as leituras.
 * opções: { regiao (frações {x0,y0,x1,y1}, quando o usuário marca a área), avaliar(lat, lon) → distância ao traçado,
 *           aoProgresso(i, n), cancelado() }. Devolve { texto, coord | null, votos }.
 */
export async function analiseDetalhada(img, w, h, opcoes = {}) {
  const worker = await obterWorker();
  const lista = opcoes.regiao
    ? TRATAMENTOS_AREA.map((t) => ({ reg: opcoes.regiao, t }))
    : TRATAMENTOS.map((t) => ({ reg: REGIOES[t.regiao], t }));
  const textos = [];
  const cands = [];
  let psmAtual = '6';
  try {
    for (let i = 0; i < lista.length; i++) {
      if (opcoes.cancelado && opcoes.cancelado()) break;
      if (opcoes.aoProgresso) opcoes.aoProgresso(i, lista.length);
      const { reg, t } = lista[i];
      const psm = String(t.psm || 6);
      if (psm !== psmAtual) { await worker.setParameters({ tessedit_pageseg_mode: psm }); psmAtual = psm; }
      const r = await worker.recognize(regiaoDetalhada(img, w, h, reg, t));
      const texto = r.data.text || '';
      textos.push(texto);
      const c = lerCoordenada(texto, 22, opcoes.avaliar);
      if (c) cands.push(c);
      const grupos = agruparCandidatos(cands).sort((a, b) => b.votos - a.votos);
      if (grupos.length && grupos[0].votos >= 2) break;    // duas leituras iguais: basta
    }
  } finally {
    if (psmAtual !== '6') await worker.setParameters({ tessedit_pageseg_mode: '6' });
  }
  if (opcoes.aoProgresso) opcoes.aoProgresso(lista.length, lista.length);
  let grupos = agruparCandidatos(cands);
  if (opcoes.avaliar) grupos.forEach((g) => { g.dist = opcoes.avaliar(g.lat, g.lon); });
  grupos.sort((a, b) => b.votos - a.votos || (a.dist || 0) - (b.dist || 0));
  const melhor = grupos[0] || null;
  return {
    texto: textos.join('\n'),
    coord: melhor ? { lat: melhor.lat, lon: melhor.lon, formato: melhor.formato } : null,
    votos: melhor ? melhor.votos : 0,
  };
}

export async function encerrarOCR() {
  if (!promessaWorker) return;
  try { (await promessaWorker).terminate(); } catch (e) { /* ok */ }
  promessaWorker = null;
}

/** Só para testes: recorte e tratamento da imagem, sem o OCR. */
export const _teste = { regiao, regiaoDetalhada, REGIOES, PASSOS, TRATAMENTOS, TRATAMENTOS_AREA };
