-- Wal Chat — atribuição Click-to-WhatsApp (CTWA) e CAPI Business Messaging.
-- O click ID fica restrito ao backend; o CRM recebe apenas contexto seguro do
-- anúncio. Eventos externos continuam saindo pela outbox existente.

alter table public.contact_ad_attributions
  add column if not exists ctwa_clid text
    check (ctwa_clid is null or char_length(ctwa_clid) between 1 and 512),
  add column if not exists ctwa_source_id text
    check (ctwa_source_id is null or char_length(ctwa_source_id) between 1 and 128),
  add column if not exists ctwa_source_url text
    check (
      ctwa_source_url is null or (
        char_length(ctwa_source_url) <= 2048 and
        ctwa_source_url ~ '^https?://'
      )
    ),
  add column if not exists ctwa_source_type text
    check (ctwa_source_type is null or char_length(ctwa_source_type) between 1 and 32),
  add column if not exists ctwa_headline text
    check (ctwa_headline is null or char_length(ctwa_headline) <= 500),
  add column if not exists ctwa_body text
    check (ctwa_body is null or char_length(ctwa_body) <= 1000),
  add column if not exists ctwa_media_type text
    check (ctwa_media_type is null or char_length(ctwa_media_type) between 1 and 32),
  add column if not exists ctwa_waba_id text
    check (ctwa_waba_id is null or char_length(ctwa_waba_id) between 1 and 80),
  add column if not exists ctwa_received_at timestamptz;

create index if not exists contact_ad_attributions_ctwa_source_idx
  on public.contact_ad_attributions (
    workspace_id,
    ctwa_source_id,
    ctwa_received_at desc
  )
  where ctwa_source_id is not null;

alter table public.ad_conversion_rules
  drop constraint if exists ad_conversion_rules_meta_action_source_check;
alter table public.ad_conversion_rules
  add constraint ad_conversion_rules_meta_action_source_check
  check (meta_action_source in (
    'website', 'app', 'phone_call', 'chat', 'email', 'other',
    'physical_store', 'business_messaging', 'system_generated'
  ));

create or replace function private.preserve_ad_attribution_touches()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.gclid := coalesce(old.gclid, new.gclid);
  new.gbraid := coalesce(old.gbraid, new.gbraid);
  new.wbraid := coalesce(old.wbraid, new.wbraid);
  new.fbclid := coalesce(old.fbclid, new.fbclid);
  new.fbc := coalesce(old.fbc, new.fbc);
  new.fbp := coalesce(old.fbp, new.fbp);
  new.ctwa_clid := coalesce(old.ctwa_clid, new.ctwa_clid);
  new.ctwa_source_id := coalesce(old.ctwa_source_id, new.ctwa_source_id);
  new.ctwa_source_url := coalesce(old.ctwa_source_url, new.ctwa_source_url);
  new.ctwa_source_type := coalesce(old.ctwa_source_type, new.ctwa_source_type);
  new.ctwa_headline := coalesce(old.ctwa_headline, new.ctwa_headline);
  new.ctwa_body := coalesce(old.ctwa_body, new.ctwa_body);
  new.ctwa_media_type := coalesce(old.ctwa_media_type, new.ctwa_media_type);
  new.ctwa_waba_id := coalesce(old.ctwa_waba_id, new.ctwa_waba_id);
  new.ctwa_received_at := coalesce(old.ctwa_received_at, new.ctwa_received_at);
  new.first_touch_at := least(old.first_touch_at, new.first_touch_at);
  new.expires_at := greatest(old.expires_at, new.expires_at);
  if new.last_touch_at < old.last_touch_at then
    new.utm_source := old.utm_source;
    new.utm_medium := old.utm_medium;
    new.utm_campaign := old.utm_campaign;
    new.utm_content := old.utm_content;
    new.utm_term := old.utm_term;
    new.landing_url := old.landing_url;
    new.referrer_url := old.referrer_url;
    new.client_user_agent := old.client_user_agent;
    new.ad_user_data_consent := old.ad_user_data_consent;
    new.last_touch_at := old.last_touch_at;
  end if;
  return new;
end;
$$;

revoke all on function private.preserve_ad_attribution_touches()
  from public, anon, authenticated;
grant execute on function private.preserve_ad_attribution_touches()
  to service_role;

comment on column public.contact_ad_attributions.ctwa_clid is
  'Click ID CTWA recebido no referral do webhook WhatsApp; nunca exposto no frontend.';
comment on column public.contact_ad_attributions.ctwa_waba_id is
  'WABA que recebeu a conversa e acompanha ctwa_clid em eventos CAPI Business Messaging.';
