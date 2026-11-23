// Cadastros: setores (prazo e áreas), operadores, vendedores, facções e opções das listas
import { db } from '../estado.js';
import { AREAS } from '../config.js';
import { h, chip, ler, num, modal, toast, msgErro, limparCache } from '../util.js';
import { CAMPOS_LISTA } from '../pedido.js';

let aba = 'setores';
const ABAS = [['setores', 'Setores e prazos'], ['operadores', 'Operadores'], ['vendedores', 'Vendedores'], ['faccoes', 'Facções'], ['opcoes', 'Opções das listas']];
const CAMPOS_OPCAO = [...CAMPOS_LISTA, ['artigo', 'Artigo']];

export async function render(el) {
  el.innerHTML = `<div class="cab"><div><h1>Cadastros</h1><p>Somente administradores alteram.</p></div><button class="btn pri" id="novo">+ Novo</button></div>
    <div class="abas">${ABAS.map(([k, r]) => `<button data-a="${k}" class="${k === aba ? 'ativo' : ''}">${r}</button>`).join('')}</div><div id="conteudo-cad"></div>`;
  el.querySelectorAll('.abas button').forEach(b => b.onclick = () => { aba = b.dataset.a; render(el); });
  const box = el.querySelector('#conteudo-cad');
  const recarregar = () => { limparCache(); render(el); };
  if (aba === 'setores') {
    const lista = await ler(db.from('setores').select('*').order('ordem').order('nome'));
    box.innerHTML = `<p class="muted peq">Prazo = fração do prazo total (entrega − pedido) que o setor tem. Ex.: 0,25 = 25%. A previsão no setor = data da movimentação + dias totais × prazo (DESIGN-GRID limitado a 20 dias).</p>
      <div class="tabela-wrap"><table><thead><tr><th>Ordem</th><th>Setor</th><th>Prazo</th><th>Áreas (painéis)</th><th>Status</th><th></th></tr></thead><tbody>
      ${lista.map(s => `<tr><td>${s.ordem}</td><td class="forte">${h(s.nome)}</td><td>${s.prazo != null ? num(s.prazo * 100, 0) + '%' : '—'}</td>
        <td>${(s.areas || []).map(a => chip(a)).join(' ')}</td><td>${s.ativo ? chip('Ativo', 'ok') : chip('Inativo', 'erro')}</td>
        <td><button class="btn peq" data-ed="${s.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;
    const form = (s) => modal({
      titulo: s ? `Setor ${s.nome}` : 'Novo setor',
      corpo: `<form id="fs" class="grade">
        <label class="campo">Nome<input name="nome" required value="${h(s?.nome || '')}"></label>
        <div class="grade g2"><label class="campo">Prazo (%)<input name="prazo" type="number" step="0.1" min="0" max="100" value="${s?.prazo != null ? s.prazo * 100 : ''}"></label>
        <label class="campo">Ordem no fluxo<input name="ordem" type="number" value="${s?.ordem ?? 100}"></label></div>
        <div><b>Aparece nos painéis</b>${AREAS.map(([k, r]) => `<label style="display:block;margin:4px 0"><input type="checkbox" name="area" value="${k}" ${(s?.areas || []).includes(k) ? 'checked' : ''}> ${h(r)}</label>`).join('')}</div>
        <label><input type="checkbox" name="ativo" ${s?.ativo !== false ? 'checked' : ''}> Ativo</label></form>`,
      botoes: [{ texto: 'Cancelar' }, { texto: 'Salvar', classe: 'pri', acao: async (m) => {
        const f = m.querySelector('#fs'); if (!f.reportValidity()) return false;
        const v = { nome: f.nome.value.trim().toUpperCase(), prazo: f.prazo.value === '' ? null : Number(f.prazo.value) / 100,
          ordem: Number(f.ordem.value) || 100, areas: [...f.querySelectorAll('[name=area]:checked')].map(i => i.value), ativo: f.ativo.checked };
        const { error } = s ? await db.from('setores').update(v).eq('id', s.id) : await db.from('setores').insert(v);
        if (error) { toast(msgErro(error), 'erro'); return false; }
        toast('Setor salvo.', 'ok'); recarregar();
      } }]
    });
    el.querySelector('#novo').onclick = () => form(null);
    box.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => form(lista.find(s => String(s.id) === b.dataset.ed)));
    return;
  }
  if (aba === 'opcoes') {
    const lista = await ler(db.from('opcoes').select('*').order('campo').order('valor'));
    box.innerHTML = `<p class="muted peq">Valores sugeridos nos campos de lista do pedido. Desative o que estiver errado ou repetido; o pedido antigo não muda.</p>
      ${CAMPOS_OPCAO.map(([k, r]) => `<div class="card"><h3>${h(r)}</h3><div style="display:flex;gap:6px;flex-wrap:wrap">
        ${lista.filter(o => o.campo === k).map(o => `<button class="btn peq ${o.ativo ? '' : 'perigo'}" data-c="${k}" data-v="${h(o.valor)}" title="${o.ativo ? 'Clique para desativar' : 'Clique para reativar'}">${h(o.valor)}${o.ativo ? '' : ' (inativo)'}</button>`).join('')}
      </div></div>`).join('')}`;
    box.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => {
      const o = lista.find(x => x.campo === b.dataset.c && x.valor === b.dataset.v);
      const { error } = await db.from('opcoes').update({ ativo: !o.ativo }).eq('campo', o.campo).eq('valor', o.valor);
      if (error) return toast(msgErro(error), 'erro');
      recarregar();
    });
    el.querySelector('#novo').onclick = () => modal({
      titulo: 'Nova opção', corpo: `<form id="fo" class="grade"><label class="campo">Campo<select name="c">${CAMPOS_OPCAO.map(([k, r]) => `<option value="${k}">${h(r)}</option>`).join('')}</select></label>
        <label class="campo">Valor<input name="v" required></label></form>`,
      botoes: [{ texto: 'Cancelar' }, { texto: 'Salvar', classe: 'pri', acao: async (m) => {
        const f = m.querySelector('#fo'); if (!f.reportValidity()) return false;
        const { error } = await db.from('opcoes').insert({ campo: f.c.value, valor: f.v.value.trim().toUpperCase() });
        if (error) { toast(msgErro(error), 'erro'); return false; }
        recarregar();
      } }]
    });
    return;
  }
  // operadores, vendedores, facções: nome + ativo
  const lista = await ler(db.from(aba).select('*').order('ativo', { ascending: false }).order('nome'));
  box.innerHTML = `<div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>Status</th><th></th></tr></thead><tbody>
    ${lista.map(x => `<tr><td class="forte">${h(x.nome)}</td><td>${x.ativo ? chip('Ativo', 'ok') : chip('Inativo', 'erro')}</td>
      <td><button class="btn peq" data-ed="${x.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;
  const form = (x) => modal({
    titulo: x ? `Editar ${x.nome}` : 'Novo',
    corpo: `<form id="fn" class="grade"><label class="campo">Nome<input name="nome" required value="${h(x?.nome || '')}"></label>
      <label><input type="checkbox" name="ativo" ${x?.ativo !== false ? 'checked' : ''}> Ativo (aparece nas listas)</label></form>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Salvar', classe: 'pri', acao: async (m) => {
      const f = m.querySelector('#fn'); if (!f.reportValidity()) return false;
      const v = { nome: f.nome.value.trim().toUpperCase(), ativo: f.ativo.checked };
      const { error } = x ? await db.from(aba).update(v).eq('id', x.id) : await db.from(aba).insert(v);
      if (error) { toast(msgErro(error), 'erro'); return false; }
      toast('Salvo.', 'ok'); recarregar();
    } }]
  });
  el.querySelector('#novo').onclick = () => form(null);
  box.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => form(lista.find(x => String(x.id) === b.dataset.ed)));
}
