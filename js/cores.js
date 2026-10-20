// Cores dos pontos no mapa (escolhidas para aparecer bem sobre imagem de satélite e sobre mapa claro).

const PALETA = {
  Terraplenagem: '#E0A030',
  Drenagem: '#2F8FE0',
  OAE: '#A274F0',
  PN: '#E5484D',
  Bueiro: '#1FB8B0',
  Superestrutura: '#5DBB46',
  'Segurança': '#FF7A1A',
};
const EXTRA = ['#F06BB0', '#8C9EFF', '#C9A26B', '#4FD1C5', '#B9E05A', '#F4A3A3'];
export const SEM_CATEGORIA = 'Sem categoria';
const COR_SEM = '#9AA0A6';

const atribuidas = {};
let proxima = 0;

export function corCategoria(cat) {
  if (!cat || cat === SEM_CATEGORIA) return COR_SEM;
  if (PALETA[cat]) return PALETA[cat];
  if (!atribuidas[cat]) atribuidas[cat] = EXTRA[proxima++ % EXTRA.length];
  return atribuidas[cat];
}

export const COR_DENTRO = '#2BB673';
export const COR_FORA = '#FF7A1A';

export function corRegistro(r, modo) {
  if (modo === 'situacao') return r.fora ? COR_FORA : COR_DENTRO;
  return corCategoria(r.cat);
}
