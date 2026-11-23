// Painel por área → setor. Duas visões: Cartões (um setor por vez) e Kanban (uma coluna por setor da área).
import { db, ctx } from '../estado.js';
import { AREAS } from '../config.js';
import { h, chip, ler, num, data, toast } from '../util.js';
import { abrirPedido, iniciar, finalizar, podeMover, chipPrazo, chipSituacao, resumoEspec, formPedido, podeEditar, abrirChecklist, seloChecklist, imprimirOPs } from '../pedido.js';

const LIMITE_COLUNA = 150; // cartões por coluna no Kanban (os mais urgentes primeiro)
const pref = {
  get(k, p) { try { return localStorage.getItem('stopball.' + k) ?? p; } catch (_) { return p; } },
  set(k, v) { try { localStorage.setItem('stopball.' + k, v); } catch (_) { /* sem armazenamento */ } },
};
const estado = { area: null, setor: null, busca: '', vista: pref.get('vista', 'kanban') };

const filtrar = (lista) => {
  const q = estado.busca.trim().toLowerCase();
  return q ? lista.filter(p => [p.ordem, p.cliente, p.artigo, p.lote, p.vendedor, p.faccao, p.operador]
    .some(x => String(x || '').toLowerCase().includes(q))) : lista;
};

export async function render(el) {
  const resumo = await ler(db.rpc('resumo_setores'));
  const minhas = AREAS.filter(([k]) => ctx.perfis.includes(k));
  if (!estado.area) estado.area = (minhas[0] || AREAS[0])[0];
  const doArea = resumo.filter(s => (s.areas || []).includes(estado.area));
  if (!doArea.some(s => s.setor_id === estado.setor)) estado.setor = (doArea.find(s => s.total > 0) || doArea[0])?.setor_id ?? null;
  const kanban = estado.vista === 'kanban';

  el.innerHTML = `
    <div class="cab"><div><h1>Painel por setor</h1><p>${kanban ? 'Uma coluna por setor. Arraste um pedido em andamento para outra coluna para finalizar e mandar para lá.' : 'Escolha o setor. Toque no pedido para ver tudo e agir.'}</p></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <div class="vista-bts" role="group" aria-label="Visão">
          <button data-v="kanban" class="${kanban ? 'ativo' : ''}">▥ Kanban</button><button data-v="cartoes" class="${kanban ? '' : 'ativo'}">▦ Cartões</button></div>
        ${podeEditar() ? '<button class="btn pri" id="novo">+ Novo pedido</button>' : ''}</div></div>
    <div class="abas" id="areas">${AREAS.map(([k, r]) => `<button data-a="${k}" class="${k === estado.area ? 'ativo' : ''}">${h(r)}</button>`).join('')}</div>
    ${kanban ? '' : `<div class="setores">${doArea.map(s => `<button class="setor-bt ${s.setor_id === estado.setor ? 'ativo' : ''}" data-s="${s.setor_id}">
        <span class="n">${h(s.setor)}</span><b>${num(s.total)}</b>
        <span class="mini">${s.em_andamento ? chip(s.em_andamento + ' em andamento', 'info') : ''}${s.atrasados ? chip(s.atrasados + ' atrasados', 'erro') : ''}${s.vence_hoje ? chip(s.vence_hoje + ' hoje', 'alerta') : ''}</span>
      </button>`).join('')}</div>`}
    <div class="filtros" style="margin-top:12px">
      <label class="campo">Buscar${kanban ? ' na área' : ' no setor'}<input id="busca" placeholder="ordem, cliente, artigo, facção…" value="${h(estado.busca)}"></label>
      <div id="acoes-lote" style="display:flex;gap:8px"></div>
    </div>
    <div id="lista"><div class="vazio"><div class="spinner" style="margin:auto"></div></div></div>`;

  el.querySelector('#novo')?.addEventListener('click', () => formPedido(null, () => render(el)));
  el.querySelectorAll('.vista-bts button').forEach(b => b.onclick = () => { estado.vista = b.dataset.v; pref.set('vista', b.dataset.v); render(el); });
  el.querySelectorAll('#areas button').forEach(b => b.onclick = () => { estado.area = b.dataset.a; estado.setor = null; render(el); });
  el.querySelectorAll('.setor-bt').forEach(b => b.onclick = () => { estado.setor = Number(b.dataset.s); render(el); });
  const recarregar = () => render(el);

  if (kanban) return renderKanban(el, doArea, recarregar);

  let pedidos = [];
  if (estado.setor) pedidos = await ler(db.from('v_pedidos').select('*').eq('setor_id', estado.setor)
    .order('previsao_setor', { ascending: true, nullsFirst: false }).limit(1000));
  let t; el.querySelector('#busca').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { estado.busca = e.target.value; desenhar(); }, 250); };

  function desenhar() {
    const lista = filtrar(pedidos);
    const box = el.querySelector('#lista');
    if (!estado.setor) { box.innerHTML = '<div class="vazio">Nenhum setor nesta área.</div>'; return; }
    if (!lista.length) { box.innerHTML = '<div class="vazio">Nenhum pedido neste setor.</div>'; return; }
    const grupos = {};
    lista.forEach(p => (grupos[p.vendedor || 'Sem vendedor'] ||= []).push(p));
    box.innerHTML = Object.entries(grupos).sort((a, b) => a[0].localeCompare(b[0])).map(([v, ps]) => `
      <h3 class="grupo-vend">Vendedor: ${h(v)} <span class="muted peq">· ${ps.length} pedido(s) · ${num(ps.reduce((s, p) => s + (p.qtd || 0), 0))} peças</span></h3>
      <div class="lista-cards">${ps.map(p => `
        <div class="item pedido-card ${p.prazo_status === 'ATRASADO' ? 'atrasado' : ''}" data-id="${p.id}">
          <div class="linha1">
            <label class="sel" onclick="event.stopPropagation()">${podeMover(p) ? `<input type="checkbox" data-sel="${p.id}">` : ''}</label>
            <div style="flex:1;min-width:0"><div class="tit">${h(p.ordem)}${p.lote ? ` <span class="muted">· ${h(p.lote)}</span>` : ''}</div>
              <div class="det">${h(p.artigo || '')} · <b>${num(p.qtd)}</b> pç · entrega ${data(p.data_entrega)}</div></div>
            ${p.outros_da_ordem ? `<span title="Há outros pedidos desta ordem em aberto">⚠️</span>` : ''}
          </div>
          <div class="det">${h(resumoEspec(p))}</div>
          ${p.faccao ? `<div class="det">Facção: <b>${h(p.faccao)}</b>${p.dividido ? ' (DIV2)' : ''}</div>` : ''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${chipSituacao(p)} ${chipPrazo(p)} ${seloChecklist(p)} ${p.reposicoes_pendentes ? chip(p.reposicoes_pendentes + ' reposição', 'alerta') : ''}</div>
          ${p.setor === 'DESIGN-GRID' || podeMover(p) ? `<div class="acoes-card">${p.setor === 'DESIGN-GRID' ? `<button class="btn peq ck-bt ${p.checklist_concluido_em ? 'ok' : ''}" data-ck="${p.id}">${p.checklist_concluido_em ? '☑' : '☐'} Checklist</button>` : ''}${!podeMover(p) ? '' : p.inicio_setor
            ? `<button class="btn peq pri" data-fin="${p.id}">✔ Finalizar</button>`
            : `<button class="btn peq pri" data-ini="${p.id}">▶ Iniciar</button>`}</div>` : ''}
        </div>`).join('')}</div>`).join('');
    box.querySelectorAll('[data-ck]').forEach(b => b.onclick = (e) => { e.stopPropagation(); abrirChecklist(achar(b.dataset.ck), () => desenhar()); });
    const achar = (id) => pedidos.find(p => p.id === id);
    box.querySelectorAll('.pedido-card').forEach(c => c.onclick = (e) => { if (!e.target.closest('button,input,label.sel')) abrirPedido(c.dataset.id, recarregar); });
    box.querySelectorAll('[data-ini]').forEach(b => b.onclick = () => iniciar(achar(b.dataset.ini), recarregar));
    box.querySelectorAll('[data-fin]').forEach(b => b.onclick = () => finalizar(achar(b.dataset.fin), recarregar));
    const lote = el.querySelector('#acoes-lote');
    const atualizarLote = () => {
      const sel = [...box.querySelectorAll('[data-sel]:checked')].map(i => achar(i.dataset.sel));
      const ini = sel.filter(p => !p.inicio_setor), fin = sel.filter(p => p.inicio_setor);
      lote.innerHTML = (ini.length ? `<button class="btn" id="l-ini">▶ Iniciar ${ini.length}</button>` : '') +
        (fin.length ? `<button class="btn" id="l-fin">✔ Finalizar ${fin.length}</button>` : '') +
        (sel.length ? `<button class="btn" id="l-op">🖨 ${sel.length} OP(s)</button>` : '');
      lote.querySelector('#l-ini')?.addEventListener('click', () => iniciar(ini, recarregar));
      lote.querySelector('#l-fin')?.addEventListener('click', () => finalizar(fin, recarregar));
      lote.querySelector('#l-op')?.addEventListener('click', () => imprimirOPs(sel));
    };
    box.querySelectorAll('[data-sel]').forEach(i => i.onchange = atualizarLote);
    atualizarLote();
  }
  desenhar();
}

// ---------- Kanban ----------
async function renderKanban(el, setores, recarregar) {
  const box = el.querySelector('#lista');
  if (!setores.length) { box.innerHTML = '<div class="vazio">Nenhum setor nesta área.</div>'; return; }
  const listas = await Promise.all(setores.map(s => ler(db.from('v_pedidos').select('*').eq('setor_id', s.setor_id)
    .order('previsao_setor', { ascending: true, nullsFirst: false }).limit(LIMITE_COLUNA))));
  const todos = listas.flat();
  const achar = (id) => todos.find(p => p.id === id);

  function cartao(p) {
    const mover = podeMover(p);
    return `<div class="kcard ${p.inicio_setor ? 'andamento' : ''} ${p.prazo_status === 'ATRASADO' ? 'atrasado' : ''}" data-id="${p.id}" ${mover && p.inicio_setor ? 'draggable="true"' : ''}>
      <div class="tit">${h(p.ordem)}${p.lote ? ` <span class="muted">· ${h(p.lote)}</span>` : ''} ${p.outros_da_ordem ? '<span title="Há outros pedidos desta ordem em aberto">⚠️</span>' : ''}</div>
      <div class="det">${h(p.artigo || '')} · <b>${num(p.qtd)}</b> pç · entrega ${data(p.data_entrega)}</div>
      <div class="det">${h(p.vendedor || 'Sem vendedor')}${p.faccao ? ' · ' + h(p.faccao) : ''}${p.dividido ? ' (DIV2)' : ''}</div>
      <div class="rod">${p.inicio_setor ? chip('▶ ' + (p.operador || 'em andamento'), 'info') : ''} ${chipPrazo(p)}
        ${p.reposicoes_pendentes ? chip('♻ ' + p.reposicoes_pendentes, 'alerta') : ''}
        ${p.setor === 'DESIGN-GRID' ? `<button class="btn peq ck-bt ${p.checklist_concluido_em ? 'ok' : ''}" data-ck="${p.id}" title="Abrir checklist do grid">${p.checklist_concluido_em ? '☑' : '☐'} Checklist</button>` : ''}
        ${mover ? (p.inicio_setor ? `<button class="btn peq pri" data-fin="${p.id}">✔</button>` : `<button class="btn peq" data-ini="${p.id}">▶ Iniciar</button>`) : ''}</div>
    </div>`;
  }

  function desenhar() {
    box.innerHTML = `<div class="kanban">${setores.map((s, i) => {
      const ps = filtrar(listas[i]);
      return `<div class="kcol" data-setor="${s.setor_id}">
        <div class="kcol-cab"><span class="n">${h(s.setor)}</span><span class="q">${num(s.total)}</span>
          <div class="mini">${s.em_andamento ? chip(s.em_andamento + ' em andamento', 'info') : ''}${s.atrasados ? chip(s.atrasados + ' atrasados', 'erro') : ''}${s.vence_hoje ? chip(s.vence_hoje + ' hoje', 'alerta') : ''}</div></div>
        <div class="kcol-corpo">${ps.map(cartao).join('') || '<div class="kcol-mais">Vazio</div>'}
          ${s.total > listas[i].length ? `<div class="kcol-mais">Mostrando os ${listas[i].length} mais urgentes de ${num(s.total)}. Use a busca ou a visão Cartões.</div>` : ''}</div>
      </div>`;
    }).join('')}</div>`;

    box.querySelectorAll('.kcard').forEach(c => c.onclick = (e) => { if (!e.target.closest('button')) abrirPedido(c.dataset.id, recarregar); });
    box.querySelectorAll('[data-ini]').forEach(b => b.onclick = () => iniciar(achar(b.dataset.ini), recarregar));
    box.querySelectorAll('[data-fin]').forEach(b => b.onclick = () => finalizar(achar(b.dataset.fin), recarregar));
    box.querySelectorAll('[data-ck]').forEach(b => b.onclick = (e) => { e.stopPropagation(); abrirChecklist(achar(b.dataset.ck), () => desenhar()); });

    // arrastar: só pedidos em andamento (o fim do setor gera o apontamento)
    let arrastando = null;
    box.querySelectorAll('.kcard[draggable]').forEach(c => {
      c.addEventListener('dragstart', (e) => { arrastando = achar(c.dataset.id); e.dataTransfer.effectAllowed = 'move'; });
      c.addEventListener('dragend', () => { arrastando = null; box.querySelectorAll('.kcol.alvo').forEach(k => k.classList.remove('alvo')); });
    });
    box.querySelectorAll('.kcol').forEach(col => {
      col.addEventListener('dragover', (e) => { if (arrastando && Number(col.dataset.setor) !== arrastando.setor_id) { e.preventDefault(); col.classList.add('alvo'); } });
      col.addEventListener('dragleave', () => col.classList.remove('alvo'));
      col.addEventListener('drop', (e) => {
        e.preventDefault(); col.classList.remove('alvo');
        if (!arrastando) return;
        finalizar(arrastando, recarregar, Number(col.dataset.setor));
      });
    });
    box.querySelectorAll('.kcard:not([draggable])').forEach(c => c.addEventListener('dragstart', () => toast('Inicie o pedido antes de mandar para outro setor.', 'erro')));
  }
  let t; el.querySelector('#busca').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { estado.busca = e.target.value; desenhar(); }, 250); };
  desenhar();
}
