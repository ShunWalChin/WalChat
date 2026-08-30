-- Valor de enum isolado de propósito.
--
-- O Postgres recusa usar um valor de enum recém-adicionado dentro da mesma
-- transação que o criou ("unsafe use of new value"). Separar em duas migrations
-- é o que permite a constraint e o índice da migration seguinte referenciarem
-- 'first_contact' com segurança.

alter type public.trigger_source add value if not exists 'first_contact';
