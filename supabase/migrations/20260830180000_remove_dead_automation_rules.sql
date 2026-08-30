-- Remove duas tabelas que nunca saíram do papel.
--
-- `automation_rules` e `automation_rule_runs` não são referenciadas por nenhuma
-- linha de código do produto e nunca receberam um registro. Foram desenhadas
-- para um motor de regras que acabou substituído pelo DAG de `automation_flows`.
--
-- Tabela vazia não custa desempenho, custa leitura: quem abre o esquema pela
-- primeira vez precisa descobrir sozinho que existem dois motores de automação,
-- sendo que um deles nunca existiu de fato. É esse custo que estamos pagando.
--
-- A ordem importa: a tabela de execuções aponta para a de regras.
drop table if exists public.automation_rule_runs;
drop table if exists public.automation_rules;
