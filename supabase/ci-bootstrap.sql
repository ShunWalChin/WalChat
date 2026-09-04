-- Andaime mínimo do Supabase para validar migrations num Postgres puro no CI.
--
-- Não substitui o Supabase: cria só o que as migrations referenciam para que o
-- DDL possa ser aplicado de verdade. O objetivo é provar que o schema aplica e
-- que as restrições compilam — não emular a plataforma.

create schema if not exists extensions;
create schema if not exists auth;

create extension if not exists pgcrypto with schema extensions;

-- Papéis usados pelos grants das migrations.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- `auth.users` é alvo de 42 chaves estrangeiras nas migrations.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

grant select on auth.users to anon, authenticated, service_role;

-- No Supabase, `auth.uid()` lê o claim do JWT da requisição. Aqui lê uma
-- configuração de sessão, o que permite ao teste de isolamento assumir a
-- identidade de um usuário com `set local request.jwt.claim.sub`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claim.sub', true),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;
