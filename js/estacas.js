// Base de estacas completa (a mesma do app): estaca mais próxima de uma coordenada.
import { fmtEstaca } from './formatos.js';

export class BaseEstacas {
  constructor(json) {
    this.versao = json.v;
    this.eixos = json.eixos;
    this.s = json.s;
    this.rows = json.r;
    const n = json.r.length;
    this.n = n;
    this.lat = new Float64Array(n);
    this.lon = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.lat[i] = json.r[i][0] / 1e6;
      this.lon[i] = json.r[i][1] / 1e6;
    }
  }

  static dist(lat1, lon1, lat2, lon2) {
    const k = Math.PI / 180;
    const x = (lon2 - lon1) * k * Math.cos(((lat1 + lat2) / 2) * k);
    const y = (lat2 - lat1) * k;
    return Math.sqrt(x * x + y * y) * 6371008.8;
  }

  /** Ponto da estaca (em metros) no eixo indicado (ou no primeiro eixo). Devolve { lat, lon, distEstaca } ou null. */
  porEstaca(m, nomeEixo) {
    let e = nomeEixo ? this.eixos.indexOf(nomeEixo) : 0;
    if (e < 0) e = 0;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.n; i++) {
      const r = this.rows[i];
      if (r[3] !== e) continue;
      const d = Math.abs(r[2] - m);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0 || bestD > 50) return null;
    return { lat: this.lat[best], lon: this.lon[best], distEstaca: bestD };
  }

  maisProxima(lat, lon) {
    let best = -1;
    let bestD = Infinity;
    const c = Math.cos((lat * Math.PI) / 180);
    for (let i = 0; i < this.n; i++) {
      const dy = this.lat[i] - lat;
      const dx = (this.lon[i] - lon) * c;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    if (best < 0) return null;
    const r = this.rows[best];
    const s = this.s;
    return {
      eixo: this.eixos[r[3]],
      estacaM: r[2],
      estaca: fmtEstaca(r[2]),
      pacote: r[4],
      segmento: s[r[5]],
      cidade: s[r[6]],
      infra: s[r[7]],
      super: s[r[8]],
      oae: s[r[9]],
      distancia: BaseEstacas.dist(lat, lon, this.lat[best], this.lon[best]),
    };
  }
}
