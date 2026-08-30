-- Conserta a restrição do código de origem, que nunca chegou a funcionar.
--
-- A regra original era `ref ~ '^[A-Za-z0-9_=-]{1,2083}$'`. O 2083 veio do limite
-- de tamanho de URL, e faz sentido como número — mas o motor de regex do
-- Postgres recusa contagem de repetição acima de 255. Como a expressão só é
-- compilada quando alguém insere, a tabela foi criada sem reclamar e todo
-- `insert` morria com "invalid repetition count(s)". Na prática, nenhum link de
-- captação jamais pôde ser criado.
--
-- A correção separa as duas perguntas que a regra fazia junto: a regex cuida do
-- alfabeto e o `char_length` cuida do tamanho. O efeito é idêntico e compila.
alter table public.growth_links
  drop constraint if exists growth_links_ref_check;

alter table public.growth_links
  add constraint growth_links_ref_check
  check (ref ~ '^[A-Za-z0-9_=-]+$' and char_length(ref) <= 2083);
