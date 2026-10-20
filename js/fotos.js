// Miniaturas e fotos: busca no servidor em lotes, guarda no navegador e reaproveita.
import { chamar, cacheLer, cacheGravar } from './api.js';

const miniMem = new Map();      // id -> dataURL | null
const miniEspera = new Map();   // id -> [resolve...]
let fila = [];
let timer = null;
let emVoo = 0;
const MAX_LOTE = 12;
const MAX_PARALELO = 3;

/** Devolve uma URL de imagem pequena (data:) ou null. */
export function miniatura(id) {
  if (!id) return Promise.resolve(null);
  if (miniMem.has(id)) return Promise.resolve(miniMem.get(id));
  return new Promise((resolve) => {
    if (miniEspera.has(id)) { miniEspera.get(id).push(resolve); return; }
    miniEspera.set(id, [resolve]);
    cacheLer('miniaturas', id).then((salvo) => {
      if (salvo) { entregar(id, salvo); return; }
      fila.push(id);
      agendar();
    });
  });
}

function entregar(id, url) {
  miniMem.set(id, url);
  const r = miniEspera.get(id) || [];
  miniEspera.delete(id);
  r.forEach((fn) => fn(url));
}

function agendar() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; drenar(); }, 120);
}

async function drenar() {
  while (fila.length && emVoo < MAX_PARALELO) {
    const lote = fila.splice(0, MAX_LOTE);
    emVoo++;
    buscarLote(lote).finally(() => { emVoo--; if (fila.length) drenar(); });
  }
}

async function buscarLote(ids) {
  let resp;
  try {
    resp = await chamar('miniaturas', { ids }, 60000);
  } catch (e) {
    ids.forEach((id) => entregarSemGuardar(id, null));
    return;
  }
  const semMini = [];
  for (const id of ids) {
    const m = resp.miniaturas && resp.miniaturas[id];
    if (m && m.b64) {
      const url = `data:${m.tipo};base64,${m.b64}`;
      cacheGravar('miniaturas', id, url);
      entregar(id, url);
    } else {
      semMini.push(id);
    }
  }
  // O Drive ainda não gerou a miniatura (fotos muito recentes): reduz a foto inteira aqui.
  for (const id of semMini) {
    try {
      const f = await foto(id);
      const url = await reduzir(f.url, 360, 0.72);
      cacheGravar('miniaturas', id, url);
      entregar(id, url);
    } catch (e) {
      entregarSemGuardar(id, null);
    }
  }
}

function entregarSemGuardar(id, url) {
  const r = miniEspera.get(id) || [];
  miniEspera.delete(id);
  r.forEach((fn) => fn(url));
}

// ---------------------------------------------------------------- fotos inteiras
const fotoMem = new Map(); // id -> Promise<{url, blob, tipo, nome, link}>
const MAX_FOTOS_MEM = 24;

export function foto(id) {
  if (fotoMem.has(id)) {
    const p = fotoMem.get(id);
    fotoMem.delete(id);
    fotoMem.set(id, p); // mais recente no fim
    return p;
  }
  const p = chamar('foto', { id }, 120000).then((r) => {
    const bytes = Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: r.tipo || 'image/jpeg' });
    return { url: URL.createObjectURL(blob), blob, tipo: r.tipo, nome: r.nome, link: r.link };
  });
  p.catch(() => fotoMem.delete(id));
  fotoMem.set(id, p);
  while (fotoMem.size > MAX_FOTOS_MEM) {
    const [velho, pv] = fotoMem.entries().next().value;
    fotoMem.delete(velho);
    pv.then((f) => URL.revokeObjectURL(f.url)).catch(() => {});
  }
  return p;
}

/** Reduz uma imagem para no máximo `lado` px e devolve data:image/jpeg. */
export function reduzir(url, lado, qualidade = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', qualidade));
    };
    img.onerror = () => reject(new Error('Imagem inválida'));
    img.src = url;
  });
}

/** Preenche <img data-mini="id"> quando aparecem na tela. */
const observador = 'IntersectionObserver' in window
  ? new IntersectionObserver((itens) => {
    itens.forEach((it) => {
      if (!it.isIntersecting) return;
      observador.unobserve(it.target);
      carregarMini(it.target);
    });
  }, { rootMargin: '200px' })
  : null;

export function observarMiniaturas(raiz) {
  raiz.querySelectorAll('img[data-mini]').forEach((img) => {
    if (img.dataset.ok) return;
    if (miniMem.has(img.dataset.mini)) { carregarMini(img); return; }
    if (observador) observador.observe(img); else carregarMini(img);
  });
}

function carregarMini(img) {
  const id = img.dataset.mini;
  miniatura(id).then((url) => {
    if (url && img.dataset.mini === id) {
      img.src = url;
      img.dataset.ok = '1';
      img.closest('.mini')?.classList.add('mini-ok');
    } else {
      img.closest('.mini')?.classList.add('mini-falhou');
    }
  });
}
