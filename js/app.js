import { EMPRESA, DOMINIO_INTERNO, LOGIN_GOOGLE } from './config.js';
import { db, ctx, tem } from './estado.js';
// Versão publicada: muda a cada atualização para o navegador não usar telas antigas do cache
const VERSAO = '202611231200'; // atualizar a cada publicação
import { h, toast, modal } from './util.js';

// Chegou pelo link de "Esqueci minha senha" do e-mail?
let recuperandoSenha = /type=recovery/.test(location.hash);


// ---------- Menu / rotas ----------
const ROTAS = [
  { grupo: 'Produção' },
  { hash: '#/painel', nome: 'Painel por setor', ico: '🏭', modulo: 'painel' },
  { hash: '#/pedidos', nome: 'Pedidos', ico: '📋', modulo: 'pedidos' },
  { hash: '#/reposicoes', nome: 'Reposições', ico: '♻️', modulo: 'reposicoes' },
  { hash: '#/historico', nome: 'Histórico e tempos', ico: '⏱️', modulo: 'historico' },
  { grupo: 'Gestão' },
  { hash: '#/cadastros', nome: 'Cadastros', ico: '🗂️', modulo: 'cadastros', perfil: 'admin' },
  { hash: '#/usuarios', nome: 'Usuários', ico: '👥', modulo: 'usuarios', perfil: 'admin' },
];
const podeVer = (r) => !r.perfil || [].concat(r.perfil).some(p => tem(p));
const rotasVisiveis = () => ROTAS.filter(r => r.hash && podeVer(r));

const cacheModulos = {};
async function carregarModulo(nome) {
  if (!cacheModulos[nome]) cacheModulos[nome] = await import(`./telas/${nome}.js?v=${VERSAO}`);
  return cacheModulos[nome];
}

function montarLayout() {
  const app = document.getElementById('app');
  const visiveis = rotasVisiveis();
  let itens = '', grupo = null;
  for (const r of ROTAS) {
    if (r.grupo) { grupo = r.grupo; continue; }
    if (!visiveis.includes(r) || r.menu === false) continue;
    if (grupo) { itens += `<div class="grupo">${h(grupo)}</div>`; grupo = null; }
    itens += `<a href="${r.hash}" data-hash="${r.hash}"><span class="ico">${r.ico}</span>${h(r.nome)}</a>`;
  }
  app.innerHTML = `
    <div class="topo-mobile"><button id="abre-menu" aria-label="Abrir menu">☰</button><span class="t">${h(EMPRESA)}</span></div>
    <div class="layout">
      <aside class="lateral" id="lateral">
        <div class="marca">${h(EMPRESA)}<small>Gestão da produção</small></div>
        <nav class="menu">${itens}</nav>
        <div class="usuario-box">
          <div class="nome">${h(ctx.nome)}</div>
          <div class="muted peq">${h(ctx.perfis.join(', '))}</div>
          <div class="acoes" style="display:flex;gap:6px;flex-wrap:wrap">
            ${ctx.provedor === 'email' ? '<button class="btn peq" id="minha-senha">Minha senha</button>' : ''}
            <button class="btn peq" id="sair">Sair</button>
          </div>
        </div>
      </aside>
      <main class="conteudo" id="conteudo"></main>
    </div>`;
  document.getElementById('minha-senha')?.addEventListener('click', trocarMinhaSenha);
  document.getElementById('sair').onclick = async () => { await db.auth.signOut(); location.hash = ''; location.reload(); };
  const lateral = document.getElementById('lateral');
  document.getElementById('abre-menu').onclick = () => {
    lateral.classList.add('aberta');
    const f = document.createElement('div'); f.className = 'fundo-menu';
    f.onclick = () => { lateral.classList.remove('aberta'); f.remove(); };
    document.body.appendChild(f);
  };
  lateral.querySelectorAll('.menu a').forEach(a => a.addEventListener('click', () => {
    lateral.classList.remove('aberta'); document.querySelector('.fundo-menu')?.remove();
  }));
}

let navSeq = 0;
async function navegar() {
  const visiveis = rotasVisiveis();
  const el = document.getElementById('conteudo');
  document.querySelectorAll('#modal-raiz .modal-fundo').forEach(m => m.remove()); // trocar de tela fecha janelas abertas
  if (!visiveis.length) { el.innerHTML = '<div class="card">Seu perfil ainda não tem telas liberadas nesta versão.</div>'; return; }
  const hash = location.hash || visiveis[0].hash;
  const rota = ROTAS.find(r => r.hash && hash.startsWith(r.hash)) || visiveis[0];
  document.querySelectorAll('.menu a').forEach(a => a.classList.toggle('ativo', a.dataset.hash === (rota.marca || rota.hash)));
  if (!podeVer(rota)) { el.innerHTML = '<div class="card">Acesso restrito.</div>'; return; }
  const seq = ++navSeq;
  el.innerHTML = '<div class="vazio"><div class="spinner" style="margin:auto"></div></div>';
  try {
    const mod = await carregarModulo(rota.modulo);
    if (seq !== navSeq) return;
    await mod.render(el);
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="card erro-box">Erro ao abrir a tela: ${h(e.message || e)}</div>`;
  }
}
export function recarregarTela() { navegar(); }

// ---------- Autenticação ----------
// "design" → design@stopball.app ; e-mail real fica como está
export function emailDoLogin(login) {
  const l = String(login || '').trim().toLowerCase();
  return l.includes('@') ? l : `${l}@${DOMINIO_INTERNO}`;
}

function telaLogin(msg = '', tipo = 'erro') {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login"><div class="card">
      <div class="marca-login">${h(EMPRESA)}</div>
      <div class="sub">Gestão da produção</div>
      ${msg ? `<div class="${tipo}-box">${h(msg)}</div>` : ''}
      ${LOGIN_GOOGLE ? `<button class="btn" type="button" id="google" style="width:100%;margin-bottom:12px">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Entrar com o Google</button>
      <div class="muted peq" style="text-align:center;margin-bottom:8px">ou com usuário e senha</div>` : ''}
      <form id="f-login" class="grade">
        <label class="campo">Usuário ou e-mail<input name="login" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
        <label class="campo">Senha<input type="password" name="senha" required minlength="6" autocomplete="current-password"></label>
        <button class="btn pri" type="submit">Entrar</button>
        <button class="btn peq" type="button" id="esqueci" style="border:0">Esqueci minha senha</button>
      </form>
      <p class="muted peq" style="margin-top:10px">Cada área entra com o usuário e a senha que o administrador criou (ex.: design). Se esquecer, peça ao administrador para redefinir.</p>
    </div></div>`;
  const f = document.getElementById('f-login');
  const btGoogle = document.getElementById('google');
  if (btGoogle) btGoogle.onclick = async () => {
    const { error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    if (error) telaLogin(/provider is not enabled|Unsupported provider/i.test(error.message)
      ? 'O login com Google ainda não foi ativado no Supabase. Use usuário e senha.' : traduzErroAuth(error.message));
  };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const { login, senha } = Object.fromEntries(new FormData(f));
    const { error } = await db.auth.signInWithPassword({ email: emailDoLogin(login), password: senha });
    if (error) telaLogin(traduzErroAuth(error.message));
  };
  document.getElementById('esqueci').onclick = async () => {
    const { login } = Object.fromEntries(new FormData(f));
    if (!login || !login.includes('@')) return telaLogin('Para receber o link, digite seu e-mail. Logins de área (sem e-mail) são redefinidos pelo administrador.');
    const { error } = await db.auth.resetPasswordForEmail(login.trim(), { redirectTo: location.origin + location.pathname });
    telaLogin(error ? traduzErroAuth(error.message) : 'Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Veja também a caixa de spam.', error ? 'erro' : 'ok');
  };
}

function traduzErroAuth(m) {
  if (/Invalid login credentials/i.test(m)) return 'Usuário ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link recebido antes de entrar.';
  if (/Password should be/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/should be different/i.test(m)) return 'A nova senha precisa ser diferente da atual.';
  if (/rate limit|security purposes/i.test(m)) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
  return m;
}

// ---------- Senha ----------
const CAMPOS_NOVA_SENHA = `
  <label class="campo">Nova senha<input type="password" name="nova" required minlength="6" autocomplete="new-password"></label>
  <label class="campo">Repita a nova senha<input type="password" name="repete" required minlength="6" autocomplete="new-password"></label>`;

function validarNova(f) {
  const nova = f.nova.value, repete = f.repete.value;
  if (nova.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (nova !== repete) return 'As duas senhas não são iguais.';
  return '';
}

function telaNovaSenha(msg = '') {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login"><div class="card">
      <div class="marca-login">${h(EMPRESA)}</div>
      <div class="sub">Criar nova senha</div>
      ${msg ? `<div class="erro-box">${h(msg)}</div>` : ''}
      <form id="f-nova" class="grade">${CAMPOS_NOVA_SENHA}
        <button class="btn pri" type="submit">Salvar nova senha</button>
      </form>
    </div></div>`;
  const f = document.getElementById('f-nova');
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const erro = validarNova(f); if (erro) return telaNovaSenha(erro);
    const { error } = await db.auth.updateUser({ password: f.nova.value });
    if (error) return telaNovaSenha(traduzErroAuth(error.message));
    recuperandoSenha = false;
    if (location.hash.includes('type=recovery')) history.replaceState(null, '', location.pathname);
    toast('Senha alterada.', 'ok');
    iniciar();
  };
}

function trocarMinhaSenha() {
  modal({
    titulo: 'Alterar minha senha',
    corpo: `<form id="f-senha" class="grade">
      <label class="campo">Senha atual<input type="password" name="atual" required autocomplete="current-password"></label>
      ${CAMPOS_NOVA_SENHA}
    </form>`,
    botoes: [{ texto: 'Cancelar' }, {
      texto: 'Salvar', classe: 'pri', acao: async (m) => {
        const f = m.querySelector('#f-senha'); if (!f.reportValidity()) return false;
        const erro = validarNova(f); if (erro) { toast(erro, 'erro'); return false; }
        const conf = await db.auth.signInWithPassword({ email: ctx.email, password: f.atual.value });
        if (conf.error) { toast('Senha atual incorreta.', 'erro'); return false; }
        const { error } = await db.auth.updateUser({ password: f.nova.value });
        if (error) { toast(traduzErroAuth(error.message), 'erro'); return false; }
        toast('Senha alterada.', 'ok');
      }
    }]
  });
}

function telaSemAcesso(status, email) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login"><div class="card">
      <div class="marca-login">${h(EMPRESA)}</div>
      <div class="sub">${h(email)}</div>
      ${status.usuario && !status.usuario.ativo
        ? `<div class="erro-box">Seu acesso está desativado. Fale com o administrador.</div>`
        : `<div class="aviso-box">Este login não está cadastrado no app Stopball. Peça ao administrador para liberar o e-mail <b>${h(email)}</b> em <b>Usuários</b>.</div>`}
      <button class="btn" id="sair2" style="margin-top:10px;width:100%">Sair</button>
    </div></div>`;
  document.getElementById('sair2').onclick = async () => { await db.auth.signOut(); location.reload(); };
}

let iniciando = false;
async function iniciar() {
  if (iniciando) return;
  iniciando = true;
  try { await iniciarSessao(); } finally { iniciando = false; }
}
async function iniciarSessao() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return telaLogin();
  if (recuperandoSenha) return telaNovaSenha();
  const { data: status, error } = await db.rpc('status_sistema');
  if (error) {
    const msg = /schema must be one of|Invalid schema/i.test(error.message)
      ? 'O schema "stopball" ainda não foi liberado na API do Supabase (Settings → Data API → Exposed schemas).'
      : error.message;
    document.getElementById('app').innerHTML = `<div class="login"><div class="card"><div class="erro-box">${h(msg)}</div>
      <button class="btn" onclick="location.reload()">Tentar novamente</button></div></div>`;
    return;
  }
  if (!status.usuario || !status.usuario.ativo) return telaSemAcesso(status, session.user.email);
  ctx.usuario = session.user; ctx.email = session.user.email;
  ctx.provedor = session.user.app_metadata?.provider || 'email';
  ctx.nome = status.usuario.nome; ctx.perfis = status.usuario.perfis || [];
  if (/access_token=|^#$/.test(location.hash)) history.replaceState(null, '', location.pathname);
  montarLayout();
  window.addEventListener('hashchange', navegar);
  navegar();
}

db.auth.onAuthStateChange((evento) => {
  if (evento === 'PASSWORD_RECOVERY') { recuperandoSenha = true; return telaNovaSenha(); }
  if (evento === 'SIGNED_IN' && !ctx.usuario && !recuperandoSenha) setTimeout(iniciar, 0);
});

iniciar();
