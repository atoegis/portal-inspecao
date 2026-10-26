// Comunicação com o servidor (Apps Script) e cache local no navegador.

let codigo = '';

export function definirCodigo(c) { codigo = String(c || '').trim(); }

export async function chamar(action, dados = {}, timeoutMs = 90000) {
  const url = window.PORTAL_CONFIG && window.PORTAL_CONFIG.apiUrl;
  if (!url) throw new Error('O endereço do servidor não está configurado em js/config.js.');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita a consulta prévia de CORS no Apps Script
      body: JSON.stringify({ action, codigo, ...dados }),
      signal: ctrl.signal,
      redirect: 'follow',
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError'
      ? 'O servidor demorou demais para responder. Tente de novo.'
      : 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  } finally {
    clearTimeout(t);
  }
  if (!resp.ok) throw new Error(`O servidor respondeu com erro ${resp.status}.`);
  let json;
  try {
    json = await resp.json();
  } catch (e) {
    throw new Error('O servidor respondeu algo inesperado. Confira se o script foi atualizado com a versão do portal.');
  }
  if (!json.ok) {
    const err = new Error(MENSAGENS[json.erro] || json.erro || 'Erro no servidor.');
    err.codigo = json.erro;
    throw err;
  }
  return json;
}

const MENSAGENS = {
  CODIGO_INVALIDO: 'Código não reconhecido. Confira o código na aba Equipes da planilha.',
  ACAO_DESCONHECIDA: 'O script do Google ainda é a versão antiga, sem o portal. Atualize o Code.gs e publique uma nova versão.',
  FOTO_NAO_ENCONTRADA: 'Esta foto não está mais registrada na planilha.',
  SOMENTE_EQUIPE: 'Para carregar vídeos é preciso o código da equipe.',
  SESSAO_EXPIRADA: 'A sessão de envio expirou. Comece o envio de novo.',
  VIDEO_NAO_ENCONTRADO: 'Este vídeo não está mais registrado na planilha.',
  EQUIPE_OBRIGATORIA: 'Escolha a equipe para enviar.',
  RELATORIO_DE_OUTRA_EQUIPE: 'Este relatório é de outra equipe.',
};

// ---------------------------------------------------------------- IndexedDB (cache)
const NOME_DB = 'portal-inspecao';
let dbPromessa = null;

function abrir() {
  if (dbPromessa) return dbPromessa;
  dbPromessa = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(NOME_DB, 1);
    } catch (e) {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('miniaturas')) db.createObjectStore('miniaturas');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromessa;
}

export async function cacheLer(store, chave) {
  const db = await abrir();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const r = db.transaction(store).objectStore(store).get(chave);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    } catch (e) {
      resolve(undefined);
    }
  });
}

export async function cacheGravar(store, chave, valor) {
  const db = await abrir();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(valor, chave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
}

export async function cacheLimpar() {
  const db = await abrir();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(['kv', 'miniaturas'], 'readwrite');
      tx.objectStore('kv').clear();
      tx.objectStore('miniaturas').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
}

// ---------------------------------------------------------------- armazenamento simples
export const local = {
  ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  gravar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento */ } },
  apagar(k) { try { localStorage.removeItem(k); } catch (e) { /* sem armazenamento */ } },
};
