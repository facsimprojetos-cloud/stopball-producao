// Checklist do DESIGN-GRID: abre numa janela por cima da tela, salva rascunho e conclui.
// O pedido só sai do DESIGN-GRID com o checklist concluído (trava no banco: stopball.finalizar_setor).
// Para trocar as perguntas, edite SECOES abaixo (cada item: chave única, texto, tipo 'check' ou 'simnao', obrigatório).
import { db, tem } from './estado.js';
import { h, modal, toast, msgErro, dataHora } from './util.js';

export const VERSAO_CHECKLIST = 1;
export const SECOES = [
  { titulo: 'Montagem de grid', itens: [
    { k: 'montagem', t: 'Verificar pedido, acabamento, layout, gola, cores, fontes, variáveis e escudos.', tipo: 'check', obrig: true },
  ] },
  { titulo: 'Tipos de escudo', itens: [
    { k: 'escudos', t: 'Confirmar o tipo aplicado e o tratamento correto de cada escudo antes da produção.', tipo: 'check', obrig: true },
  ] },
  { titulo: 'Ajustes finais', itens: [
    { k: 'ajustes', t: 'Revisar cores, fontes, nomes, acentos, caracteres e tamanho final da arte.', tipo: 'check', obrig: true },
  ] },
  { titulo: 'Validação final', itens: [
    { k: 'validacao', t: 'Houve teste de cor, pausa para correção ou ajuste de molde?', tipo: 'simnao', obrig: true },
  ] },
];
const TODOS = SECOES.flatMap(s => s.itens);

export const checklistOk = (p) => !!p.checklist_concluido_em;
export const ehGrid = (p) => p.setor === 'DESIGN-GRID';

// selo para os cartões do DESIGN-GRID
export function seloChecklist(p) {
  if (!ehGrid(p) && !p.checklist_concluido_em) return '';
  if (checklistOk(p)) return `<span class="chip ok" title="Concluído por ${h(p.checklist_concluido_por || '')} em ${h(dataHora(p.checklist_concluido_em))}">☑ Checklist ok</span>`;
  const resp = Object.keys(p.checklist?.itens || {}).length;
  return `<span class="chip alerta">☐ Checklist ${resp ? `${resp}/${TODOS.length}` : 'pendente'}</span>`;
}

export function abrirChecklist(p, depois) {
  const podeEditar = tem('design') || tem('pedidos');
  const r = p.checklist?.itens || {};
  const item = (it) => {
    const v = r[it.k];
    const dis = podeEditar ? '' : 'disabled';
    if (it.tipo === 'simnao') return `<div class="ck-item"><div>${h(it.t)}${it.obrig ? ' <span class="obrig">*</span>' : ''}</div>
      <div class="ck-sn">${['SIM', 'NÃO'].map(o => `<label><input type="radio" name="${it.k}" value="${o}" ${v === o ? 'checked' : ''} ${dis}> ${o}</label>`).join('')}</div></div>`;
    return `<label class="ck-item ck-check"><input type="checkbox" name="${it.k}" ${v === true ? 'checked' : ''} ${dis}><span>${h(it.t)}${it.obrig ? ' <span class="obrig">*</span>' : ''}</span></label>`;
  };
  const m = modal({
    titulo: `Checklist do grid · ${p.ordem}${p.lote ? ' · ' + p.lote : ''}`,
    corpo: `<form id="fck" class="ck">
      ${checklistOk(p) ? `<div class="ok-box">Concluído por <b>${h(p.checklist_concluido_por || '')}</b> em ${h(dataHora(p.checklist_concluido_em))}.</div>` : ''}
      <div class="ck-prog"><div class="ck-barra"><span id="ck-barra"></span></div><span id="ck-txt" class="muted peq"></span></div>
      ${SECOES.map(s => `<fieldset><legend>${h(s.titulo)}</legend>${s.itens.map(item).join('')}</fieldset>`).join('')}
      <label class="campo">Observações<textarea name="obs" rows="3" ${podeEditar ? '' : 'disabled'}>${h(p.checklist?.obs || '')}</textarea></label>
    </form>`,
    aoAbrir: (el) => {
      const f = el.querySelector('#fck');
      const prog = () => {
        const n = TODOS.filter(it => valor(f, it) != null).length;
        el.querySelector('#ck-barra').style.width = `${Math.round(n / TODOS.length * 100)}%`;
        el.querySelector('#ck-txt').textContent = `${n} de ${TODOS.length} respondidos`;
      };
      f.addEventListener('change', prog); prog();
    },
    botoes: podeEditar ? [
      { texto: 'Fechar' },
      { texto: 'Salvar rascunho', acao: (el) => salvar(el, false) },
      { texto: '✔ Concluir checklist', classe: 'pri', acao: (el) => salvar(el, true) },
    ] : [{ texto: 'Fechar' }],
  });
  async function salvar(el, concluir) {
    const f = el.querySelector('#fck');
    const itens = {};
    TODOS.forEach(it => { const v = valor(f, it); if (v != null) itens[it.k] = v; });
    if (concluir) {
      const falta = TODOS.filter(it => it.obrig && (itens[it.k] == null || itens[it.k] === false));
      if (falta.length) {
        toast(`Falta marcar ${falta.length} item(ns) obrigatório(s).`, 'erro');
        falta.forEach(it => f.querySelector(`[name="${it.k}"]`)?.closest('.ck-item')?.classList.add('falta'));
        return false;
      }
    }
    const { data, error } = await db.rpc('salvar_checklist', { p_pedido: p.id,
      p_checklist: { versao: VERSAO_CHECKLIST, itens, obs: f.obs.value.trim() || null }, p_concluir: concluir });
    if (error) { toast(msgErro(error), 'erro'); return false; }
    Object.assign(p, data);
    toast(concluir ? 'Checklist concluído. O pedido já pode sair do DESIGN-GRID.' : 'Rascunho salvo.', 'ok');
    depois && depois(p);
  }
  return m;
}

function valor(f, it) {
  if (it.tipo === 'simnao') return f.querySelector(`[name="${it.k}"]:checked`)?.value ?? null;
  return f.querySelector(`[name="${it.k}"]`).checked ? true : null;
}
