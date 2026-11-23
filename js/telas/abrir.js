// Abre um pedido pelo número da OP (#/p/5087) — é para onde aponta o QR Code da OP impressa.
import { db } from '../estado.js';
import { h, ler } from '../util.js';
import { abrirPedido } from '../pedido.js';

export async function render(el) {
  const ref = decodeURIComponent(location.hash.replace(/^#\/p\//, '')).trim();
  const numero = Number(ref.replace(/\D/g, ''));
  el.innerHTML = `<div class="vazio"><div class="spinner" style="margin:auto"></div><p>Abrindo OP ${h(ref)}…</p></div>`;
  const [p] = numero ? await ler(db.from('pedidos').select('id, numero, ordem').eq('numero', numero)) : [];
  if (!p) { el.innerHTML = `<div class="card erro-box">OP ${h(ref)} não encontrada.</div>`; return; }
  const mod = await import('./pedidos.js');
  await mod.render(el);
  abrirPedido(p.id);
}
