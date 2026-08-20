-- Wal Chat - valores multicanal que precisam ser confirmados antes da
-- migration que passa a utilizá-los em funções, tabelas e decisões.

alter type public.trigger_source add value if not exists 'whatsapp';
alter type public.window_policy add value if not exists 'whatsapp_template';
