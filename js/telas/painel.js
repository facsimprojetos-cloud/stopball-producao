// Painel por área → setor → cartões de pedidos (antigos dashboards e slices do AppSheet)
import { db, ctx, tem } from '../estado.js';
import { AREAS } from '../config.js';
import { h, chip, ler, num, data } from '../util.js';
import { abrirPedido, iniciar, finalizar, podeMover, chipPrazo, chipSituacao, resumoEspec, formPedido, podeEditar } from '../pedido.js';

const estado = { area: null, setor: null, busca: '' };

export async function render(el) {
  const resumo = await ler(db.rpc('resumo_setores'));
  const minhas = AREAS.filter(([k]) => ctx.perfis.includes(k));
  if (!estado.area) estado.area = (minhas[0] || AREAS[0])[0];
  const doArea = resumo.filter(s => (s.areas || []).includes(estado.area));
  if (!doArea.some(s => s.setor_id === estado.setor)) estado.setor = (doArea.find(s => s.total > 0) || doArea[0])?.setor_id ?? null;

  el.innerHTML = `
    <div class="cab"><div><h1>Painel por setor</h1><p>Escolha a área e o setor. Toque no pedido para ver tudo e agir.</p></div>
      ${podeEditar() ? '<button class="btn pri" id="novo">+ Novo pedido</button>' : ''}</div>
    <div class="abas" id="areas">${AREAS.map(([k, r]) => `<button data-a="${k}" class="${k === estado.area ? 'ativo' : ''}">${h(r)}</button>`).join('')}</div>
    <div class="setores">${doArea.map(s => `<button class="setor-bt ${s.setor_id === estado.setor ? 'ativo' : ''}" data-s="${s.setor_id}">
        <span class="n">${h(s.setor)}</span><b>${num(s.total)}</b>
        <span class="mini">${s.em_andamento ? chip(s.em_andamento + ' em andamento', 'info') : ''}${s.atrasados ? chip(s.atrasados + ' atrasados', 'erro') : ''}${s.vence_hoje ? chip(s.vence_hoje + ' hoje', 'alerta') : ''}</span>
      </button>`).join('')}</div>
    <div class="filtros" style="margin-top:12px">
      <label class="campo">Buscar no setor<input id="busca" placeholder="ordem, cliente, artigo…" value="${h(estado.busca)}"></label>
      <div id="acoes-lote" style="display:flex;gap:8px"></div>
    </div>
    <div id="lista"><div class="vazio"><div class="spinner" style="margin:auto"></div></div></div>`;

  el.querySelector('#novo')?.addEventListener('click', () => formPedido(null, () => render(el)));
  el.querySelectorAll('#areas button').forEach(b => b.onclick = () => { estado.area = b.dataset.a; estado.setor = null; render(el); });
  el.querySelectorAll('.setor-bt').forEach(b => b.onclick = () => { estado.setor = Number(b.dataset.s); render(el); });
  let t; el.querySelector('#busca').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { estado.busca = e.target.value; desenhar(); }, 250); };

  let pedidos = [];
  if (estado.setor) pedidos = await ler(db.from('v_pedidos').select('*').eq('setor_id', estado.setor)
    .order('previsao_setor', { ascending: true, nullsFirst: false }).limit(1000));
  const recarregar = () => render(el);

  function desenhar() {
    const q = estado.busca.trim().toLowerCase();
    const lista = q ? pedidos.filter(p => [p.ordem, p.cliente, p.artigo, p.lote, p.vendedor, p.faccao].some(x => String(x || '').toLowerCase().includes(q))) : pedidos;
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
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${chipSituacao(p)} ${chipPrazo(p)} ${p.reposicoes_pendentes ? chip(p.reposicoes_pendentes + ' reposição', 'alerta') : ''}</div>
          ${podeMover(p) ? `<div class="acoes-card">${p.inicio_setor
            ? `<button class="btn peq pri" data-fin="${p.id}">✔ Finalizar</button>`
            : `<button class="btn peq pri" data-ini="${p.id}">▶ Iniciar</button>`}</div>` : ''}
        </div>`).join('')}</div>`).join('');
    const achar = (id) => pedidos.find(p => p.id === id);
    box.querySelectorAll('.pedido-card').forEach(c => c.onclick = (e) => { if (!e.target.closest('button,input,label.sel')) abrirPedido(c.dataset.id, recarregar); });
    box.querySelectorAll('[data-ini]').forEach(b => b.onclick = () => iniciar(achar(b.dataset.ini), recarregar));
    box.querySelectorAll('[data-fin]').forEach(b => b.onclick = () => finalizar(achar(b.dataset.fin), recarregar));
    const lote = el.querySelector('#acoes-lote');
    const atualizarLote = () => {
      const sel = [...box.querySelectorAll('[data-sel]:checked')].map(i => achar(i.dataset.sel));
      const ini = sel.filter(p => !p.inicio_setor), fin = sel.filter(p => p.inicio_setor);
      lote.innerHTML = (ini.length ? `<button class="btn" id="l-ini">▶ Iniciar ${ini.length}</button>` : '') +
        (fin.length ? `<button class="btn" id="l-fin">✔ Finalizar ${fin.length}</button>` : '');
      lote.querySelector('#l-ini')?.addEventListener('click', () => iniciar(ini, recarregar));
      lote.querySelector('#l-fin')?.addEventListener('click', () => finalizar(fin, recarregar));
    };
    box.querySelectorAll('[data-sel]').forEach(i => i.onchange = atualizarLote);
    atualizarLote();
  }
  desenhar();
}
