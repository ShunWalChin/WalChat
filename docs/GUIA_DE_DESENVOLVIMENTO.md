# Guia de desenvolvimento

## 1. Princípios

1. Compliance pertence ao backend e nunca pode depender apenas de um botão desabilitado na UI.
2. Toda tabela de domínio deve carregar `workspace_id` e receber policy RLS.
3. Webhooks devem ser rápidos, assinados, idempotentes e assíncronos.
4. Secrets ficam em módulos `server-only` e nunca usam prefixo `VITE_`.
5. Uma alteração de comportamento exige teste ou evidência de validação proporcional ao risco.
6. Modo demo não pode produzir efeitos externos.

## 2. Convenções TypeScript/React

- TypeScript estrito; evite `any`.
- Componentes de rota ficam em `src/routes`.
- Componentes reutilizáveis ficam em `src/components`.
- Funções com secrets, service role ou tokens precisam importar `@tanstack/react-start/server-only`.
- Valide payloads de API com Zod antes da lógica de domínio.
- Use funções puras para regras de negócio; `evaluateCompliance` é o modelo.
- Comentários explicam intenção, invariantes e decisões — não repetem a sintaxe.
- Textos da interface ficam em PT-BR e preservam o tom da marca.

## 3. Adicionar uma tela

1. Crie `src/routes/_app/nova-rota.tsx`.
2. Exporte `Route = createFileRoute('/_app/nova-rota')`.
3. Use `PageIntro` e os tokens de `styles.css`.
4. Adicione o item à navegação de `AppShell`.
5. Execute `npm run generate-routes`.
6. Inclua a URL em `scripts/validate-routes.mjs`.
7. Teste navegação desktop e mobile.

`src/routeTree.gen.ts` é gerado. Nunca edite esse arquivo manualmente.

## 4. Adicionar um endpoint

1. Crie uma rota em `src/routes/api`.
2. Defina schema Zod para body/query quando aplicável.
3. Defina autenticação: JWT, HMAC ou endpoint público intencional.
4. Não retorne stack trace, token ou payload sensível em erros.
5. Use `Cache-Control: no-store` para dados operacionais.
6. Documente request, response e códigos em `API_E_WEBHOOKS.md`.
7. Adicione teste unitário ou etapa ao smoke.

## 5. Alterar compliance

Qualquer alteração em `src/server/compliance.ts` exige:

- teste positivo e negativo;
- teste de opt-out;
- janela exatamente no limite;
- rodapé automático sem duplicação;
- cooldown e Private Reply, se afetados;
- execução de `npm test` e smoke integrado.

O sender deve continuar recebendo uma `ComplianceDecision`; nunca duplique a regra dentro de componentes, workers ou campanhas.

## 6. Alterar banco

```bash
npx supabase migration new nome_da_mudanca
# edite o novo arquivo
npm run db:reset
npm run db:lint
```

Para uma nova tabela de tenant:

- `workspace_id uuid not null references public.workspaces(id) on delete cascade`;
- índices para consultas quentes;
- `enable row level security`;
- policies de membro ou papel;
- GRANT coerente;
- `updated_at` e trigger quando mutável;
- documentação em `BANCO_DE_DADOS.md`.

## 7. Alterar o processamento de eventos

Mantenha as etapas separadas:

1. verificar assinatura;
2. persistir/enfileirar;
3. normalizar evento no worker;
4. registrar interação;
5. avaliar gatilho/cooldown;
6. criar job;
7. revalidar compliance;
8. enviar e auditar.

Não chame a Meta dentro do handler do webhook. A Meta pode repetir eventos e espera resposta rápida.

## 8. Testes

### Unitários

`src/server/compliance.test.ts` cobre a matriz principal da janela Meta. `webhook-signature.test.ts` cobre assinatura válida e adulteração.

```bash
npm test
```

### Estáticos

```bash
npm run lint
npx tsc --noEmit
npm run check
```

### Build

```bash
npm run build
```

### Banco

```bash
npm run db:lint
```

### Integração

```bash
npm run local:up
npm run dev:all
npm run validate:routes
npm run smoke
```

O smoke precisa terminar com `health`, `auth`, `rls`, `webhookVerification`, `webhookSignature`, `worker` e `scheduler` em `ok`.

## 9. Logs e observabilidade

- Servidor: JSON com `event`, erro resumido e contexto não sensível.
- Worker: eventos BullMQ e falhas de processamento.
- Scheduler: `scheduled_job_failed` com job ID.
- Nginx: status, upstream e latência.
- Nunca registrar Authorization, signed requests, chaves ou corpo integral contendo dados sensíveis.

Métricas recomendadas para evolução:

- latência e taxa de erro do webhook;
- profundidade/idade da fila;
- jobs `failed` e `pending` atrasados;
- bloqueios por motivo de compliance;
- erros e rate limits da Graph API;
- consumo e falhas do Gemini.

## 10. Fluxo Git

1. Atualize `main`.
2. Crie branch `agent/<descricao>` ou `feature/<descricao>`.
3. Faça commits pequenos e intencionais.
4. Rode a bateria proporcional ao risco.
5. Abra PR com impacto, validações e limites conhecidos.
6. Nunca inclua `.env*`, dumps, chaves ou tokens.

## 11. Definition of Done

- [ ] Código e documentação refletem o mesmo comportamento.
- [ ] Multi-tenancy/RLS revisados.
- [ ] Compliance revalidado no envio.
- [ ] Testes, lint, tipos e build passam.
- [ ] Sem secrets no diff.
- [ ] Migrations têm rollback operacional documentado.
- [ ] Modo demo continua sem efeitos externos.
- [ ] README e mapa do código atualizados quando a estrutura muda.
