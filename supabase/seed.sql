-- Usuário local: demo@walchat.local / wal123
-- O signup via UI também cria workspace automaticamente pelo trigger da migration.
-- Nunca reutilizar estas credenciais ou IDs determinísticos em produção real.
do $$
declare
  demo_user_id uuid := '00000000-0000-4000-8000-000000000001';
  demo_workspace_id uuid;
  demo_account_id uuid;
  contact_1 uuid;
  contact_2 uuid;
  seq_id uuid;
begin
  if not exists (select 1 from auth.users where id = demo_user_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', demo_user_id, 'authenticated', 'authenticated',
      'demo@walchat.local', extensions.crypt('wal123', extensions.gen_salt('bf')), timezone('utc', now()),
      '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"Wal Demo"}'::jsonb,
      timezone('utc', now()), timezone('utc', now()), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (demo_user_id, demo_user_id, demo_user_id::text, jsonb_build_object('sub', demo_user_id::text, 'email', 'demo@walchat.local'), 'email', timezone('utc', now()), timezone('utc', now()), timezone('utc', now()));
  end if;

  select id into demo_workspace_id from public.workspaces where owner_id = demo_user_id limit 1;
  insert into public.instagram_accounts (workspace_id, instagram_user_id, username, display_name, status, scopes, webhook_subscribed_at)
  values (demo_workspace_id, '17841400000000001', 'wal.chat', 'Wal Chat', 'connected', array['instagram_basic','instagram_manage_messages','instagram_manage_comments','instagram_content_publish'], timezone('utc', now()))
  on conflict (workspace_id, instagram_user_id) do update set username = excluded.username
  returning id into demo_account_id;

  insert into public.contacts (workspace_id, instagram_account_id, instagram_user_id, username, full_name, inbox_category, last_interaction_at, last_inbound_at)
  values
    (demo_workspace_id, demo_account_id, 'ig_ana', 'ana.cria', 'Ana Souza', 'principal', timezone('utc', now()) - interval '18 minutes', timezone('utc', now()) - interval '18 minutes'),
    (demo_workspace_id, demo_account_id, 'ig_caio', 'caio.sp', 'Caio Martins', 'pedidos', timezone('utc', now()) - interval '27 hours', timezone('utc', now()) - interval '27 hours')
  on conflict (workspace_id, instagram_user_id) do update set last_interaction_at = excluded.last_interaction_at;
  select id into contact_1 from public.contacts where workspace_id = demo_workspace_id and instagram_user_id = 'ig_ana';
  select id into contact_2 from public.contacts where workspace_id = demo_workspace_id and instagram_user_id = 'ig_caio';

  insert into public.tags (workspace_id, name, color, is_automatic) values
    (demo_workspace_id, 'Lead quente', '#F05A28', true),
    (demo_workspace_id, 'Comprou', '#1D7A55', false),
    (demo_workspace_id, 'Veio do Reels', '#2F66D0', true)
  on conflict do nothing;

  insert into public.sequences (workspace_id, name, description, is_active)
  values (demo_workspace_id, 'Entrega do guia', 'Envia o material e acompanha a resposta.', true)
  on conflict (workspace_id, name) do update set is_active = true
  returning id into seq_id;
  insert into public.sequence_steps (workspace_id, sequence_id, position, kind, content, delay_seconds) values
    (demo_workspace_id, seq_id, 0, 'typing', null, 2),
    (demo_workspace_id, seq_id, 1, 'text', 'Aí sim! Aqui está o guia que prometi. Responda PARAR', 0),
    (demo_workspace_id, seq_id, 2, 'text', 'Conseguiu abrir? Se quiser, te ajudo por aqui. Responda PARAR', 3600)
  on conflict (sequence_id, position) do nothing;
  insert into public.triggers (workspace_id, name, source, keyword, match_mode, sequence_id, is_active)
  values (demo_workspace_id, 'Comentou QUERO', 'comment', 'quero', 'contains', seq_id, true)
  on conflict do nothing;

  insert into public.insights_daily (workspace_id, instagram_account_id, day, reach, impressions, followers, dms_received, dms_sent, comments, new_contacts) values
    (demo_workspace_id, demo_account_id, current_date - 6, 8100, 12300, 18220, 31, 28, 94, 18),
    (demo_workspace_id, demo_account_id, current_date - 5, 9400, 14100, 18261, 39, 35, 117, 23),
    (demo_workspace_id, demo_account_id, current_date - 4, 12100, 19000, 18312, 44, 41, 139, 28),
    (demo_workspace_id, demo_account_id, current_date - 3, 10800, 17300, 18358, 52, 47, 148, 31),
    (demo_workspace_id, demo_account_id, current_date - 2, 15400, 24100, 18420, 68, 62, 209, 44),
    (demo_workspace_id, demo_account_id, current_date - 1, 13700, 21900, 18481, 61, 58, 184, 39),
    (demo_workspace_id, demo_account_id, current_date, 18200, 28700, 18552, 79, 73, 247, 52)
  on conflict (workspace_id, day) do update set reach = excluded.reach, followers = excluded.followers;

  insert into public.blocklist_entries (workspace_id, term, kind) values
    (demo_workspace_id, 'ganhe dinheiro rápido', 'spam'),
    (demo_workspace_id, 'clique agora sem risco', 'spam')
  on conflict do nothing;
end $$;
