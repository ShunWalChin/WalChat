# Segurança e compliance

## 1. Controles implementados

| Risco                              | Controle                                                |
| ---------------------------------- | ------------------------------------------------------- |
| Webhook forjado                    | HMAC SHA-256 e comparação constant-time                 |
| Evento duplicado                   | Hash do corpo, `jobId` e índices únicos                 |
| Vazamento entre tenants            | RLS por `workspace_id`                                  |
| Vazamento de tokens                | Schema privado e variáveis sem prefixo `VITE_`          |
| Spam por gatilho                   | Cooldown por contato/gatilho                            |
| Automação fora da janela           | Revalidação imediatamente antes do envio                |
| Abuso de `HUMAN_AGENT`             | Automação bloqueada; somente fluxo humano               |
| Opt-out ignorado                   | `opted_out_at` bloqueia qualquer envio                  |
| Private Reply duplicada            | Chave única por comentário                              |
| Conteúdo proibido                  | Blocklist antes do envio                                |
| Processo privilegiado no container | Usuário não-root, caps removidas e filesystem read-only |

## 2. Ordem de decisão do compliance

```mermaid
flowchart TD
    Start["Solicitação de envio"] --> OptOut{"Contato opt-out?"}
    OptOut -->|Sim| BlockOpt["Bloquear: opted_out"]
    OptOut -->|Não| Inbound{"Existe inbound?"}
    Inbound -->|Não| BlockInbound["Bloquear: no_inbound_interaction"]
    Inbound -->|Sim| Content{"Blocklist?"}
    Content -->|Sim| BlockContent["Bloquear: blocked_content"]
    Content -->|Não| Reply{"Private Reply repetida?"}
    Reply -->|Sim| BlockReply["Bloquear: comment_already_replied"]
    Reply -->|Não| Cooldown{"Cooldown ativo?"}
    Cooldown -->|Sim| BlockCooldown["Bloquear: trigger_cooldown"]
    Cooldown -->|Não| Window{"Dentro de 24h?"}
    Window -->|Sim| Allow24["Permitir: standard_24h"]
    Window -->|Não| Human{"HUMAN_AGENT humano e até 7d?"}
    Human -->|Sim| Allow7["Permitir: human_agent_7d"]
    Human -->|Não| BlockWindow["Bloquear"]
```

Mensagens automáticas recebem `Responda PARAR` antes da avaliação de conteúdo e antes da chamada à Meta.

## 3. Secrets

Nunca versionar:

- `.env.local` ou `.env.production`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `META_APP_SECRET`, access tokens ou publish tokens;
- `GOOGLE_GENERATIVE_AI_API_KEY`;
- dumps, `status.env`, chaves SSH ou logs contendo credenciais.

Regras operacionais:

1. Uma credencial por ambiente.
2. Privilégio mínimo e rotação periódica.
3. Tokens de cada tenant criptografados em `private.instagram_credentials`.
4. Revogação imediata após desligamento do cliente.
5. Nunca expor secrets em screenshots, issues ou PRs.

## 4. Superfície HTTP

- Nginx publica somente 80/443.
- App e serviços de dados usam portas internas ou bloqueadas pela rede do provedor.
- Webhook e callback de exclusão são públicos porque a Meta precisa acessá-los.
- Endpoints internos devem exigir JWT e rate limit antes do Live Mode.
- Respostas de erro não retornam detalhes de stack.
- Health check informa presença de configuração, não valores.

## 5. Checklist antes do Live Mode

- [ ] Verificação empresarial concluída.
- [ ] App Review e Advanced Access aprovados.
- [ ] OAuth por workspace implementado e testado.
- [ ] Tokens criptografados e rotação documentada.
- [ ] `DEMO_MODE=false` somente no ambiente correto.
- [ ] SMTP, confirmação e recuperação de senha ativos.
- [ ] Rate limiting e monitoramento dos endpoints internos.
- [ ] Política de Privacidade, Termos e Exclusão publicados em HTTPS.
- [ ] Processo real de exclusão e retenção de dados testado.
- [ ] Alertas de fila falha, erro Meta e jobs atrasados.
- [ ] Backups e restauração comprovados.
- [ ] Contatos de suporte e incidente definidos.

## 6. Resposta a incidentes

1. Pausar campanhas e manter `DEMO_MODE=true` se houver risco de envio indevido.
2. Revogar tokens afetados no Meta Business e no provedor de IA.
3. Preservar logs sem copiar conteúdo sensível para canais públicos.
4. Identificar workspaces, contatos e período impactados.
5. Corrigir, testar compliance e reprocessar somente eventos idempotentes.
6. Notificar titulares conforme LGPD e política interna.

## 7. Limitações atuais relevantes

- O OAuth multi-tenant completo ainda não substitui os tokens globais de homologação.
- O callback de exclusão gera protocolo, mas precisa de job de eliminação definitiva.
- Rate limiting de API deve ser configurado antes de tráfego real.
- Os endpoints de IA/compliance devem receber autenticação explícita quando usados fora da sessão do dashboard.

Esses limites ficam deliberadamente visíveis; não devem ser tratados como produção concluída.
