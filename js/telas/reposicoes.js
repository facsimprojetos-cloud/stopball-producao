// Reposições (peças a refazer), antiga view REPOSIÇÃO
import { db } from '../estado.js';
import { h, chip, ler, num, data, toast, msgErro } from '../util.js';
import { abrirPedido } from '../pedido.js';

let status = 'AGUARDANDO';

export async function render(el) {
  const lista = await ler(db.from('reposicoes').select('*, pedidos(id, ordem, lote, artigo, data_entrega, setores(nome))')
    .eq('status', status).order('criado_em', { ascending: status === 'AGUARDANDO' }).limit(300));
  el.innerHTML = `
    <div class="cab"><div><h1>Reposições</h1><p>Peças a refazer. Para registrar uma nova, abra o pedido e use “+ Reposição”.</p></div></div>
    <div class="abas">${[['AGUARDANDO', 'Aguardando'], ['REALIZADO', 'Realizadas (últimas 300)']].map(([k, r]) =>
      `<button data-s="${k}" class="${k === status ? 'ativo' : ''}">${r}</button>`).join('')}</div>
    <div class="lista-cards">${lista.map(r => `
      <div class="item">
        <div class="linha1"><div><div class="tit"><a href="#" data-ped="${r.pedidos?.id}">${h(r.pedidos?.ordem || '')}</a>${r.pedidos?.lote ? ' · ' + h(r.pedidos.lote) : ''}</div>
          <div class="det">${h(r.pedidos?.artigo || '')} · setor ${h(r.pedidos?.setores?.nome || '')} · entrega ${data(r.pedidos?.data_entrega)}</div></div>
          ${r.status === 'REALIZADO' ? chip('Realizado', 'ok') : chip('Aguardando', 'alerta')}</div>
        <div style="white-space:pre-wrap;margin-top:8px;max-height:180px;overflow:auto" class="peq">${h(r.descricao || '')}</div>
        <div class="det" style="margin-top:6px">${r.perda_kg != null ? `Perda: <b>${num(r.perda_kg, 3)} kg</b> · ` : ''}${r.codigo ? 'Cód. ' + h(r.codigo) + ' · ' : ''}registrada em ${data(r.criado_em)}</div>
        ${r.status !== 'REALIZADO' ? `<div class="acoes-card"><button class="btn peq pri" data-real="${r.id}">Marcar como realizada</button></div>` : ''}
      </div>`).join('') || '<div class="vazio">Nenhuma reposição.</div>'}</div>`;
  el.querySelectorAll('.abas button').forEach(b => b.onclick = () => { status = b.dataset.s; render(el); });
  el.querySelectorAll('[data-ped]').forEach(a => a.onclick = (e) => { e.preventDefault(); abrirPedido(a.dataset.ped, () => render(el)); });
  el.querySelectorAll('[data-real]').forEach(b => b.onclick = async () => {
    const { error } = await db.rpc('realizar_reposicao', { p_id: b.dataset.real });
    if (error) return toast(msgErro(error), 'erro');
    toast('Reposição realizada.', 'ok'); render(el);
  });
}
