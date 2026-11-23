// Checklist de Montagem do Grid (etapa DESIGN-GRID).
// Abre numa janela por cima da tela, salva rascunho e conclui ("Concluir e liberar").
// O pedido só sai do DESIGN-GRID com o checklist concluído (trava no banco: stopball.finalizar_setor).
import { db, ctx, tem } from './estado.js';
import { h, modal, toast, msgErro, dataHora, num } from './util.js';

export const VERSAO_CHECKLIST = 2;

const S1 = [
  ['pedido_acabamento', 'Pedido e acabamento conferidos', 'Observações, modelagem, tipo de escudo, mangas, baby look/infantil, punho ou bainha e gola correta.'],
  ['gola', 'Tipo e cor da gola conferidos', 'Remover do grid se usar ribana pronta.'],
  ['arte_layout', 'Arte montada no grid conforme layout', 'Patrocínios vetorizados ou originais.'],
  ['variaveis', 'Variáveis do SISBolt configuradas', 'NO, NU, AP, TS — e mão livre, se necessário.'],
  ['fonte', 'Fonte correta definida', 'Confirmar se é fonte instalada ou vetorial.'],
];
export const ESCUDOS = {
  sub: ['🎨', 'Sublimado', 'Escudo sublimado', 'Marcação de "X" removida e tamanho padrão adicionado.'],
  dtf: ['🖨️', 'DTF', 'Escudo DTF', 'Escudo vazado na arte (contorno interno branco, sem contorno de linha) e enviado para impressão.'],
  p3e: ['🧩', 'Patch 3D emborrachado', 'Escudo Patch 3D emborrachado', 'Marcação "•" mantida na arte, DTF enviado para impressão e corte cego da lona enviado para o laser.'],
  p3s: ['✨', 'Patch 3D sublimado', 'Escudo Patch 3D sublimado', 'Escudo impresso com marcação de corte a laser, enviado para bordado e marcação "•" mantida na arte.'],
  e4d: ['💎', 'Escudo 4D', 'Escudo 4D', 'Conferência do escudo 4D.'],
  bor: ['🧵', 'Bordado', 'Escudo bordado', 'Sem marcação de posição, escudo enviado para bordado.'],
};
const S3 = [
  ['fonte_cores_pos', 'Fonte e cores ajustadas após SISBolt', 'Fonte correta definida (se vetorial) e cores revisadas.'],
  ['conferencia_pos', 'Conferência pós-SISBolt', 'Nomes, acentos/caracteres especiais e tamanho ≤ 30 cm no GG em diante.'],
];
const S4 = [
  ['teste_cor', 'Foi necessário fazer teste de cor / impressão?', ''],
  ['parar_saida', 'Foi necessário parar a saída para resolver inconsistência?', 'Pedido, lista, layout ou alinhamento com o vendedor.'],
  ['molde', 'Foi necessário aguardar novo molde ou ajustar o molde existente?', ''],
];
const TOTAL = S1.length + 1 + S3.length + S4.length; // 11 itens

// tipo de escudo sugerido a partir do pedido
function escudoDoPedido(p) {
  const e = (p.escudos || []).join(' ').toUpperCase();
  if (/PATCH 3D EMBORRACHADO/.test(e)) return 'p3e';
  if (/PATCH 3D SUBLIMADO/.test(e)) return 'p3s';
  if (/4D/.test(e)) return 'e4d';
  if (/BORDADO/.test(e)) return 'bor';
  if (/DTF/.test(e)) return 'dtf';
  if (/SUBLIMADO/.test(e)) return 'sub';
  return null;
}

// quantos dos 11 itens estão respondidos
function contar(r) {
  const s1 = S1.filter(([k]) => r[k] === true).length;
  const s2 = r.escudo_tipo && r.escudo_ok === true ? 1 : 0;
  const s3 = S3.filter(([k]) => r[k] === true).length;
  const s4 = S4.filter(([k]) => r[k] === 'SIM' || r[k] === 'NÃO').length;
  return { s1, s2, s3, s4, total: s1 + s2 + s3 + s4 };
}

export const checklistOk = (p) => !!p.checklist_concluido_em;
export const ehGrid = (p) => p.setor === 'DESIGN-GRID';

// selo para os cartões e a janela do pedido
export function seloChecklist(p) {
  if (!ehGrid(p) && !p.checklist_concluido_em) return '';
  if (checklistOk(p)) return `<span class="chip ok" title="Concluído por ${h(p.checklist_concluido_por || '')} em ${h(dataHora(p.checklist_concluido_em))}">☑ Checklist ok</span>`;
  const n = contar(p.checklist?.itens || {}).total;
  return `<span class="chip alerta">☐ Checklist ${n ? `${n}/${TOTAL}` : 'pendente'}</span>`;
}

export function abrirChecklist(p, depois) {
  const pode = tem('design') || tem('pedidos');
  const r = { ...(p.checklist?.itens || {}) };
  if (!r.escudo_tipo) r.escudo_tipo = escudoDoPedido(p);
  const obs = { ...(p.checklist?.obs_itens || {}) };
  const designer = p.checklist?.designer || p.operador || ctx.nome || '';

  const ck = (k, t, d) => `<div class="ckg-item ${r[k] === true ? 'done' : ''}" data-k="${k}">
      <button type="button" class="ckg-chk" ${pode ? '' : 'disabled'} aria-label="Marcar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>
      <div class="ckg-txt"><b>${h(t)}</b>${d ? `<span>${h(d)}</span>` : ''}</div></div>`;
  const sn = (k, t, d) => `<div class="ckg-item ckg-yn-item" data-yn="${k}">
      <div class="ckg-txt"><b>${h(t)}</b>${d ? `<span>${h(d)}</span>` : ''}
        <textarea class="ckg-obs" data-obs="${k}" placeholder="Descreva o que precisou ser resolvido…" ${r[k] === 'SIM' ? '' : 'hidden'} ${pode ? '' : 'disabled'}>${h(obs[k] || '')}</textarea></div>
      <div class="ckg-yn"><button type="button" class="s ${r[k] === 'SIM' ? 'on' : ''}" ${pode ? '' : 'disabled'}>Sim</button><button type="button" class="n ${r[k] === 'NÃO' ? 'on' : ''}" ${pode ? '' : 'disabled'}>Não</button></div></div>`;
  const secao = (n, titulo, chave, corpo) => `<section class="ckg-sec"><h2><span class="ckg-num">${n}</span>${titulo}<span class="ckg-count" data-count="${chave}"></span></h2>${corpo}</section>`;

  const m = modal({
    titulo: 'Checklist de Montagem do Grid', largo: true,
    corpo: `<div class="ckg">
      <div class="ckg-cab"><div><small>Etapa: Design Grid</small><p>Confira todos os itens antes de liberar o pedido para a próxima etapa.</p></div>
        ${checklistOk(p) ? `<span class="chip ok">Concluído por ${h(p.checklist_concluido_por || '')} · ${h(dataHora(p.checklist_concluido_em))}</span>` : ''}</div>
      <div class="ckg-info">
        <div><small>Pedido</small><b>${h(p.ordem)}${p.lote ? ' · ' + h(p.lote) : ''}</b></div>
        <div><small>Cliente</small><b>${h(p.cliente || '—')}</b></div>
        <div><small>Modelo</small><b>${h(p.artigo || '—')} · ${num(p.qtd)} un.</b></div>
        <div><small>Designer</small><b>${h(designer || '—')}</b></div>
      </div>
      <div class="ckg-prog"><div class="ckg-bar"><i id="ckg-bar"></i></div><span id="ckg-ptxt"></span></div>
      ${secao(1, 'Montagem do Grid', 's1', S1.map(([k, t, d]) => ck(k, t, d)).join(''))}
      ${secao(2, 'Tipo de Escudo', 's2', `
        <div class="ckg-escudos">${Object.entries(ESCUDOS).map(([k, [ic, nome]]) =>
          `<button type="button" class="ckg-esc ${r.escudo_tipo === k ? 'sel' : ''}" data-e="${k}" ${pode ? '' : 'disabled'}><span class="ic">${ic}</span>${h(nome)}</button>`).join('')}</div>
        <div class="ckg-hint">Selecione o tipo de escudo do pedido${(p.escudos || []).length ? ` (no pedido: <b>${h(p.escudos.join(', '))}</b>)` : ''}. Aparecem só as conferências desse tipo.</div>
        <div id="ckg-esc-item"></div>`)}
      ${secao(3, 'Ajustes Finais', 's3', S3.map(([k, t, d]) => ck(k, t, d)).join(''))}
      ${secao(4, 'Validações Finais', 's4', S4.map(([k, t, d]) => sn(k, t, d)).join(''))}
      <div class="ckg-rod"><span class="ckg-note" id="ckg-note"></span>
        ${pode ? `<button type="button" class="btn" id="ckg-rasc">Salvar rascunho</button>
        <button type="button" class="btn ckg-concluir" id="ckg-ok">Concluir e liberar</button>` : '<span class="muted peq">Só o design preenche o checklist.</span>'}</div>
    </div>`,
  });
  const el = m.el;

  function desenharEscudo() {
    const box = el.querySelector('#ckg-esc-item');
    const e = ESCUDOS[r.escudo_tipo];
    box.innerHTML = e ? ck('escudo_ok', e[2], e[3]) : '<div class="ckg-hint" style="padding-bottom:14px">Nenhum tipo selecionado.</div>';
  }
  function atualizar() {
    const c = contar(r);
    el.querySelector('#ckg-bar').style.width = `${c.total / TOTAL * 100}%`;
    el.querySelector('#ckg-ptxt').textContent = `${c.total} de ${TOTAL} itens concluídos`;
    const tot = { s1: S1.length, s2: 1, s3: S3.length, s4: S4.length };
    el.querySelectorAll('[data-count]').forEach(x => { x.textContent = `${c[x.dataset.count]}/${tot[x.dataset.count]}`; });
    const falta = TOTAL - c.total;
    const ok = el.querySelector('#ckg-ok'); if (ok) ok.disabled = falta > 0;
    el.querySelector('#ckg-note').textContent = falta ? `Faltam ${falta} item(ns) para liberar o pedido.` : 'Tudo conferido. Pronto para liberar.';
  }
  desenharEscudo(); atualizar();

  if (pode) el.querySelector('.ckg').addEventListener('click', (e) => {
    const chk = e.target.closest('.ckg-chk');
    if (chk) {
      const it = chk.closest('.ckg-item'); const k = it.dataset.k;
      r[k] = r[k] === true ? false : true; it.classList.toggle('done', r[k]); return atualizar();
    }
    const esc = e.target.closest('.ckg-esc');
    if (esc) {
      if (r.escudo_tipo !== esc.dataset.e) r.escudo_ok = false; // trocar o tipo exige conferir de novo
      r.escudo_tipo = esc.dataset.e;
      el.querySelectorAll('.ckg-esc').forEach(x => x.classList.toggle('sel', x === esc));
      desenharEscudo(); return atualizar();
    }
    const yn = e.target.closest('.ckg-yn button');
    if (yn) {
      const it = yn.closest('[data-yn]'); const k = it.dataset.yn;
      r[k] = yn.classList.contains('s') ? 'SIM' : 'NÃO';
      it.querySelectorAll('.ckg-yn button').forEach(b => b.classList.toggle('on', b === yn));
      const ta = it.querySelector('.ckg-obs'); ta.hidden = r[k] !== 'SIM'; if (!ta.hidden) ta.focus();
      return atualizar();
    }
  });

  async function salvar(concluir) {
    el.querySelectorAll('[data-obs]').forEach(t => { const v = t.value.trim(); if (v) obs[t.dataset.obs] = v; else delete obs[t.dataset.obs]; });
    if (concluir) {
      const semDesc = S4.filter(([k]) => r[k] === 'SIM' && !obs[k]);
      if (semDesc.length) { toast('Descreva o que aconteceu nas validações marcadas como "Sim".', 'erro'); el.querySelector(`[data-obs="${semDesc[0][0]}"]`).focus(); return; }
    }
    const btns = el.querySelectorAll('#ckg-rasc,#ckg-ok'); btns.forEach(b => b.disabled = true);
    const { data, error } = await db.rpc('salvar_checklist', { p_pedido: p.id,
      p_checklist: { versao: VERSAO_CHECKLIST, itens: r, obs_itens: obs, designer: designer || null }, p_concluir: concluir });
    btns.forEach(b => b.disabled = false); atualizar();
    if (error) return toast(msgErro(error), 'erro');
    Object.assign(p, data);
    toast(concluir ? 'Checklist concluído. O pedido já pode sair do DESIGN-GRID.' : 'Rascunho salvo.', 'ok');
    m.fechar();
    depois && depois(p);
  }
  el.querySelector('#ckg-rasc')?.addEventListener('click', () => salvar(false));
  el.querySelector('#ckg-ok')?.addEventListener('click', () => salvar(true));
  return m;
}
