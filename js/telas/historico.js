// Histórico de apontamentos e tempo por setor
import { db } from '../estado.js';
import { h, chip, ler, num, data, dataHora, cadastros, opcoes, hojeISO } from '../util.js';
import { abrirPedido } from '../pedido.js';

const menos = (dias) => { const d = new Date(); d.setDate(d.getDate() - dias); return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); };
const f = { ini: menos(30), fim: hojeISO(), setor: '', operador: '' };

const horas = (ms) => ms / 36e5;
const fmtTempo = (hh) => hh == null ? '—' : hh < 1 ? `${Math.round(hh * 60)} min` : hh < 48 ? `${num(hh, 1)} h` : `${num(hh / 24, 1)} dias`;

export async function render(el) {
  const c = await cadastros(db);
  el.innerHTML = `
    <div class="cab"><div><h1>Histórico e tempos</h1><p>Cada linha é uma passagem de pedido por um setor. O tempo real (com hora) existe só para o que foi feito no app novo; o histórico do AppSheet tem apenas a data.</p></div></div>
    <form class="filtros" id="ff">
      <label class="campo">De<input type="date" name="ini" value="${f.ini}"></label>
      <label class="campo">Até<input type="date" name="fim" value="${f.fim}"></label>
      <label class="campo">Setor<select name="setor">${opcoes(c.setores, f.setor, 'nome', 'id', 'Todos')}</select></label>
      <label class="campo">Operador<select name="operador">${opcoes(c.operadores, f.operador, 'nome', 'id', 'Todos')}</select></label>
      <button class="btn" type="submit">Filtrar</button>
    </form>
    <div id="res"><div class="vazio"><div class="spinner" style="margin:auto"></div></div></div>`;
  const form = el.querySelector('#ff');
  form.onsubmit = (e) => { e.preventDefault(); Object.assign(f, { ini: form.ini.value, fim: form.fim.value, setor: form.setor.value, operador: form.operador.value }); carregar(); };

  async function carregar() {
    const res = el.querySelector('#res');
    const fimMais = new Date(f.fim + 'T00:00:00-03:00'); fimMais.setDate(fimMais.getDate() + 1);
    let q = db.from('apontamentos').select('id, inicio, fim, qtd, so_data, pedido_id, setor_id, operador_id, setores(nome), operadores(nome), pedidos(ordem, lote, artigo)')
      .gte('fim', f.ini + 'T00:00:00-03:00').lt('fim', fimMais.toISOString()).order('fim', { ascending: false }).limit(5000);
    if (f.setor) q = q.eq('setor_id', f.setor);
    if (f.operador) q = q.eq('operador_id', f.operador);
    const lista = await ler(q);
    const porSetor = {};
    lista.forEach(a => {
      const k = a.setores?.nome || '—';
      const s = (porSetor[k] ||= { n: 0, qtd: 0, tempos: [] });
      s.n++; s.qtd += Number(a.qtd) || 0;
      if (!a.so_data && a.inicio && a.fim) s.tempos.push(horas(new Date(a.fim) - new Date(a.inicio)));
    });
    const med = (arr) => { if (!arr.length) return null; const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    res.innerHTML = `
      <h3>Por setor no período</h3>
      <div class="tabela-wrap" style="margin-bottom:16px"><table><thead><tr><th>Setor</th><th>Passagens</th><th>Peças</th><th>Tempo mediano no setor</th><th>Medições com hora</th></tr></thead>
      <tbody>${Object.entries(porSetor).sort((a, b) => b[1].n - a[1].n).map(([k, s]) => `<tr><td class="forte">${h(k)}</td><td>${num(s.n)}</td><td>${num(s.qtd)}</td>
        <td>${fmtTempo(med(s.tempos))}</td><td>${num(s.tempos.length)}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Sem apontamentos no período.</td></tr>'}</tbody></table></div>
      <h3>Apontamentos (${num(lista.length)}${lista.length === 5000 ? ', limitado a 5.000' : ''})</h3>
      <div class="tabela-wrap"><table class="clicavel"><thead><tr><th>Fim</th><th>Ordem</th><th>Setor</th><th>Operador</th><th>Qtd</th><th>Tempo</th></tr></thead>
      <tbody>${lista.slice(0, 500).map(a => `<tr data-ped="${a.pedido_id || ''}"><td>${a.so_data ? data(a.fim) : dataHora(a.fim)}</td>
        <td class="forte">${h(a.pedidos?.ordem || '(pedido excluído)')}</td><td>${h(a.setores?.nome || '')}</td><td>${h(a.operadores?.nome || '')}</td>
        <td>${num(a.qtd)}</td><td>${a.so_data ? chip('só data') : fmtTempo(horas(new Date(a.fim) - new Date(a.inicio)))}</td></tr>`).join('')}</tbody></table></div>
      ${lista.length > 500 ? '<div class="muted peq">Mostrando os 500 mais recentes. Use os filtros para refinar.</div>' : ''}`;
    res.querySelectorAll('tr[data-ped]').forEach(tr => { if (tr.dataset.ped) tr.onclick = () => abrirPedido(tr.dataset.ped); });
  }
  carregar();
}
