-- Wal Chat — solicitações LGPD reais e avaliações publicadas somente com consentimento.

create table if not exists public.privacy_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  requester_email text not null check (char_length(requester_email) between 3 and 254),
  instagram_username text check (instagram_username is null or char_length(instagram_username) <= 80),
  reason text check (reason is null or char_length(reason) <= 1000),
  confirmation_code text not null unique check (char_length(confirmation_code) between 24 and 128),
  source text not null default 'public_form' check (source in ('public_form','support','authenticated_account')),
  status text not null default 'pending_verification'
    check (status in ('pending_verification','verified','processing','completed','rejected')),
  requested_at timestamptz not null default timezone('utc', now()),
  verified_at timestamptz,
  completed_at timestamptz,
  internal_notes text
);

create index if not exists privacy_deletion_status_requested_idx
  on public.privacy_deletion_requests (status, requested_at desc);

alter table public.privacy_deletion_requests enable row level security;
revoke all on public.privacy_deletion_requests from public, anon, authenticated;
grant all on public.privacy_deletion_requests to service_role;

create table if not exists public.customer_reviews (
  id uuid primary key default gen_random_uuid(),
  author_name text not null check (char_length(author_name) between 2 and 100),
  author_role text check (author_role is null or char_length(author_role) <= 100),
  company text check (company is null or char_length(company) <= 120),
  quote text not null check (char_length(quote) between 20 and 800),
  rating smallint not null check (rating between 1 and 5),
  source_url text check (source_url is null or source_url ~ '^https://'),
  is_verified boolean not null default false,
  consented_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint customer_review_publish_requires_consent check (
    published_at is null or (consented_at is not null and is_verified)
  )
);

create index if not exists customer_reviews_published_idx
  on public.customer_reviews (published_at desc)
  where published_at is not null and is_verified;

alter table public.customer_reviews enable row level security;
revoke all on public.customer_reviews from public, anon, authenticated;
grant all on public.customer_reviews to service_role;

comment on table public.privacy_deletion_requests is
  'Solicitações LGPD recebidas por formulário; PII acessível somente ao service role.';
comment on table public.customer_reviews is
  'Avaliações reais publicadas somente após verificação e consentimento explícito.';
