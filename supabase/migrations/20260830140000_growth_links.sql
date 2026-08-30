-- Links de captação com origem rastreada.
--
-- É o caminho público que a Meta abre para trazer gente de fora para o direct:
-- `ig.me/<usuario>?ref=<origem>` deep-linka na conversa, abre a janela de 24h e
-- dispara o webhook dizendo de onde a pessoa veio.
--
-- O `ref` é o que a Meta devolve e o que liga a visita ao link. Ele precisa ser
-- único por workspace, senão duas campanhas diferentes ficariam indistinguíveis
-- no relatório.

create table if not exists public.growth_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  -- A Meta aceita até 2.083 caracteres, alfanumérico com hífen, sublinhado e
  -- igual. O check reproduz a regra dela para o banco recusar antes da API.
  -- O alfabeto e o tamanho são checados separados de propósito: o motor de
  -- regex do Postgres recusa contagem de repetição acima de 255, e a
  -- expressão só é compilada na primeira inserção — um teto grande dentro
  -- das chaves cria a tabela sem reclamar e derruba todo insert depois.
  ref text not null check (
    ref ~ '^[A-Za-z0-9_=-]+$' and char_length(ref) <= 2083
  ),
  is_active boolean not null default true,
  -- Fluxo próprio deste link. Sem ele, a visita cai na saudação geral.
  flow_id uuid references public.automation_flows(id) on delete set null,
  clicks integer not null default 0 check (clicks >= 0),
  last_click_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, ref)
);

comment on table public.growth_links is
  'Links ig.me com parâmetro de origem. O ref é a chave que o webhook devolve.';
comment on column public.growth_links.clicks is
  'Visitas atribuídas por webhook, não cliques no link: a Meta só avisa quando a conversa abre.';

alter table public.growth_links enable row level security;

drop policy if exists growth_links_select on public.growth_links;
create policy growth_links_select on public.growth_links
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists growth_links_manage on public.growth_links;
create policy growth_links_manage on public.growth_links
  for all to authenticated
  using (
    public.has_workspace_role(
      workspace_id, array['owner','admin']::public.workspace_role[]
    )
  )
  with check (
    public.has_workspace_role(
      workspace_id, array['owner','admin']::public.workspace_role[]
    )
  );

create index if not exists growth_links_workspace_idx
  on public.growth_links (workspace_id, created_at desc);

-- Guarda de onde cada contato veio. Sem isto, saber que houve uma visita não
-- diria quem chegou por qual campanha.
alter table public.contacts
  add column if not exists growth_ref text;

create index if not exists contacts_growth_ref_idx
  on public.contacts (workspace_id, growth_ref)
  where growth_ref is not null;

comment on column public.contacts.growth_ref is
  'Origem do primeiro contato, quando ele chegou por um link de captação.';

create trigger set_growth_links_updated_at
  before update on public.growth_links
  for each row execute procedure public.set_updated_at();
