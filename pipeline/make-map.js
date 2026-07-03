// Fase 2b — Genera data/game/mapa-piloto.html: diagrama visual del grafo piloto
// (niveles y flechas de conexión) para consulta del autor. Se regenera con:
//   node pipeline/make-map.js

const fs = require('fs');
const path = require('path');

const levels = require(path.join(__dirname, '..', 'data', 'game', 'levels.es.json'));
const OUT = path.join(__dirname, '..', 'data', 'game', 'mapa-piloto.html');

// BFS por capas desde level-0 para colocar columnas
const depth = { 'level-0': 0 };
const q = ['level-0'];
while (q.length) {
  const u = q.shift();
  for (const s of levels[u].salidas) {
    const v = s.destino;
    if (v && levels[v] && depth[v] === undefined) {
      depth[v] = depth[u] + 1;
      q.push(v);
    }
  }
}
for (const id of Object.keys(levels)) if (depth[id] === undefined) depth[id] = 3;

// agrupa por columna
const cols = {};
for (const [id, d] of Object.entries(depth)) (cols[d] ??= []).push(id);
const maxD = Math.max(...Object.keys(cols).map(Number));

const NW = 190, NH = 64, GX = 130, GY = 26;
const pos = {};
let maxRows = 0;
for (let d = 0; d <= maxD; d++) {
  const list = (cols[d] ?? []).sort((a, b) => levels[a].peligro - levels[b].peligro);
  maxRows = Math.max(maxRows, list.length);
  list.forEach((id, i) => {
    pos[id] = { x: 40 + d * (NW + GX), y: 40 + i * (NH + GY) };
  });
}
const W = 40 * 2 + (maxD + 1) * (NW + GX);
const H = 80 + maxRows * (NH + GY);

const colorPeligro = (p) =>
  ['#3fae6a', '#8bb944', '#d9a531', '#e0742c', '#d94a35', '#a12744'][Math.max(0, Math.min(5, p))];

let edges = '';
let nodes = '';
for (const [id, lv] of Object.entries(levels)) {
  const p = pos[id];
  for (const s of lv.salidas) {
    if (!s.destino || !levels[s.destino]) continue;
    const t = pos[s.destino];
    const x1 = p.x + NW, y1 = p.y + NH / 2, x2 = t.x, y2 = t.y + NH / 2;
    const back = t.x <= p.x;
    const mx = back ? Math.max(x1, x2 + NW) + 60 : (x1 + x2) / 2;
    const dashed = s.tipo === 'rara' || s.tipo === 'arriesgada' || s.tipo === 'llave';
    const col = back ? '#b08a4a88' : '#8a8a9a99';
    edges += back
      ? `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2 + NW} ${y2}" fill="none" stroke="${col}" stroke-width="1.6" ${dashed ? 'stroke-dasharray="6 4"' : ''} marker-end="url(#ab)"/>`
      : `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="${col}" stroke-width="1.6" ${dashed ? 'stroke-dasharray="6 4"' : ''} marker-end="url(#af)"/>`;
  }
  const esc = lv.esEscape;
  nodes += `<g transform="translate(${p.x},${p.y})">
    <rect width="${NW}" height="${NH}" rx="10" fill="${esc ? '#1d3a2a' : '#1c1c24'}" stroke="${esc ? '#4ade80' : colorPeligro(lv.peligro)}" stroke-width="${esc ? 3 : 2}"/>
    <text x="12" y="24" fill="#f0ead6" font-size="14" font-weight="700">${lv.wikiTitle}${esc ? ' ⭐' : ''}</text>
    <text x="12" y="42" fill="#b8b2a0" font-size="11">${(lv.nombre.split('«')[1] ?? '').replace('»', '') || lv.clase.split('·')[0].trim()}</text>
    <text x="12" y="56" fill="${colorPeligro(lv.peligro)}" font-size="10" font-weight="600">Peligro ${lv.peligro}/5 · ${lv.bioma}</text>
  </g>`;
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>Mapa del piloto — Backrooms</title>
<style>
 body{background:#0e0e12;color:#f0ead6;font-family:Segoe UI,system-ui,sans-serif;margin:0;padding:24px}
 h1{font-size:20px;margin:0 0 4px} p{color:#b8b2a0;margin:0 0 16px;font-size:13px}
 .leg{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;margin-bottom:16px}
 .leg span{display:inline-flex;align-items:center;gap:6px}
 .dot{width:12px;height:12px;border-radius:3px;display:inline-block}
 .wrap{overflow:auto;border:1px solid #2a2a34;border-radius:12px;background:#121218}
</style>
<h1>🚪 Mapa de niveles del piloto — Backrooms roguelike</h1>
<p>Flechas continuas = salidas normales · discontinuas = raras/arriesgadas/con llave · flechas doradas = caminos de vuelta.
Todos los niveles permiten además «volver sobre tus pasos» al nivel anterior. ⭐ = nivel de escape (victoria).</p>
<div class="leg">
 ${[0,1,2,3,4,5].map(pn=>`<span><i class="dot" style="background:${colorPeligro(pn)}"></i>Peligro ${pn}</span>`).join('')}
</div>
<div class="wrap">
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
 <defs>
  <marker id="af" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#8a8a9a"/></marker>
  <marker id="ab" markerWidth="9" markerHeight="9" refX="1" refY="4.5" orient="auto"><path d="M9,0 L0,4.5 L9,9 z" fill="#b08a4a"/></marker>
 </defs>
 ${edges}
 ${nodes}
</svg>
</div>`;

fs.writeFileSync(OUT, html);
console.log('Mapa generado:', OUT, `(${Object.keys(levels).length} niveles)`);
