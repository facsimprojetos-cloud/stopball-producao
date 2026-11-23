// Pedido: detalhes, ações (iniciar, finalizar, facção, dividir…), formulário, reposições e OP.
import { db, ctx, tem } from './estado.js';
import { BUCKET, PASTA_APPSHEET, AREAS } from './config.js';
import { h, chip, modal, toast, msgErro, ler, data, dataHora, num, cadastros, limparCache, ativos, opcoes,
  confirmar, imprimirHtml, nomeArquivo, hojeISO } from './util.js';

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
    titulo: `${p.ordem}${p.lote ? ' · lote ' + p.lote : ''}`, largo: true,
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
      ${design || p.chk_montagem != null || p.validacao_final ? `<h3 style="margin-top:16px">Checklist de design (grid)</h3>
        <div class="grade g2 peq">
          <div>${chk(p.chk_montagem)} Montagem: pedido, acabamento, layout, gola, cores, fontes, variáveis e escudos</div>
          <div>${chk(p.chk_escudos)} Tipos de escudo conferidos</div>
          <div>${chk(p.chk_ajustes)} Ajustes finais: cores, fontes, nomes, acentos, tamanho da arte</div>
          <div>Validação final (teste de cor / correção / molde): <b>${h(p.validacao_final || '—')}</b> ${h(p.validacao_obs || '')}</div>
        </div>` : ''}
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
    ['checklist', '☑️ Checklist de design', tem('design') || podeEditar()],
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
    if (k === 'checklist') return checklist(p, atualizar);
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

function checklist(p, depois) {
  const sn = (n, v, t) => `<label style="display:block;margin:8px 0"><input type="checkbox" name="${n}" ${v ? 'checked' : ''}> ${t}</label>`;
  modal({
    titulo: `Checklist de design · ${p.ordem}`,
    corpo: `<form id="fk">
      <h3>Montagem de grid</h3>${sn('m', p.chk_montagem, 'Verificar pedido, acabamento, layout, gola, cores, fontes, variáveis e escudos.')}
      <h3>Tipos de escudo</h3>${sn('e', p.chk_escudos, 'Confirmar o tipo aplicado e o tratamento correto de cada escudo antes da produção.')}
      <h3>Ajustes finais</h3>${sn('a', p.chk_ajustes, 'Revisar cores, fontes, nomes, acentos, caracteres e tamanho final da arte.')}
      <h3>Validação final</h3>
      <label class="campo">Houve teste de cor, pausa para correção ou ajuste de molde?
        <select name="v"><option value="">—</option><option ${p.validacao_final === 'NÃO' ? 'selected' : ''}>NÃO</option><option ${p.validacao_final === 'SIM' ? 'selected' : ''}>SIM</option></select></label>
      <label class="campo">Descrição<textarea name="o">${h(p.validacao_obs || '')}</textarea></label>
    </form>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Salvar', classe: 'pri', acao: async (m) => {
      const f = m.querySelector('#fk');
      const { error } = await db.from('pedidos').update({ chk_montagem: f.m.checked, chk_escudos: f.e.checked, chk_ajustes: f.a.checked,
        validacao_final: f.v.value || null, validacao_obs: f.o.value.trim() || null }).eq('id', p.id);
      if (error) { toast(msgErro(error), 'erro'); return false; }
      toast('Checklist salvo.', 'ok'); depois && depois();
    } }]
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
export function imprimirOP(p) {
  const linha = (r, v) => `<tr><th>${h(r)}</th><td>${v || ''}</td></tr>`;
  const html = `<div class="op-folha">
    <div class="op-topo"><div><small>ORDEM DE PRODUÇÃO · STOPBALL</small><h1>${h(p.ordem)}</h1></div>
      <div class="op-entrega"><small>ENTREGA</small><b>${data(p.data_entrega)}</b></div></div>
    <table class="op-tab">
      ${linha('Lote do cliente', h(p.lote))}${linha('Artigo', h(p.artigo))}${linha('Quantidade', `<b>${num(p.qtd)}</b>`)}
      ${linha('Vendedor', h(p.vendedor))}${linha('Cliente', h(p.cliente))}${linha('Data do pedido', data(p.data_pedido))}
      ${CAMPOS_LISTA.map(([k, r]) => (p[k] || []).length ? linha(r, h(p[k].join(', '))) : '').join('')}
      ${linha('Facção', h(p.faccao || ''))}${linha('Setor atual', h(p.setor))}
    </table>
    ${p.descricao ? `<div class="op-desc"><small>DESCRIÇÃO</small><div>${h(p.descricao)}</div></div>` : ''}
    <div class="op-rodape">Impresso em ${dataHora(new Date())}</div>
  </div>`;
  imprimirHtml(html, nomeArquivo(['OP', p.ordem, p.lote]));
}
