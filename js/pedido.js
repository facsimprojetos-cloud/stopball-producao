// Pedido: detalhes, ações (iniciar, finalizar, facção, dividir…), formulário, reposições e OP.
import { db, ctx, tem } from './estado.js';
import { BUCKET, PASTA_APPSHEET, AREAS } from './config.js';
import { h, chip, modal, toast, msgErro, ler, data, dataHora, num, cadastros, limparCache, ativos, opcoes,
  confirmar, imprimirHtml, nomeArquivo, hojeISO, qrSvg } from './util.js';
import { abrirChecklist, seloChecklist, checklistOk, ehGrid } from './checklist.js';
export { abrirChecklist, seloChecklist };

export const CAMPOS_LISTA = [
  ['linha', 'Linha'], ['costura', 'Costura'], ['manga', 'Manga'], ['escudos', 'Escudos'], ['tecidos', 'Tecidos'],
  ['gola', 'Gola'], ['codigo_gola', 'Código da gola'], ['cor', 'Cor'], ['cor_meiao', 'Cor do meião'],
];

// ---------- regras de tela ----------
export const podeMover = (p) => tem('admin') || (p.areas || []).some(a => ctx.perfis.includes(a));
export const podeEditar = () => tem('pedidos');

export function chipPrazo(p) {
  if (!p.previsao_setor) return '';
  const t = { 'ATRASADO': 'erro', 'VENCE HOJE': 'alerta', 'NO PRAZO': 'ok' }[p.prazo_status] || '';
  return chip(`${p.prazo_status} · ${data(p.previsao_setor)}`, t);
}
export function chipSituacao(p) {
  return p.inicio_setor ? chip(`Em andamento · ${p.operador || ''}`, 'info') : chip('Na fila');
}
export const resumoEspec = (p) => CAMPOS_LISTA.filter(([k]) => (p[k] || []).length && ['linha', 'tecidos', 'gola', 'escudos'].includes(k))
  .map(([k, r]) => `${r}: ${p[k].join(', ')}`).join(' · ');

export async function buscarPedido(id) {
  const [p] = await ler(db.from('v_pedidos').select('*').eq('id', id));
  if (!p) throw new Error('Pedido não encontrado.');
  return p;
}

// ---------- arquivo ----------
export async function abrirArquivo(caminho) {
  if (!caminho) return;
  if (/^https?:/i.test(caminho)) return window.open(caminho, '_blank');
  if (caminho.startsWith('GESTÃO_Files_/') || caminho.includes('_Files_/')) {
    // arquivo antigo do AppSheet: fica na pasta do app no Google Drive
    return window.open(PASTA_APPSHEET + encodeURIComponent(caminho.split('/').pop()), '_blank');
  }
  const { data: d, error } = await db.storage.from(BUCKET).createSignedUrl(caminho, 3600);
  if (error) return toast(msgErro(error), 'erro');
  window.open(d.signedUrl, '_blank');
}
async function enviarArquivo(file, pasta) {
  const nome = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_');
  const caminho = `${pasta}/${Date.now()}_${nome}`;
  const { error } = await db.storage.from(BUCKET).upload(caminho, file, { upsert: false });
  if (error) throw error;
  return caminho;
}

// ---------- ações de setor ----------
export async function iniciar(pedidos, depois) {
  const lista = [].concat(pedidos);
  const c = await cadastros(db);
  modal({
    titulo: lista.length > 1 ? `Iniciar ${lista.length} pedidos` : `Iniciar · ${lista[0].ordem}`,
    corpo: `<form id="fi" class="grade">
      <div class="muted">Setor: <b>${h(lista[0].setor)}</b>${lista.length > 1 ? ` · ${lista.map(p => h(p.ordem)).join(', ')}` : ''}</div>
      <label class="campo">Operador<select name="op" required>${opcoes(ativos(c.operadores), '', 'nome')}</select></label>
    </form>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Iniciar', classe: 'pri', acao: async (m) => {
      const f = m.querySelector('#fi'); if (!f.reportValidity()) return false;
      let ok = 0;
      for (const p of lista) {
        const { error } = await db.rpc('iniciar_setor', { p_pedido: p.id, p_operador: Number(f.op.value) });
        if (error) toast(`${p.ordem}: ${msgErro(error)}`, 'erro'); else ok++;
      }
      if (ok) toast(ok > 1 ? `${ok} pedidos iniciados.` : 'Setor iniciado.', 'ok');
      depois && depois();
    } }]
  });
}

export async function finalizar(pedidos, depois, sugerido = null) {
  const lista = [].concat(pedidos);
  const semCk = lista.filter(p => ehGrid(p) && !checklistOk(p));
  if (semCk.length) {
    toast(semCk.length > 1 ? `${semCk.length} pedidos estão sem o checklist do grid concluído.` : 'Conclua o checklist do grid antes de finalizar o DESIGN-GRID.', 'erro');
    if (semCk.length === 1) abrirChecklist(semCk[0], depois);
    return;
  }
  const c = await cadastros(db);
  const setores = ativos(c.setores).filter(s => s.id !== lista[0].setor_id);
  const grupos = AREAS.map(([k, r]) => [r, setores.filter(s => (s.areas || [])[0] === k)]).filter(([, l]) => l.length);
  const soltos = setores.filter(s => !(s.areas || []).length);
  const opts = '<option value="">Escolha o próximo setor…</option>' + grupos.map(([r, l]) =>
    `<optgroup label="${h(r)}">${l.map(s => `<option value="${s.id}" ${s.id === sugerido ? 'selected' : ''}>${h(s.nome)}</option>`).join('')}</optgroup>`).join('') +
    soltos.map(s => `<option value="${s.id}" ${s.id === sugerido ? 'selected' : ''}>${h(s.nome)}</option>`).join('');
  modal({
    titulo: lista.length > 1 ? `Finalizar ${lista.length} pedidos` : `Finalizar ${lista[0].setor} · ${lista[0].ordem}`,
    corpo: `<form id="ff" class="grade">
      <p class="muted" style="margin:0">Grava o apontamento do setor <b>${h(lista[0].setor)}</b> (início, fim agora, operador e quantidade), passa o pedido para o próximo setor e recalcula a previsão.</p>
      <label class="campo">Próximo setor<select name="prox" required>${opts}</select></label>
      ${lista.length === 1 ? `<label class="campo">Quantidade feita <input name="qtd" type="number" min="0" step="1" value="${h(lista[0].qtd ?? '')}"></label>` : ''}
    </form>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Finalizar', classe: 'pri', acao: async (m) => {
      const f = m.querySelector('#ff'); if (!f.reportValidity()) return false;
      let ok = 0;
      for (const p of lista) {
        const qtd = f.qtd && f.qtd.value !== '' ? Number(f.qtd.value) : null;
        const { error } = await db.rpc('finalizar_setor', { p_pedido: p.id, p_proximo_setor: Number(f.prox.value), p_qtd: qtd });
        if (error) toast(`${p.ordem}: ${msgErro(error)}`, 'erro'); else ok++;
      }
      if (ok) toast(ok > 1 ? `${ok} pedidos finalizados.` : 'Setor finalizado.', 'ok');
      depois && depois();
    } }]
  });
}

async function escolherFaccao(p, dividir, depois) {
  const c = await cadastros(db);
  modal({
    titulo: dividir ? `Dividir pedido · ${p.ordem}` : `Facção · ${p.ordem}`,
    corpo: `<form id="fc" class="grade">
      ${dividir ? '<p class="muted" style="margin:0">Cria uma cópia do pedido (marcada como dividida) para outra facção. Ajuste depois a quantidade de cada parte em Editar.</p>' : ''}
      <label class="campo">Facção<select name="f" ${dividir ? 'required' : ''}>${opcoes(ativos(c.faccoes, p.faccao_id), dividir ? '' : p.faccao_id, 'nome', 'id', dividir ? 'Selecione…' : 'Aguardando facção')}</select></label>
    </form>`,
    botoes: [{ texto: 'Cancelar' }, { texto: dividir ? 'Dividir' : 'Salvar', classe: 'pri', acao: async (m) => {
      const f = m.querySelector('#fc'); if (!f.reportValidity()) return false;
      const fac = f.f.value ? Number(f.f.value) : null;
      const { error } = await db.rpc(dividir ? 'dividir_pedido' : 'definir_faccao', { p_pedido: p.id, p_faccao: fac });
      if (error) { toast(msgErro(error), 'erro'); return false; }
      toast(dividir ? 'Pedido dividido.' : 'Facção salva.', 'ok'); depois && depois();
    } }]
  });
}

async function moverManual(p, depois) {
  const c = await cadastros(db);
  modal({
    titulo: `Corrigir setor · ${p.ordem}`,
    corpo: `<form id="fm" class="grade"><p class="muted" style="margin:0">Muda o setor sem gravar apontamento. Use só para corrigir erros.</p>
      <label class="campo">Setor<select name="s" required>${opcoes(ativos(c.setores, p.setor_id), p.setor_id, 'nome')}</select></label></form>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Salvar', classe: 'pri', acao: async (m) => {
      const { error } = await db.rpc('mover_sem_apontamento', { p_pedido: p.id, p_proximo_setor: Number(m.querySelector('[name=s]').value) });
      if (error) { toast(msgErro(error), 'erro'); return false; }
      toast('Setor corrigido.', 'ok'); depois && depois();
    } }]
  });
}

// ---------- detalhes ----------
export async function abrirPedido(id, depois) {
  let p;
  try { p = await buscarPedido(id); } catch (e) { return toast(e.message, 'erro'); }
  const [reps, aps] = await Promise.all([
    ler(db.from('reposicoes').select('*').eq('pedido_id', id).order('criado_em', { ascending: false })),
    ler(db.from('apontamentos').select('*, setores(nome), operadores(nome)').eq('pedido_id', id).order('fim', { ascending: false })),
  ]);
  const atualizar = () => { m.fechar(); abrirPedido(id, depois); depois && depois(); };
  const linha = (r, v) => v ? `<div><span class="muted peq">${h(r)}</span><div>${v}</div></div>` : '';
  const espec = CAMPOS_LISTA.map(([k, r]) => linha(r, (p[k] || []).map(x => chip(x)).join(' '))).join('');
  const design = (p.areas || []).includes('design');
  const chk = (v) => v === true ? '✅' : v === false ? '❌' : '—';
  const m = modal({
    titulo: `OP ${numOP(p)} · ${p.ordem}${p.lote ? ' · lote ' + p.lote : ''}`, largo: true,
    corpo: `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${chip(p.setor, 'acento')} ${chipSituacao(p)} ${chipPrazo(p)}
        ${p.dividido ? chip('Dividido (DIV2)', 'info') : ''} ${p.outros_da_ordem ? chip(`+${p.outros_da_ordem} pedido(s) da mesma ordem em aberto`, 'alerta') : ''}</div>
      <div class="grade g3">
        ${linha('Artigo', h(p.artigo || ''))}${linha('Quantidade', num(p.qtd))}${linha('Vendedor', h(p.vendedor || ''))}
        ${linha('Cliente', h(p.cliente || ''))}${linha('Data do pedido', data(p.data_pedido))}${linha('Data de entrega', `<b>${data(p.data_entrega)}</b>`)}
        ${linha('Facção', h(p.faccao || 'Aguardando facção'))}${linha('Movimentado em', dataHora(p.movimentado_em))}
        ${linha('Início no setor', p.inicio_setor ? dataHora(p.inicio_setor) + ' · ' + h(p.operador || '') : '')}
      </div>
      ${p.descricao ? `<div class="card" style="margin-top:12px;white-space:pre-wrap">${h(p.descricao)}</div>` : ''}
      <div class="grade g3" style="margin-top:10px">${espec}</div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        ${p.arquivo ? '<button class="btn peq" data-a="arquivo">📄 Abrir PDF do pedido</button>' : '<span class="muted peq">Sem PDF anexado.</span>'}
        ${p.foto ? '<button class="btn peq" data-a="foto">🖼️ Abrir foto</button>' : ''}
      </div>
      ${design || p.checklist ? `<h3 style="margin-top:16px">Checklist do grid</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${seloChecklist(p) || chip('Sem checklist')}
          <button class="btn peq" data-a="checklist">☑ Abrir checklist</button></div>` : ''}
      <h3 style="margin-top:16px">Reposições (${reps.length})</h3>
      ${reps.length ? `<div class="tabela-wrap"><table><thead><tr><th>Descrição</th><th>Perda (kg)</th><th>Cód.</th><th>Status</th><th></th></tr></thead><tbody>
        ${reps.map(r => `<tr><td style="white-space:pre-wrap;max-width:420px">${h(r.descricao || '')}</td><td>${r.perda_kg != null ? num(r.perda_kg, 3) : ''}</td><td>${h(r.codigo || '')}</td>
          <td>${r.status === 'REALIZADO' ? chip('Realizado', 'ok') : chip('Aguardando', 'alerta')}</td>
          <td>${r.status !== 'REALIZADO' ? `<button class="btn peq" data-real="${r.id}">Realizado</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="muted peq">Nenhuma.</div>'}
      <button class="btn peq" data-a="repos" style="margin-top:6px">+ Reposição</button>
      <h3 style="margin-top:16px">Histórico de setores (${aps.length})</h3>
      ${aps.length ? `<div class="tabela-wrap"><table><thead><tr><th>Setor</th><th>Início</th><th>Fim</th><th>Operador</th><th>Qtd</th></tr></thead><tbody>
        ${aps.map(a => `<tr><td>${h(a.setores?.nome || '')}</td><td>${a.so_data ? data(a.inicio) : dataHora(a.inicio)}</td><td>${a.so_data ? data(a.fim) : dataHora(a.fim)}</td>
          <td>${h(a.operadores?.nome || '')}</td><td>${num(a.qtd)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted peq">Ainda sem apontamentos.</div>'}`,
    botoes: [
      ...(podeMover(p) && !p.inicio_setor ? [{ texto: '▶ Iniciar', classe: 'pri', fecha: false, acao: () => { m.fechar(); iniciar(p, atualizarFora); } }] : []),
      ...(podeMover(p) && p.inicio_setor ? [{ texto: '✔ Finalizar', classe: 'pri', fecha: false, acao: () => { m.fechar(); finalizar(p, atualizarFora); } }] : []),
      { texto: 'Mais ações…', fecha: false, acao: () => maisAcoes(p, m, atualizar) },
      { texto: 'Fechar' },
    ]
  });
  function atualizarFora() { depois && depois(); }
  m.el.querySelector('[data-a=arquivo]')?.addEventListener('click', () => abrirArquivo(p.arquivo));
  m.el.querySelector('[data-a=foto]')?.addEventListener('click', () => abrirArquivo(p.foto));
  m.el.querySelector('[data-a=repos]').onclick = () => novaReposicao(p, atualizar);
  m.el.querySelector('[data-a=checklist]')?.addEventListener('click', () => abrirChecklist(p, atualizar));
  m.el.querySelectorAll('[data-real]').forEach(b => b.onclick = async () => {
    const { error } = await db.rpc('realizar_reposicao', { p_id: b.dataset.real });
    if (error) return toast(msgErro(error), 'erro');
    toast('Reposição realizada.', 'ok'); atualizar();
  });
}

function maisAcoes(p, m, atualizar) {
  const acoes = [
    ['op', '🖨️ Imprimir OP', true],
    ['editar', '✏️ Editar pedido', podeEditar() || tem('design')],
    ['checklist', '☑️ Checklist do grid', true],
    ['faccao', '👥 Definir facção', true],
    ['dividir', '➗ Dividir para outra facção (DIV2)', true],
    ['previsao', '📅 Recalcular previsão', podeMover(p) || podeEditar()],
    ['mover', '↪ Corrigir setor (sem apontamento)', podeEditar()],
    ['excluir', '🗑️ Excluir pedido', tem('admin')],
  ].filter(a => a[2]);
  const mm = modal({
    titulo: 'Ações do pedido',
    corpo: `<div class="grade">${acoes.map(([k, t]) => `<button class="btn ${k === 'excluir' ? 'perigo' : ''}" data-k="${k}" style="justify-content:flex-start">${t}</button>`).join('')}</div>`,
  });
  mm.el.querySelectorAll('[data-k]').forEach(b => b.onclick = async () => {
    mm.fechar();
    const k = b.dataset.k;
    if (k === 'op') return imprimirOP(p);
    m.fechar();
    if (k === 'editar') return formPedido(p, atualizar);
    if (k === 'checklist') return abrirChecklist(p, atualizar);
    if (k === 'faccao') return escolherFaccao(p, false, atualizar);
    if (k === 'dividir') return escolherFaccao(p, true, atualizar);
    if (k === 'mover') return moverManual(p, atualizar);
    if (k === 'previsao') {
      const { error } = await db.rpc('recalcular_previsao', { p_pedido: p.id });
      if (error) return toast(msgErro(error), 'erro');
      toast('Previsão recalculada.', 'ok'); return atualizar();
    }
    if (k === 'excluir') {
      if (!await confirmar('Excluir pedido', `Excluir <b>${h(p.ordem)}</b>? Apaga também as reposições e o histórico de setores deste pedido.`, 'Excluir', 'perigo')) return abrirPedido(p.id);
      const { error } = await db.from('pedidos').delete().eq('id', p.id);
      if (error) return toast(msgErro(error), 'erro');
      toast('Pedido excluído.', 'ok'); location.reload();
    }
  });
}

function novaReposicao(p, depois) {
  modal({
    titulo: `Nova reposição · ${p.ordem}`,
    corpo: `<form id="fr" class="grade">
      <label class="campo">Descrição (peças a refazer)<textarea name="d" required rows="6"></textarea></label>
      <div class="grade g2"><label class="campo">Perda (kg)<input name="k" type="number" step="0.001" min="0"></label>
      <label class="campo">Código<input name="c"></label></div></form>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Salvar', classe: 'pri', acao: async (m) => {
      const f = m.querySelector('#fr'); if (!f.reportValidity()) return false;
      const { error } = await db.from('reposicoes').insert({ pedido_id: p.id, descricao: f.d.value.trim(),
        perda_kg: f.k.value ? Number(f.k.value) : null, codigo: f.c.value.trim() || null });
      if (error) { toast(msgErro(error), 'erro'); return false; }
      toast('Reposição registrada.', 'ok'); depois && depois();
    } }]
  });
}

// ---------- formulário (novo / editar) ----------
function campoTags(nome, rotulo, valores, sugestoes) {
  return `<div class="campo tags" data-tags="${nome}">${h(rotulo)}
    <div class="tags-box">${(valores || []).map(v => `<span class="tag">${h(v)}<button type="button" aria-label="Remover">×</button></span>`).join('')}
      <input list="dl-${nome}" placeholder="Escolha ou digite e tecle Enter"></div>
    <datalist id="dl-${nome}">${(sugestoes || []).map(s => `<option value="${h(s)}">`).join('')}</datalist></div>`;
}
function ligarTags(raiz) {
  raiz.querySelectorAll('[data-tags]').forEach(box => {
    const inp = box.querySelector('input');
    const add = () => {
      const v = inp.value.trim().toUpperCase(); inp.value = '';
      if (!v || [...box.querySelectorAll('.tag')].some(t => t.firstChild.textContent === v)) return;
      const s = document.createElement('span'); s.className = 'tag';
      s.innerHTML = `${h(v)}<button type="button" aria-label="Remover">×</button>`;
      inp.before(s);
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
    inp.addEventListener('change', () => { if (box.querySelector(`datalist option[value="${CSS.escape(inp.value)}"]`)) add(); });
    inp.addEventListener('blur', add);
    box.addEventListener('click', e => { if (e.target.matches('.tag button')) e.target.parentElement.remove(); });
  });
}
const lerTags = (raiz, nome) => [...raiz.querySelectorAll(`[data-tags="${nome}"] .tag`)].map(t => t.firstChild.textContent);

export async function formPedido(p, depois) {
  const c = await cadastros(db, true);
  const novo = !p;
  const triagem = c.setores.find(s => s.nome === 'TRIAGEM');
  const so_design = !podeEditar(); // perfil design só ajusta especificação/descrição
  modal({
    titulo: novo ? 'Novo pedido' : `Editar · ${p.ordem}`, largo: true,
    corpo: `<form id="fp" class="grade">
      <div class="grade g3">
        <label class="campo">Ordem (nome do pedido)<input name="ordem" required value="${h(p?.ordem || '')}" ${so_design ? 'disabled' : ''}></label>
        <label class="campo">Lote do cliente<input name="lote" value="${h(p?.lote || '')}" ${so_design ? 'disabled' : ''}></label>
        <label class="campo">Artigo<input name="artigo" list="dl-artigo" value="${h(p?.artigo || '')}" ${so_design ? 'disabled' : ''}>
          <datalist id="dl-artigo">${(c.listas.artigo || []).map(s => `<option value="${h(s)}">`).join('')}</datalist></label>
        <label class="campo">Vendedor<select name="vendedor_id" ${so_design ? 'disabled' : ''}>${opcoes(ativos(c.vendedores, p?.vendedor_id), p?.vendedor_id, 'nome')}</select></label>
        <label class="campo">Cliente (contato)<input name="cliente" value="${h(p?.cliente || '')}" ${so_design ? 'disabled' : ''}></label>
        <label class="campo">Quantidade<input name="qtd" type="number" min="0" step="1" required value="${h(p?.qtd ?? '')}" ${so_design ? 'disabled' : ''}></label>
        <label class="campo">Data do pedido<input name="data_pedido" type="date" required value="${h(p?.data_pedido || hojeISO())}" ${so_design ? 'disabled' : ''}></label>
        <label class="campo">Data de entrega<input name="data_entrega" type="date" required value="${h(p?.data_entrega || '')}" ${so_design ? 'disabled' : ''}></label>
        ${novo ? `<label class="campo">Setor inicial<select name="setor_id">${opcoes(ativos(c.setores), triagem?.id, 'nome')}</select></label>` : ''}
      </div>
      <div class="grade g3">${CAMPOS_LISTA.map(([k, r]) => campoTags(k, r, p?.[k], c.listas[k])).join('')}</div>
      <label class="campo">Descrição<textarea name="descricao" rows="4">${h(p?.descricao || '')}</textarea></label>
      <div class="grade g2">
        <label class="campo">PDF do pedido ${p?.arquivo ? `<span class="muted peq">(atual: ${h(p.arquivo.split('/').pop())})</span>` : ''}<input name="arquivo" type="file" accept="application/pdf,image/*"></label>
        <label class="campo">Foto ${p?.foto ? `<span class="muted peq">(atual: ${h(p.foto.split('/').pop())})</span>` : ''}<input name="foto" type="file" accept="image/*"></label>
      </div>
    </form>`,
    aoAbrir: (m) => ligarTags(m),
    botoes: [{ texto: 'Cancelar' }, { texto: novo ? 'Cadastrar pedido' : 'Salvar', classe: 'pri', acao: async (m) => {
      const f = m.querySelector('#fp'); if (!f.reportValidity()) return false;
      m.querySelectorAll('[data-tags] input').forEach(i => i.dispatchEvent(new Event('blur')));
      const v = {};
      CAMPOS_LISTA.forEach(([k]) => { v[k] = lerTags(m, k); });
      v.descricao = f.descricao.value.trim() || null;
      if (!so_design) Object.assign(v, {
        ordem: f.ordem.value.trim().toUpperCase(), lote: f.lote.value.trim() || null, artigo: f.artigo.value.trim().toUpperCase() || null,
        vendedor_id: f.vendedor_id.value ? Number(f.vendedor_id.value) : null, cliente: f.cliente.value.trim() || null,
        qtd: Number(f.qtd.value), data_pedido: f.data_pedido.value, data_entrega: f.data_entrega.value,
      });
      if (v.data_entrega && v.data_pedido && v.data_entrega < v.data_pedido) { toast('A entrega não pode ser antes do pedido.', 'erro'); return false; }
      try {
        const pasta = `pedidos/${p?.id || crypto.randomUUID()}`;
        if (f.arquivo.files[0]) v.arquivo = await enviarArquivo(f.arquivo.files[0], pasta);
        if (f.foto.files[0]) v.foto = await enviarArquivo(f.foto.files[0], pasta);
      } catch (e) { toast('Erro ao enviar arquivo: ' + msgErro(e), 'erro'); return false; }
      let res;
      if (novo) {
        v.setor_id = Number(f.setor_id.value);
        res = await db.from('pedidos').insert(v).select('id').single();
      } else {
        res = await db.from('pedidos').update(v).eq('id', p.id).select('id').single();
      }
      if (res.error) { toast(msgErro(res.error), 'erro'); return false; }
      limparCache();
      toast(novo ? 'Pedido cadastrado.' : 'Pedido salvo.', 'ok');
      depois && depois(res.data.id);
    } }]
  });
}

// ---------- OP para impressão (antiga aba SELEÇÃO OP) ----------
// imprimirOPs(lista): uma ou várias OPs; o usuário escolhe 1 ou 2 por folha A4.
const FLUXO_OP = ['DESIGN', 'CALANDRA', 'CORTE', 'COSTURA', 'REVISÃO', 'EXPEDIÇÃO'];
export const numOP = (p) => String(p.numero ?? '').padStart(5, '0');
const linkOP = (p) => `${location.origin}/#/p/${p.numero}`;

// OP pequena: 1/4 de folha A4 (105 × 148 mm), com QR Code que abre o pedido no app
export function htmlOPMini(p) {
  const espec = [['Linha', p.linha], ['Gola', p.gola], ['Tecido', p.tecidos], ['Escudo', p.escudos], ['Manga', p.manga], ['Costura', p.costura], ['Meião', p.cor_meiao]]
    .filter(([, v]) => (v || []).length).slice(0, 6)
    .map(([r, v]) => `<div><small>${r}</small><b>${h(v.join(' · '))}</b></div>`).join('');
  return `<section class="opm">
    <header class="opm-cab"><img src="img/logo.png" alt="Stopball"><div class="opm-num"><small>OP</small><b>${numOP(p)}</b></div></header>
    <div class="opm-titulo"><h1>${h(p.ordem)}</h1><div>${h(p.artigo || '')}${p.lote ? ` · LOTE ${h(p.lote)}` : ''}${p.dividido ? ' · DIV2' : ''}</div></div>
    <div class="opm-meio">
      <div class="opm-qr">${qrSvg(linkOP(p), 3)}<span>${numOP(p)}</span></div>
      <div class="opm-dados">
        <div class="opm-qtd"><small>QTD</small><b>${num(p.qtd)}</b></div>
        <div class="opm-ent"><small>ENTREGA</small><b>${data(p.data_entrega)}</b></div>
        <div class="opm-l"><small>Vendedor</small><b>${h(p.vendedor || '—')}</b></div>
        <div class="opm-l"><small>Facção</small><b>${h(p.faccao || 'A definir')}</b></div>
      </div>
    </div>
    ${espec ? `<div class="opm-espec">${espec}</div>` : ''}
    ${p.descricao ? `<div class="opm-desc">${h(p.descricao)}</div>` : ''}
    <footer class="opm-rod"><span>${h(p.cliente || '')}</span><span>${dataHora(new Date())}</span></footer>
  </section>`;
}

export function htmlOP(p, compacta) {
  const espec = CAMPOS_LISTA.filter(([k]) => (p[k] || []).length)
    .map(([k, r]) => `<div class="op-esp"><small>${h(r)}</small><b>${h(p[k].join(' · '))}</b></div>`).join('');
  const codigo = `OP ${numOP(p)}`;
  return `<section class="op ${compacta ? 'compacta' : ''}">
    <header class="op-cab">
      <img src="img/logo.png" alt="Stopball" class="op-logo">
      <div class="op-cab-dir"><span class="op-tag">ORDEM DE PRODUÇÃO</span><span class="op-cod">${codigo}</span></div>
    </header>
    <div class="op-titulo-linha"><div class="op-titulo">
      <h1>${h(p.ordem)}</h1>
      <div class="op-sub">${h(p.artigo || '')}${p.lote ? ` · LOTE ${h(p.lote)}` : ''}${p.dividido ? ' · <b>PEDIDO DIVIDIDO (DIV2)</b>' : ''}</div>
    </div><div class="op-qr">${qrSvg(linkOP(p), 3)}</div></div>
    <div class="op-tiles">
      <div class="op-tile destaque"><small>Quantidade</small><b>${num(p.qtd)}</b><span>peças</span></div>
      <div class="op-tile entrega"><small>Entrega</small><b>${data(p.data_entrega)}</b><span>pedido em ${data(p.data_pedido)}</span></div>
      <div class="op-tile"><small>Vendedor</small><b class="m">${h(p.vendedor || '—')}</b></div>
      <div class="op-tile"><small>Cliente</small><b class="m">${h(p.cliente || '—')}</b></div>
      <div class="op-tile"><small>Facção</small><b class="m">${h(p.faccao || 'A definir')}</b></div>
    </div>
    ${espec ? `<div class="op-secao">Especificação</div><div class="op-espec">${espec}</div>` : ''}
    ${p.descricao ? `<div class="op-secao">Descrição</div><div class="op-desc">${h(p.descricao)}</div>` : ''}
    ${compacta ? '' : `<div class="op-secao">Acompanhamento</div>
    <div class="op-fluxo">${FLUXO_OP.map(f => `<div class="op-etapa"><small>${f}</small><span>Data ____/____</span><span>Visto ________</span></div>`).join('')}</div>
    <div class="op-secao">Observações da produção</div><div class="op-obs"></div>`}
    <footer class="op-rod"><span>Setor atual: <b>${h(p.setor || '')}</b></span><span>Impresso em ${dataHora(new Date())} · stopball.gutgestao.com.br</span></footer>
  </section>`;
}

export async function imprimirOPs(itens) {
  let lista = [].concat(itens);
  if (!lista.length) return toast('Selecione ao menos um pedido.', 'erro');
  // garante os dados completos (a lista de pedidos traz só algumas colunas)
  if (lista.some(p => !('linha' in p))) {
    const ids = lista.map(p => p.id);
    const completos = await ler(db.from('v_pedidos').select('*').in('id', ids));
    lista = ids.map(id => completos.find(p => p.id === id)).filter(Boolean);
  }
  modal({
    titulo: lista.length > 1 ? `Imprimir ${lista.length} OPs` : `Imprimir OP · ${lista[0].ordem}`,
    corpo: `<form id="fop" class="grade">
      <label class="op-opcao"><input type="radio" name="lay" value="4" checked> <span><b>OP pequena com QR Code</b> (4 por folha A4)<br><span class="muted peq">1/4 de folha, com o número da OP e o QR Code que abre o pedido no app. Linha tracejada para recortar.</span></span></label>
      <label class="op-opcao"><input type="radio" name="lay" value="2"> <span><b>Meia folha</b> (2 por folha A4)<br><span class="muted peq">Mais completa, sem a régua de acompanhamento.</span></span></label>
      <label class="op-opcao"><input type="radio" name="lay" value="1"> <span><b>Folha inteira</b><br><span class="muted peq">Completa, com a régua de acompanhamento por setor e campo de observações.</span></span></label>
      <p class="muted peq" style="margin:0">Dica: na janela de impressão, escolha "Salvar como PDF" para gerar o arquivo.</p>
    </form>`,
    botoes: [{ texto: 'Cancelar' }, { texto: '🖨 Imprimir', classe: 'pri', acao: (m) => {
      const lay = Number(m.querySelector('[name=lay]:checked').value);
      const ops = lista.map(p => lay === 4 ? htmlOPMini(p) : htmlOP(p, lay === 2));
      const classe = { 1: '', 2: 'duas', 4: 'quatro' }[lay];
      const paginas = [];
      for (let i = 0; i < ops.length; i += lay) paginas.push(`<div class="op-pagina ${classe}">${ops.slice(i, i + lay).join('')}</div>`);
      const nome = lista.length > 1 ? nomeArquivo(['OPs Stopball', `${lista.length} pedidos`, hojeISO()]) : nomeArquivo(['OP', numOP(lista[0]), lista[0].ordem]);
      imprimirHtml(paginas.join(''), nome);
    } }]
  });
}
export const imprimirOP = (p) => imprimirOPs([p]);
