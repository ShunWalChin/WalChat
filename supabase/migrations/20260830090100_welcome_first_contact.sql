-- Boas-vindas ao primeiro contato.
--
-- A Instagram API não entrega evento de novo seguidor, e a política de
-- mensageria só abre a janela de 24h quando o contato escreve primeiro. Logo, o
-- evento acionável equivalente não é "seguiu", é "falou pela primeira vez" — e
-- é esse que esta origem de gatilho representa.
--
-- Nenhum motor novo: a origem entra no mesmo `triggers`, aponta para o mesmo
-- DAG e herda compliance, idempotência e versionamento já existentes.
--
-- O valor de enum vem na migration anterior porque o Postgres exige que ele
-- esteja comitado antes de ser referenciado por constraint ou índice.

-- `keyword` existe porque toda origem anterior casa por palavra. O primeiro
-- contato dispara pelo fato de ser o primeiro, não pelo que a pessoa escreveu.
alter table public.triggers alter column keyword drop not null;

alter table public.triggers
  drop constraint if exists triggers_keyword_required_by_source;
alter table public.triggers
  add constraint triggers_keyword_required_by_source
  check (
    (source = 'first_contact' and keyword is null)
    or (source <> 'first_contact' and keyword is not null)
  );

comment on column public.triggers.keyword is
  'Palavra que aciona o gatilho. Nula apenas em first_contact, que dispara pelo primeiro contato do contato e não por texto.';

-- Quais canais contam como primeiro contato. Sem isto, um primeiro comentário e
-- uma primeira DM seriam indistinguíveis, e quem quer saudar só quem chega no
-- direto não teria como.
alter table public.triggers
  add column if not exists first_contact_channels text[]
    not null default array['dm']::text[];

alter table public.triggers
  drop constraint if exists triggers_first_contact_channels_valid;
alter table public.triggers
  add constraint triggers_first_contact_channels_valid
  check (
    source <> 'first_contact'
    or (
      array_length(first_contact_channels, 1) between 1 and 4
      and first_contact_channels <@ array['dm','comment','story_reply','mention']::text[]
    )
  );

comment on column public.triggers.first_contact_channels is
  'Canais que contam como primeiro contato. Só se aplica a source = first_contact.';

-- Um gatilho de boas-vindas por workspace. Sem esta restrição, dois gatilhos de
-- primeiro contato competiriam e o mais antigo venceria em silêncio — a mesma
-- armadilha que já existe nas outras origens.
create unique index if not exists triggers_one_welcome_per_workspace
  on public.triggers (workspace_id)
  where source = 'first_contact';
