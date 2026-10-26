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

/** Recorta uma faixa da foto, amplia e deixa só o texto claro (preto sobre branco). */
function faixa(img, w, h, y0, y1, limiar = 185) {
  const alvo = Math.min(2400, Math.max(1400, w * 1.6));
  const k = alvo / w;
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round((y1 - y0) * h * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, y0 * h, w, (y1 - y0) * h, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const l = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    const v = l > limiar ? 0 : 255;
    p[i] = v; p[i + 1] = v; p[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/** Texto das faixas de baixo e de cima da foto (onde os apps costumam escrever a legenda). */
export async function lerTextoDaFoto(img, w, h) {
  const worker = await obterWorker();
  const partes = [];
  for (const [y0, y1] of [[0.62, 1], [0, 0.3]]) {
    const r = await worker.recognize(faixa(img, w, h, y0, y1));
    partes.push(r.data.text || '');
  }
  return partes.join('\n');
}

export async function encerrarOCR() {
  if (!promessaWorker) return;
  try { (await promessaWorker).terminate(); } catch (e) { /* ok */ }
  promessaWorker = null;
}
