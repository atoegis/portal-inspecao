// Leitura do texto escrito na foto (OCR) com Tesseract.js, carregado só quando necessário.
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

export async function encerrarOCR() {
  if (!promessaWorker) return;
  try { (await promessaWorker).terminate(); } catch (e) { /* ok */ }
  promessaWorker = null;
}
