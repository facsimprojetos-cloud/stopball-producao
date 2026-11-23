-- STOPBALL · usuários (login por área), painel e Storage dos PDFs
create or replace function stopball.status_sistema()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(auth.jwt()->>'email'); v jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('usuario', null); end if;
  update stopball.usuarios u set id = auth.uid()
   where u.id is null and lower(u.email) = v_email
     and not exists (select 1 from stopball.usuarios x where x.id = auth.uid());
  select jsonb_build_object('usuario_id', u.usuario_id, 'nome', coalesce(nullif(u.nome, ''), u.email),
                            'email', u.email, 'perfis', u.perfis, 'ativo', u.ativo)
    into v from stopball.usuarios u
   where u.id = auth.uid() or lower(u.email) = v_email
   order by (u.id = auth.uid()) desc nulls last limit 1;
  return jsonb_build_object('usuario', v);
end $$;

create or replace function stopball._criar_conta_auth(p_email text, p_senha text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_email text := lower(trim(p_email));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido: %', p_email; end if;
  select id into v_id from auth.users where lower(email) = v_email;
  if v_id is not null then return v_id; end if;
  v_id := gen_random_uuid();
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_senha, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
  insert into auth.identities(id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  return v_id;
end $$;

create or replace function stopball._email_login(p_login text)
returns text language sql immutable set search_path = '' as $$
  select case when position('@' in trim(p_login)) > 0 then lower(trim(p_login)) else lower(trim(p_login)) || '@stopball.app' end;
$$;

create or replace function stopball.criar_usuario(p_login text, p_nome text, p_perfis text[], p_senha text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := stopball._email_login(p_login); v_interno boolean; v_id uuid; v_existia boolean;
begin
  perform stopball.exigir_perfil('admin');
  v_interno := v_email like '%@stopball.app';
  if v_interno and split_part(v_email, '@', 1) !~ '^[a-z0-9][a-z0-9._-]{2,30}$' then
    raise exception 'Usuário inválido: use de 3 a 31 letras minúsculas, números, ponto, hífen ou sublinhado, sem espaço nem acento.';
  end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome.'; end if;
  if coalesce(array_length(p_perfis, 1), 0) = 0 then raise exception 'Marque ao menos um perfil.'; end if;
  if exists (select 1 from stopball.usuarios where lower(email) = v_email) then raise exception 'Este login já é usuário do sistema.'; end if;
  v_existia := exists (select 1 from auth.users where lower(email) = v_email);
  if v_interno and v_existia then raise exception 'Este usuário já existe.'; end if;
  if v_interno and length(coalesce(p_senha, '')) < 6 then raise exception 'A senha precisa ter pelo menos 6 caracteres.'; end if;
  if v_interno or not v_existia then
    v_id := stopball._criar_conta_auth(v_email, coalesce(nullif(p_senha, ''), '123456'));
  else
    select id into v_id from auth.users where lower(email) = v_email;
  end if;
  insert into stopball.usuarios(id, nome, email, perfis, ativo) values (v_id, trim(p_nome), v_email, p_perfis, true);
  return jsonb_build_object('email', v_email, 'interno', v_interno, 'conta_existente', v_existia);
end $$;

create or replace function stopball.redefinir_senha(p_usuario_id bigint, p_senha text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  perform stopball.exigir_perfil('admin');
  select lower(email) into v_email from stopball.usuarios where usuario_id = p_usuario_id;
  if v_email is null then raise exception 'Usuário não encontrado.'; end if;
  if v_email not like '%@stopball.app' then
    raise exception 'Este login usa e-mail real (pode ser usado em outros apps). A pessoa deve usar "Esqueci minha senha".';
  end if;
  if length(coalesce(p_senha, '')) < 6 then raise exception 'A senha precisa ter pelo menos 6 caracteres.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
  where lower(email) = v_email;
  if not found then raise exception 'Conta de acesso não encontrada para %.', v_email; end if;
end $$;

-- Excluir usuário (só admin). Login de área: apaga também a conta de login. E-mail real: só tira o acesso.
create or replace function stopball.excluir_usuario(p_usuario_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u stopball.usuarios%rowtype; v_interno boolean;
begin
  perform stopball.exigir_perfil('admin');
  select * into u from stopball.usuarios where usuario_id = p_usuario_id;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  if lower(u.email) = lower(auth.jwt() ->> 'email') then raise exception 'Você não pode excluir o seu próprio usuário.'; end if;
  if 'admin' = any(u.perfis) and u.ativo and not exists (
       select 1 from stopball.usuarios x where x.usuario_id <> u.usuario_id and x.ativo and 'admin' = any(x.perfis)) then
    raise exception 'Não é possível excluir o último administrador ativo.';
  end if;
  v_interno := lower(u.email) like '%@stopball.app';
  delete from stopball.usuarios where usuario_id = u.usuario_id;
  if v_interno and u.id is not null then delete from auth.users where id = u.id; end if;
  return jsonb_build_object('email', u.email, 'conta_apagada', v_interno);
end $$;

-- Painel: contagem por setor (sem trazer os 5 mil pedidos)
create or replace function stopball.resumo_setores()
returns table (setor_id bigint, setor text, areas text[], ordem int, total bigint, em_andamento bigint, atrasados bigint, vence_hoje bigint)
language sql stable security definer set search_path = '' as $$
  select s.id, s.nome, s.areas, s.ordem, count(p.id),
    count(p.id) filter (where p.inicio_setor is not null),
    count(p.id) filter (where p.previsao_setor < (now() at time zone 'America/Sao_Paulo')::date),
    count(p.id) filter (where p.previsao_setor = (now() at time zone 'America/Sao_Paulo')::date)
  from stopball.setores s left join stopball.pedidos p on p.setor_id = s.id
  where stopball.eh_usuario() and s.ativo
  group by s.id order by s.ordem, s.nome;
$$;

revoke all on function stopball._criar_conta_auth(text,text), stopball._email_login(text) from public, anon, authenticated;
revoke all on function stopball.status_sistema(), stopball.criar_usuario(text,text,text[],text), stopball.redefinir_senha(bigint,text),
  stopball.excluir_usuario(bigint), stopball.resumo_setores() from public, anon;
grant execute on function stopball.status_sistema(), stopball.criar_usuario(text,text,text[],text), stopball.redefinir_senha(bigint,text),
  stopball.excluir_usuario(bigint), stopball.resumo_setores() to authenticated;
revoke all on function stopball._antes_pedido() from public, anon, authenticated;

-- Administrador inicial (mesmo dono dos outros apps)
insert into stopball.usuarios (nome, email, perfis) values ('Facsim Projetos', 'facsimprojetos@gmail.com', '{admin}')
on conflict (email) do nothing;

-- Storage: PDFs e fotos dos pedidos (bucket privado)
insert into storage.buckets (id, name, public, file_size_limit) values ('stopball', 'stopball', false, 26214400)
on conflict (id) do nothing;
create policy stopball_ler on storage.objects for select to authenticated
  using (bucket_id = 'stopball' and (select stopball.eh_usuario()));
create policy stopball_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'stopball' and ((select stopball.tem_perfil('pedidos')) or (select stopball.tem_perfil('design'))));
create policy stopball_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'stopball' and (select stopball.tem_perfil('admin')));
