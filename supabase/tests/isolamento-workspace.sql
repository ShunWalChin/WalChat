-- Invariante de isolamento entre workspaces.
--
-- O WalChat serve todo acesso por rota de servidor com `service_role`, que
-- ignora RLS. O isolamento real, hoje, é o filtro de `workspace_id` no código.
-- Este arquivo trava as duas propriedades que o banco ainda precisa garantir
-- caso um JWT de usuário vaze e alguém fale com o PostgREST direto.
--
-- Parte A — tabela COM policy: o membro do workspace A enxerta a própria linha
--            e nenhuma do workspace B.
-- Parte B — tabela com RLS ligado e NENHUMA policy: `authenticated` não enxerga
--            linha alguma. Não é detalhe: é o que impede que uma policy
--            permissiva adicionada sem querer abra `contacts` para o mundo.
--
-- Antes de qualquer asserção existe um caso de controle. Sem ele, o teste
-- passaria com a tabela vazia e não provaria nada.

\set ON_ERROR_STOP on

begin;

-- ── Massa de teste ──────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dono-a@exemplo.test'),
  ('22222222-2222-2222-2222-222222222222', 'dono-b@exemplo.test');

insert into public.workspaces (id, owner_id, name, slug) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'Workspace A', 'workspace-a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 'Workspace B', 'workspace-b');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 'owner');

insert into public.contacts (workspace_id, instagram_user_id, username) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ig-a', 'contato_a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ig-b', 'contato_b');

-- ── Controle: as linhas existem mesmo ───────────────────────────────────────
do $$
declare
  total_workspaces int;
  total_contatos int;
begin
  select count(*) into total_workspaces from public.workspaces;
  select count(*) into total_contatos from public.contacts;

  if total_workspaces <> 2 then
    raise exception
      'CONTROLE FALHOU: esperava 2 workspaces, encontrei %', total_workspaces;
  end if;
  if total_contatos <> 2 then
    raise exception
      'CONTROLE FALHOU: esperava 2 contatos, encontrei %', total_contatos;
  end if;
  raise notice 'controle ok: 2 workspaces e 2 contatos existem';
end
$$;

-- ── Parte A — tabela com policy ─────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  visiveis int;
  vazou int;
begin
  select count(*) into visiveis from public.workspaces;
  select count(*) into vazou
    from public.workspaces
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  if visiveis <> 1 then
    raise exception
      'ISOLAMENTO FALHOU: dono de A enxerga % workspaces, esperava 1', visiveis;
  end if;
  if vazou <> 0 then
    raise exception
      'VAZAMENTO: dono de A enxerga o workspace B';
  end if;
  raise notice 'parte A ok: workspaces isolados por policy';
end
$$;

-- ── Parte B — tabela com RLS e sem policy ───────────────────────────────────
do $$
declare
  visiveis int;
begin
  select count(*) into visiveis from public.contacts;

  if visiveis <> 0 then
    raise exception
      'POSTURA MUDOU: `authenticated` enxerga % contatos. A tabela contacts '
      'tem RLS ligado e nenhuma policy, então o esperado é zero. Se uma policy '
      'foi adicionada de propósito, mova contacts para a Parte A deste teste '
      'e prove o isolamento entre os dois workspaces.', visiveis;
  end if;
  raise notice 'parte B ok: contacts fechado para authenticated';
end
$$;

reset role;

rollback;

\echo 'invariante de isolamento entre workspaces: aprovado'
