-- Capacidades úteis reimplementadas após a engenharia reversa do OpenReply.
-- A migração é aditiva e mantém compatibilidade com gatilhos já publicados.

alter table public.triggers
  add column if not exists keywords text[] not null default '{}',
  add column if not exists instagram_account_id uuid
    references public.instagram_accounts(id) on delete cascade,
  add column if not exists target_next_reel boolean not null default false;

-- A FK composta impede que um trigger de um workspace aponte para a conta de
-- outro workspace, mesmo se alguém contornar a API e escrever via PostgREST.
create unique index if not exists instagram_accounts_workspace_id_id_uidx
  on public.instagram_accounts (workspace_id, id);

alter table public.triggers
  drop constraint if exists triggers_workspace_instagram_account_fk,
  add constraint triggers_workspace_instagram_account_fk
    foreign key (workspace_id, instagram_account_id)
    references public.instagram_accounts (workspace_id, id)
    on delete cascade;

update public.triggers
set keywords = array[keyword]
where keyword is not null
  and cardinality(keywords) = 0;

alter table public.triggers
  drop constraint if exists triggers_keywords_count_check,
  drop constraint if exists triggers_next_reel_check;

alter table public.triggers
  add constraint triggers_keywords_count_check check (
    source = 'first_contact'
    or cardinality(keywords) between 1 and 20
  ),
  add constraint triggers_next_reel_check check (
    not target_next_reel
    or (
      source = 'comment'
      and post_id is null
      and instagram_account_id is not null
    )
  );

comment on column public.triggers.keywords is
  'Termos alternativos do gatilho; keyword preserva compatibilidade com clientes anteriores.';
comment on column public.triggers.instagram_account_id is
  'Conta específica do gatilho. Null mantém o comportamento legado de qualquer conta do workspace.';
comment on column public.triggers.target_next_reel is
  'Aguarda e vincula automaticamente o primeiro Reel publicado após a criação do gatilho.';

create index if not exists triggers_instagram_account_idx
  on public.triggers (instagram_account_id, source, is_active);
create index if not exists triggers_pending_next_reel_idx
  on public.triggers (created_at)
  where target_next_reel = true and is_active = true;

alter table public.instagram_accounts
  add column if not exists last_comment_reconcile_at timestamptz,
  add column if not exists comment_reconcile_error text,
  add column if not exists last_next_reel_check_at timestamptz,
  add column if not exists last_follower_snapshot_at timestamptz;

create table if not exists public.instagram_follower_snapshots (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instagram_account_id uuid not null
    references public.instagram_accounts(id) on delete cascade,
  day date not null,
  followers integer not null check (followers >= 0),
  is_estimated boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (instagram_account_id, day)
);

alter table public.instagram_follower_snapshots
  drop constraint if exists instagram_follower_snapshots_workspace_account_fk,
  add constraint instagram_follower_snapshots_workspace_account_fk
    foreign key (workspace_id, instagram_account_id)
    references public.instagram_accounts (workspace_id, id)
    on delete cascade;

comment on table public.instagram_follower_snapshots is
  'Totais absolutos diários; estimativas reconstruídas nunca substituem observações diretas.';

create index if not exists instagram_follower_snapshots_workspace_day_idx
  on public.instagram_follower_snapshots (workspace_id, day desc);

create trigger set_instagram_follower_snapshots_updated_at
  before update on public.instagram_follower_snapshots
  for each row execute procedure public.set_updated_at();

alter table public.instagram_follower_snapshots enable row level security;

drop policy if exists instagram_follower_snapshots_select
  on public.instagram_follower_snapshots;
create policy instagram_follower_snapshots_select
  on public.instagram_follower_snapshots for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke insert, update, delete on public.instagram_follower_snapshots
  from authenticated;
grant select on public.instagram_follower_snapshots to authenticated;
grant all on public.instagram_follower_snapshots to service_role;
