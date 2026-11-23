import { db, ctx } from '../estado.js';
import { h, chip, modal, ler, toast, msgErro, confirmar } from '../util.js';
import { DOMINIO_INTERNO } from '../config.js';

const PERFIS = [
  ['admin', 'Administrador (tudo, inclusive usuários e cadastros)'],
  ['pedidos', 'Pedidos (cadastra, edita e corrige pedidos)'],
  ['design', 'Design (setores DESIGN-*, checklist do grid)'],
  ['sublimado', 'Produção sublimado (calandra, laser, separação, prensa, bordado)'],
  ['uniforme', 'Produção uniforme (corte manual, calandra, silk, prensa, bordado)'],
  ['logistica', 'Logística interna (separação, logística, costura, facção)'],
  ['bolsas', 'Facção de bolsas (facção, revisão)'],
  ['acabamento', 'Acabamento (triagem, revisão, expedição, entregue)'],
];
const interno = (email) => String(email || '').toLowerCase().endsWith('@' + DOMINIO_INTERNO);
const loginDe = (email) => interno(email) ? email.split('@')[0] : email;

export async function render(el) {
  const usuarios = await ler(db.from('usuarios').select('*').order('ativo', { ascending: false }).order('nome'));
  el.innerHTML = `
    <div class="cab"><div><h1>Usuários</h1><p>Donos e equipe entram com e-mail e senha (o e-mail precisa estar aqui). Cada área entra com <b>usuário e senha</b> criados nesta tela (ex.: usuário <b>design</b>).</p></div>
      <button class="btn pri" id="novo">+ Novo usuário</button></div>
    <div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>Login</th><th>Perfis</th><th>Status</th><th></th></tr></thead>
      <tbody>${usuarios.map(u => `<tr><td class="forte">${h(u.nome || '')}</td>
        <td>${h(loginDe(u.email))} ${interno(u.email) ? chip('usuário e senha', 'info') : chip('e-mail / Google')}</td>
        <td>${(u.perfis || []).map(p => chip(p, p === 'admin' ? 'acento' : '')).join(' ')}</td>
        <td>${u.ativo ? chip('Ativo', 'ok') : chip('Inativo', 'erro')}</td>
        <td style="white-space:nowrap"><button class="btn peq" data-ed="${u.usuario_id}">Editar</button>
          ${interno(u.email) ? `<button class="btn peq" data-senha="${u.usuario_id}">Redefinir senha</button>` : ''}
          ${String(u.email).toLowerCase() !== String(ctx.usuario?.email || '').toLowerCase() ? `<button class="btn peq perigo" data-exc="${u.usuario_id}">Excluir</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  const recarregar = () => render(el);
  el.querySelector('#novo').onclick = () => form(null, recarregar);
  el.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => form(usuarios.find(u => String(u.usuario_id) === b.dataset.ed), recarregar));
  el.querySelectorAll('[data-senha]').forEach(b => b.onclick = () => senha(usuarios.find(u => String(u.usuario_id) === b.dataset.senha)));
  el.querySelectorAll('[data-exc]').forEach(b => b.onclick = () => excluir(usuarios.find(u => String(u.usuario_id) === b.dataset.exc), recarregar));
}

async function excluir(u, depois) {
  const login = loginDe(u.email);
  const txt = interno(u.email)
    ? `Excluir <b>${h(u.nome || login)}</b> (usuário <b>${h(login)}</b>)? O login e a senha deixam de existir e quem usa esse acesso não entra mais. O histórico continua.`
    : `Excluir <b>${h(u.nome || login)}</b> (${h(u.email)})? Esse e-mail perde o acesso ao Stopball. O histórico continua.`;
  if (!await confirmar('Excluir usuário', txt, 'Excluir', 'perigo')) return;
  const { error } = await db.rpc('excluir_usuario', { p_usuario_id: u.usuario_id });
  if (error) return toast(msgErro(error), 'erro');
  toast(`Usuário ${login} excluído.`, 'ok');
  depois();
}

function caixasPerfis(sel) {
  return `<div><b>Perfis</b>${PERFIS.map(([k, r]) => `<label style="display:block;margin:6px 0"><input type="checkbox" name="perfil" value="${k}" ${sel.includes(k) ? 'checked' : ''}> ${h(r)}</label>`).join('')}</div>`;
}

function form(u, depois) {
  modal({
    titulo: u ? `Editar ${u.nome || u.email}` : 'Novo usuário',
    corpo: `<form id="fu" class="grade">
      ${u ? `<div class="muted">Login: <b>${h(loginDe(u.email))}</b></div>` : `
        <div class="abas" id="tipo"><button type="button" class="ativo" data-t="int">Usuário e senha (área)</button><button type="button" data-t="mail">E-mail / Google</button></div>
        <label class="campo" id="lb-login">Usuário<input name="login" required autocapitalize="none" spellcheck="false" placeholder="ex.: design"></label>
        <label class="campo" id="lb-senha">Senha (mín. 6)<input name="senha" type="text" minlength="6" autocomplete="off"></label>`}
      <label class="campo">Nome<input name="nome" value="${h(u?.nome || '')}" required></label>
      ${caixasPerfis(u?.perfis || (u ? [] : []))}
      ${u ? `<label><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''}> Acesso ativo</label>` : ''}
    </form>`,
    aoAbrir: (m) => {
      const tipo = m.querySelector('#tipo'); if (!tipo) return;
      tipo.querySelectorAll('button').forEach(b => b.onclick = () => {
        tipo.querySelectorAll('button').forEach(x => x.classList.toggle('ativo', x === b));
        const mail = b.dataset.t === 'mail';
        m.querySelector('#lb-login').firstChild.textContent = mail ? 'E-mail' : 'Usuário';
        m.querySelector('[name=login]').placeholder = mail ? 'nome@gmail.com' : 'ex.: design';
        m.querySelector('#lb-senha').style.display = mail ? 'none' : '';
      });
    },
    botoes: [{ texto: 'Cancelar' }, {
      texto: 'Salvar', classe: 'pri', acao: async (m) => {
        const f = m.querySelector('#fu'); if (!f.reportValidity()) return false;
        const sel = [...f.querySelectorAll('[name=perfil]:checked')].map(i => i.value);
        if (!sel.length) { toast('Marque ao menos um perfil.', 'erro'); return false; }
        if (u) {
          const souEu = String(u.email).toLowerCase() === String(ctx.email).toLowerCase();
          if (souEu && (!sel.includes('admin') || !f.ativo.checked)) { toast('Você não pode remover o seu próprio acesso de administrador.', 'erro'); return false; }
          const { error } = await db.from('usuarios').update({ nome: f.nome.value.trim(), perfis: sel, ativo: f.ativo.checked }).eq('usuario_id', u.usuario_id);
          if (error) { toast(msgErro(error), 'erro'); return false; }
          toast('Usuário salvo.', 'ok'); return depois();
        }
        const mail = m.querySelector('#tipo .ativo').dataset.t === 'mail';
        const login = f.login.value.trim();
        if (mail && !login.includes('@')) { toast('Informe um e-mail válido.', 'erro'); return false; }
        if (!mail && login.includes('@')) { toast('O usuário não pode ter @. Para e-mail, use a aba "E-mail / Google".', 'erro'); return false; }
        if (!mail && f.senha.value.length < 6) { toast('A senha precisa ter pelo menos 6 caracteres.', 'erro'); return false; }
        const { data, error } = await db.rpc('criar_usuario', { p_login: login, p_nome: f.nome.value.trim(), p_perfis: sel, p_senha: mail ? null : f.senha.value });
        if (error) { toast(msgErro(error), 'erro'); return false; }
        toast(data.interno ? `Usuário "${login.toLowerCase()}" criado. Entra com essa senha.`
          : data.conta_existente ? 'Liberado. Este e-mail já tinha conta: entra com a senha que já usa.'
          : 'Liberado. A pessoa entra com o e-mail e a senha inicial 123456.', 'ok');
        depois();
      }
    }]
  });
}

function senha(u) {
  modal({
    titulo: `Redefinir senha · ${loginDe(u.email)}`,
    corpo: `<form id="fs" class="grade"><label class="campo">Nova senha (mín. 6)<input name="s" type="text" minlength="6" required autocomplete="off"></label></form>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Redefinir', classe: 'pri', acao: async (m) => {
      const f = m.querySelector('#fs'); if (!f.reportValidity()) return false;
      const { error } = await db.rpc('redefinir_senha', { p_usuario_id: u.usuario_id, p_senha: f.s.value });
      if (error) { toast(msgErro(error), 'erro'); return false; }
      toast('Senha redefinida.', 'ok');
    } }]
  });
}
