// Lista geral de pedidos (antiga view GESTÃO)
import { db } from '../estado.js';
import { h, chip, ler, num, data, cadastros, opcoes, toast, msgErro } from '../util.js';
import { abrirPedido, formPedido, podeEditar, chipPrazo, imprimirOPs } from '../pedido.js';

const POR_PAGINA = 100;
const f = { busca: '', setor: '', vendedor: '', prazo: '', encerrados: false, pagina: 0 };
const selecionados = new Map(); // id → pedido (mantém a seleção ao trocar de página/filtro)

export async function render(el) {
  const c = await cadastros(db);
  el.innerHTML = `
    <div class="cab"><div><h1>Pedidos</h1><p>Todos os pedidos. Por padrão, esconde os que estão em EXPEDIÇÃO e ENTREGUE.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="ops" disabled>🖨 Imprimir OPs</button>
      ${podeEditar() ? '<button class="btn pri" id="novo">+ Novo pedido</button>' : ''}</div></div>
    <form class="filtros" id="ff">
      <label class="campo">Buscar<input name="busca" value="${h(f.busca)}" placeholder="nº da OP, ordem, cliente, lote…"></label>
      <label class="campo">Setor<select name="setor">${opcoes(c.setores, f.setor, 'nome', 'id', 'Todos')}</select></label>
      <label class="campo">Vendedor<select name="vendedor">${opcoes(c.vendedores, f.vendedor, 'nome', 'id', 'Todos')}</select></label>
      <label class="campo">Prazo no setor<select name="prazo"><option value="">Todos</option>
        ${['ATRASADO', 'VENCE HOJE', 'NO PRAZO'].map(x => `<option ${f.prazo === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label style="align-self:center"><input type="checkbox" name="encerrados" ${f.encerrados ? 'checked' : ''}> Incluir expedição/entregues</label>
      <button class="btn" type="submit">Filtrar</button>
    </form>
    <div id="res"><div class="vazio"><div class="spinner" style="margin:auto"></div></div></div>`;
  el.querySelector('#novo')?.addEventListener('click', () => formPedido(null, (id) => { render(el); abrirPedido(id); }));
  const btOps = el.querySelector('#ops');
  const atualizarOps = () => { btOps.disabled = !selecionados.size; btOps.textContent = selecionados.size ? `🖨 Imprimir ${selecionados.size} OP(s)` : '🖨 Imprimir OPs'; };
  btOps.onclick = () => imprimirOPs([...selecionados.values()]);
  atualizarOps();
  const form = el.querySelector('#ff');
  form.onsubmit = (e) => {
    e.preventDefault();
    Object.assign(f, { busca: form.busca.value.trim(), setor: form.setor.value, vendedor: form.vendedor.value,
      prazo: form.prazo.value, encerrados: form.encerrados.checked, pagina: 0 });
    carregar();
  };
  const encerradosIds = c.setores.filter(s => ['EXPEDIÇÃO', 'ENTREGUE'].includes(s.nome)).map(s => s.id);

  async function carregar() {
    const res = el.querySelector('#res');
    let q = db.from('v_pedidos').select('id,numero,ordem,lote,artigo,qtd,vendedor,cliente,setor,setor_id,data_pedido,data_entrega,previsao_setor,prazo_status,faccao,inicio_setor,operador', { count: 'exact' });
    if (f.busca) {
      const t = f.busca.replace(/[,()%]/g, ' '); const n = /^\s*(op\s*)?\d+\s*$/i.test(t) ? Number(t.replace(/\D/g, '')) : null;
      q = q.or(`ordem.ilike.%${t}%,cliente.ilike.%${t}%,lote.ilike.%${t}%,artigo.ilike.%${t}%${n ? `,numero.eq.${n}` : ''}`);
    }
    if (f.setor) q = q.eq('setor_id', f.setor);
    else if (!f.encerrados && encerradosIds.length) q = q.not('setor_id', 'in', `(${encerradosIds.join(',')})`);
    if (f.vendedor) q = q.eq('vendedor_id', f.vendedor);
    if (f.prazo) q = q.eq('prazo_status', f.prazo);
    q = q.order('data_entrega', { ascending: true, nullsFirst: false }).range(f.pagina * POR_PAGINA, f.pagina * POR_PAGINA + POR_PAGINA - 1);
    const { data: lista, count, error } = await q;
    if (error) { res.innerHTML = `<div class="erro-box">${h(msgErro(error))}</div>`; return; }
    const paginas = Math.max(1, Math.ceil((count || 0) / POR_PAGINA));
    res.innerHTML = `<div class="muted peq" style="margin-bottom:6px">${num(count)} pedido(s)</div>
      <div class="tabela-wrap"><table class="clicavel"><thead><tr><th style="width:34px"><input type="checkbox" id="sel-todos" title="Selecionar todos desta página"></th><th>OP</th><th>Ordem</th><th>Lote</th><th>Artigo</th><th>Qtd</th><th>Vendedor</th>
        <th>Setor</th><th>Prazo no setor</th><th>Entrega</th><th>Facção</th></tr></thead>
      <tbody>${lista.map(p => `<tr data-id="${p.id}"><td class="sel"><input type="checkbox" data-sel="${p.id}" ${selecionados.has(p.id) ? 'checked' : ''}></td><td class="muted">${String(p.numero).padStart(5, '0')}</td><td class="forte">${h(p.ordem)}</td><td>${h(p.lote || '')}</td><td>${h(p.artigo || '')}</td>
        <td>${num(p.qtd)}</td><td>${h(p.vendedor || '')}</td><td>${chip(p.setor, 'acento')}${p.inicio_setor ? ' ' + chip('em andamento', 'info') : ''}</td>
        <td>${chipPrazo(p)}</td><td>${data(p.data_entrega)}</td><td>${h(p.faccao || '')}</td></tr>`).join('') || '<tr><td colspan="11" class="vazio">Nada encontrado.</td></tr>'}</tbody></table></div>
      <div style="display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:8px">
        <button class="btn peq" id="ant" ${f.pagina === 0 ? 'disabled' : ''}>‹ Anterior</button>
        <span class="muted peq">Página ${f.pagina + 1} de ${paginas}</span>
        <button class="btn peq" id="prox" ${f.pagina + 1 >= paginas ? 'disabled' : ''}>Próxima ›</button></div>`;
    res.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = (e) => { if (!e.target.closest('td.sel')) abrirPedido(tr.dataset.id, carregar); });
    const marcar = (cb) => { const p = lista.find(x => x.id === cb.dataset.sel); cb.checked ? selecionados.set(p.id, p) : selecionados.delete(p.id); };
    res.querySelectorAll('[data-sel]').forEach(cb => cb.onchange = () => { marcar(cb); atualizarOps(); });
    res.querySelector('#sel-todos').onchange = (e) => { res.querySelectorAll('[data-sel]').forEach(cb => { cb.checked = e.target.checked; marcar(cb); }); atualizarOps(); };
    res.querySelector('.muted.peq').insertAdjacentHTML('beforeend', selecionados.size ? ` · ${selecionados.size} selecionado(s) <a href="#" id="limpar-sel">limpar seleção</a>` : '');
    res.querySelector('#limpar-sel')?.addEventListener('click', (e) => { e.preventDefault(); selecionados.clear(); atualizarOps(); carregar(); });
    res.querySelector('#ant').onclick = () => { f.pagina--; carregar(); };
    res.querySelector('#prox').onclick = () => { f.pagina++; carregar(); };
  }
  carregar();
}
