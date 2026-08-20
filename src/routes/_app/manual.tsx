/** Manual HTML operacional, pesquisável e seguro dentro da área autenticada. */
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Bot,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  FileDown,
  Instagram,
  KeyRound,
  LifeBuoy,
  MessageCircle,
  Radio,
  Search,
  ServerCog,
  ShieldCheck,
  Sparkles,
  UserRoundCog,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/_app/manual')({
  component: ManualPage,
})

const manualSections = [
  {
    id: 'inicio',
    number: '01',
    title: 'Comece por aqui',
    description: 'Primeiro acesso e sequência segura de configuração.',
    keywords: 'login primeiro acesso senha sessão operações configurações',
  },
  {
    id: 'acessos',
    number: '02',
    title: 'Acessos e permissões',
    description: 'Papéis, contas nominais e tratamento das credenciais.',
    keywords: 'owner admin agent viewer usuário cofre senha permissão rls',
  },
  {
    id: 'meta',
    number: '03',
    title: 'Configurar a Meta',
    description: 'Aplicativo, OAuth, permissões e webhooks do Instagram.',
    keywords: 'meta instagram oauth app review webhook scopes callback token',
  },
  {
    id: 'ia',
    number: '04',
    title: 'Configurar a IA',
    description: 'OpenAI, Gemini, agentes e base de conhecimento.',
    keywords: 'openai gemini api key agente copiloto persona conhecimento',
  },
  {
    id: 'inbox',
    number: '05',
    title: 'Operar a Inbox',
    description: 'Rotina de atendimento, janela Meta e IA copiloto.',
    keywords: 'inbox conversa mensagem atendimento prioridade atribuição nota',
  },
  {
    id: 'automacoes',
    number: '06',
    title: 'Automações seguras',
    description: 'Gatilhos, Comment-to-DM, sequências e opt-out.',
    keywords:
      'gatilho comentário dm story sequência cooldown parar private reply',
  },
  {
    id: 'modulos',
    number: '07',
    title: 'Mapa das funcionalidades',
    description: 'O que está funcional, em piloto ou ainda é protótipo.',
    keywords:
      'dashboard contatos calendário publicar insights auto-like estado',
  },
  {
    id: 'go-live',
    number: '08',
    title: 'Checklist de Go-Live',
    description: 'Gates obrigatórios antes de qualquer disparo real.',
    keywords: 'produção demo live checklist switch backup domínio smtp jwt',
  },
  {
    id: 'operacao',
    number: '09',
    title: 'Operação e incidentes',
    description: 'Monitoramento, bloqueio emergencial e recuperação.',
    keywords: 'health ready worker scheduler erro incidente logs rollback',
  },
  {
    id: 'links',
    number: '10',
    title: 'Links e referências',
    description: 'Endereços do Wal Chat e painéis externos necessários.',
    keywords: 'links url github meta developers openai privacidade termos',
  },
] as const

const goLiveItems = [
  'Segredo JWT self-hosted rotacionado e sessões antigas invalidadas',
  'Domínio definitivo e HTTPS validados',
  'SMTP, recuperação de senha e contas nominais configurados',
  'Meta Business, App Review e Advanced Access aprovados',
  'Conta Instagram Professional piloto conectada e validada',
  'Webhook real recebido uma única vez e observado na Central',
  'DM manual, opt-out, cooldown e Private Reply testados',
  'OpenAI ou Gemini com orçamento, limite e alerta configurados',
  'Backup restaurado em ambiente isolado',
  'Responsável do piloto e procedimento de incidente definidos',
] as const

function ManualPage() {
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [completed, setCompleted] = useState<string[]>([])

  useEffect(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem('wal-chat-manual-go-live') ?? '[]',
      )
      if (Array.isArray(saved)) setCompleted(saved.filter(String))
    } catch {
      setCompleted([])
    }
  }, [])

  const visibleSections = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pt-BR')
    if (!term) return new Set(manualSections.map((section) => section.id))
    return new Set(
      manualSections
        .filter((section) =>
          `${section.title} ${section.description} ${section.keywords}`
            .toLocaleLowerCase('pt-BR')
            .includes(term),
        )
        .map((section) => section.id),
    )
  }, [query])

  function copyValue(id: string, value: string) {
    void navigator.clipboard.writeText(value)
    setCopied(id)
    window.setTimeout(() => setCopied(null), 1_600)
  }

  function toggleChecklist(item: string) {
    setCompleted((current) => {
      const next = current.includes(item)
        ? current.filter((saved) => saved !== item)
        : [...current, item]
      window.localStorage.setItem(
        'wal-chat-manual-go-live',
        JSON.stringify(next),
      )
      return next
    })
  }

  const progress = Math.round((completed.length / goLiveItems.length) * 100)
  const show = (id: (typeof manualSections)[number]['id']) =>
    visibleSections.has(id)

  return (
    <div className="manual-page">
      <section className="manual-hero" aria-labelledby="manual-title">
        <div className="manual-hero-copy">
          <span className="manual-kicker">
            <BookOpenCheck size={16} /> GUIA OPERACIONAL · ATUALIZADO EM
            20/08/2026
          </span>
          <h2 id="manual-title">Wal Chat, do acesso ao Go-Live.</h2>
          <p>
            Manual completo para configurar contas, operar conversas e validar
            uma primeira versão real sem furar as regras da Meta.
          </p>
          <div className="manual-hero-actions">
            <Link to="/configuracoes" className="button button-orange">
              Abrir configurações <ArrowRight size={16} />
            </Link>
            <Link to="/operacoes" className="button manual-button-light">
              Central de Go-Live
            </Link>
            <button
              type="button"
              className="button manual-button-ghost"
              onClick={() => window.print()}
            >
              <FileDown size={16} /> Imprimir / salvar PDF
            </button>
          </div>
        </div>
        <div className="manual-hero-status">
          <span className="manual-status-label">BASELINE ATUAL</span>
          <strong>Homologação protegida</strong>
          <p>
            Mantenha o modo demo e os kill switches desligados até concluir
            todos os gates deste manual.
          </p>
          <div className="manual-status-row">
            <span>
              <i /> Backend auditado
            </span>
            <span>
              <i /> Disparos bloqueados
            </span>
          </div>
        </div>
      </section>

      <div className="manual-search-wrap">
        <label className="manual-search" htmlFor="manual-search-input">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Pesquisar no manual</span>
          <input
            id="manual-search-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Busque Meta, webhook, IA, Inbox, opt-out…"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Limpar pesquisa"
            >
              <X size={16} />
            </button>
          )}
        </label>
        <span className="manual-search-result" role="status">
          {visibleSections.size} de {manualSections.length} capítulos
        </span>
      </div>

      {visibleSections.size === 0 ? (
        <div className="card manual-empty">
          <Search size={26} />
          <h3>Nada encontrado.</h3>
          <p>Tente “Meta”, “IA”, “Inbox”, “Go-Live” ou “acessos”.</p>
          <button className="button button-dark" onClick={() => setQuery('')}>
            Limpar busca
          </button>
        </div>
      ) : (
        <div className="manual-layout">
          <aside className="manual-toc" aria-label="Sumário do manual">
            <span className="eyebrow">NESTA PÁGINA</span>
            <nav>
              {manualSections.map(
                (section) =>
                  visibleSections.has(section.id) && (
                    <a key={section.id} href={`#${section.id}`}>
                      <span>{section.number}</span>
                      {section.title}
                    </a>
                  ),
              )}
            </nav>
            <div className="manual-progress-mini">
              <span>
                <ClipboardCheck size={15} /> Go-Live
                <strong>{progress}%</strong>
              </span>
              <div>
                <i style={{ width: `${progress}%` }} />
              </div>
              <small>Salvo somente neste navegador.</small>
            </div>
          </aside>

          <main className="manual-content">
            {show('inicio') && (
              <ManualSection
                id="inicio"
                number="01"
                icon={<Sparkles />}
                eyebrow="ROTA RECOMENDADA"
                title="Comece por aqui"
                description="A ordem abaixo evita configuração parcial e disparo antes da hora."
              >
                <ol className="manual-step-list">
                  {[
                    [
                      'Entre com sua conta nominal',
                      'Não compartilhe usuário ou senha. Use o papel atribuído ao seu trabalho.',
                    ],
                    [
                      'Abra Configurações',
                      'Confira o assistente Meta e o provedor de IA sem ativar automações.',
                    ],
                    [
                      'Conecte somente a conta piloto',
                      'Use um Instagram Professional controlado pela equipe.',
                    ],
                    [
                      'Teste a entrada',
                      'Envie uma DM e um comentário de outra conta controlada.',
                    ],
                    [
                      'Valide na Central',
                      'Confirme saúde, permissões, webhooks e kill switches.',
                    ],
                    [
                      'Libere em camadas',
                      'Envio humano primeiro; Comment-to-DM depois; IA autônoma por último.',
                    ],
                  ].map(([title, detail], index) => (
                    <li key={title}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <strong>{title}</strong>
                        <p>{detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <Callout tone="warning" title="Regra de ouro">
                  Nenhuma tela, credencial ou checkbox substitui a Central de
                  Go-Live. Se uma checagem crítica estiver vermelha, não envie.
                </Callout>
              </ManualSection>
            )}

            {show('acessos') && (
              <ManualSection
                id="acessos"
                number="02"
                icon={<UserRoundCog />}
                eyebrow="IDENTIDADE E TENANCY"
                title="Acessos e permissões"
                description="Cada pessoa deve ter uma conta própria e enxergar somente seu workspace."
              >
                <div className="manual-role-grid">
                  <RoleCard role="Owner" tone="orange">
                    Titular, usuários, integrações e operação completa.
                  </RoleCard>
                  <RoleCard role="Admin" tone="blue">
                    Configura Meta, IA, gatilhos e operação do workspace.
                  </RoleCard>
                  <RoleCard role="Agent" tone="green">
                    Atende a Inbox e usa o copiloto, sem alterar secrets.
                  </RoleCard>
                  <RoleCard role="Viewer" tone="gray">
                    Consulta dados, sem escrita operacional.
                  </RoleCard>
                </div>
                <h4 className="manual-subtitle">Política de acesso</h4>
                <ul className="manual-check-list">
                  <li>
                    <Check size={16} /> Use e-mail individual e senha exclusiva.
                  </li>
                  <li>
                    <Check size={16} /> Mantenha no máximo dois owners.
                  </li>
                  <li>
                    <Check size={16} /> Revogue a sessão de pessoas desligadas
                    imediatamente.
                  </li>
                  <li>
                    <Check size={16} /> Guarde logins técnicos, SSH e
                    recuperação no cofre privado.
                  </li>
                  <li>
                    <Check size={16} /> Nunca coloque senha, token ou chave
                    nesta página.
                  </li>
                </ul>
                <Callout tone="safe" title="Onde estão as credenciais?">
                  No cofre privado do projeto, fora do Git e fora do Wal Chat. O
                  manual indica o processo; ele não replica o segredo.
                </Callout>
              </ManualSection>
            )}

            {show('meta') && (
              <ManualSection
                id="meta"
                number="03"
                icon={<Instagram />}
                eyebrow="INSTAGRAM PROFESSIONAL"
                title="Configurar a Meta"
                description="Prepare o aplicativo Meta antes de iniciar o OAuth pelo Wal Chat."
              >
                <div className="manual-two-columns">
                  <div>
                    <h4>Pré-requisitos</h4>
                    <ul className="manual-bullet-list">
                      <li>Portfólio empresarial e aplicativo Meta.</li>
                      <li>Instagram Business ou Creator.</li>
                      <li>Usuário com acesso ao app e ao ativo.</li>
                      <li>
                        App Review e Advanced Access para contas externas.
                      </li>
                      <li>Política, termos e exclusão publicados em HTTPS.</li>
                    </ul>
                  </div>
                  <div>
                    <h4>Permissões solicitadas</h4>
                    <div className="manual-code-list">
                      <code>instagram_business_basic</code>
                      <code>instagram_business_manage_messages</code>
                      <code>instagram_business_manage_comments</code>
                      <code>instagram_business_content_publish</code>
                      <code>instagram_business_manage_insights</code>
                    </div>
                  </div>
                </div>
                <h4 className="manual-subtitle">URLs do aplicativo</h4>
                <div className="manual-copy-list">
                  <CopyValue
                    id="meta-site"
                    label="Site URL"
                    value="https://wal-chat.64.181.178.125.nip.io"
                    copied={copied}
                    onCopy={copyValue}
                  />
                  <CopyValue
                    id="meta-oauth"
                    label="OAuth Redirect URI"
                    value="https://wal-chat.64.181.178.125.nip.io/api/integrations/meta/callback"
                    copied={copied}
                    onCopy={copyValue}
                  />
                  <CopyValue
                    id="meta-webhook"
                    label="Webhook Callback"
                    value="https://wal-chat.64.181.178.125.nip.io/api/public/webhooks/instagram"
                    copied={copied}
                    onCopy={copyValue}
                  />
                  <CopyValue
                    id="meta-delete"
                    label="Data Deletion Callback"
                    value="https://wal-chat.64.181.178.125.nip.io/api/data-deletion"
                    copied={copied}
                    onCopy={copyValue}
                  />
                </div>
                <h4 className="manual-subtitle">Fluxo dentro do Wal Chat</h4>
                <ol className="manual-compact-steps">
                  <li>
                    <span>1</span> Entre como owner ou admin.
                  </li>
                  <li>
                    <span>2</span> Vá a{' '}
                    <Link to="/configuracoes">Configurações</Link> e clique em
                    Conectar Instagram.
                  </li>
                  <li>
                    <span>3</span> Autorize todos os scopes solicitados.
                  </li>
                  <li>
                    <span>4</span> Use “Testar token e assinaturas”.
                  </li>
                  <li>
                    <span>5</span> Confirme os eventos na{' '}
                    <Link to="/operacoes">Central de Go-Live</Link>.
                  </li>
                </ol>
                <Callout tone="warning" title="Verify Token e App Secret">
                  São secrets de backend. Cadastre o mesmo Verify Token na Meta,
                  mas nunca o mostre em tela, captura ou suporte.
                </Callout>
              </ManualSection>
            )}

            {show('ia') && (
              <ManualSection
                id="ia"
                number="04"
                icon={<Bot />}
                eyebrow="COPILOTO PRIMEIRO"
                title="Configurar a IA"
                description="Comece com revisão humana e limite baixo de uso."
              >
                <div className="manual-flow">
                  <div>
                    <KeyRound size={20} />
                    <strong>1. Provedor</strong>
                    <p>
                      Crie uma chave de projeto OpenAI ou Gemini com orçamento.
                    </p>
                  </div>
                  <ArrowRight size={18} />
                  <div>
                    <ServerCog size={20} />
                    <strong>2. Configurações</strong>
                    <p>
                      Salve a chave cifrada no workspace e escolha o modelo.
                    </p>
                  </div>
                  <ArrowRight size={18} />
                  <div>
                    <Sparkles size={20} />
                    <strong>3. Agente</strong>
                    <p>Defina persona, tom, limites e base de conhecimento.</p>
                  </div>
                </div>
                <ol className="manual-compact-steps">
                  <li>
                    <span>1</span> Em{' '}
                    <Link to="/configuracoes">Configurações</Link>, escolha
                    OpenAI ou Google.
                  </li>
                  <li>
                    <span>2</span> Informe a API key; ela não volta para o
                    navegador.
                  </li>
                  <li>
                    <span>3</span> Em <Link to="/agentes">Agentes de IA</Link>,
                    crie uma persona em modo copiloto.
                  </li>
                  <li>
                    <span>4</span> Adicione políticas, catálogo e FAQ à base.
                  </li>
                  <li>
                    <span>5</span> Teste fatos desconhecidos e tentativas de
                    prompt injection.
                  </li>
                  <li>
                    <span>6</span> Revise toda sugestão antes do envio no
                    piloto.
                  </li>
                </ol>
                <div className="manual-provider-links">
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noreferrer"
                  >
                    OpenAI API Keys <ExternalLink size={14} />
                  </a>
                  <a
                    href="https://platform.openai.com/usage"
                    target="_blank"
                    rel="noreferrer"
                  >
                    OpenAI Usage <ExternalLink size={14} />
                  </a>
                  <a
                    href="https://aistudio.google.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google AI Studio <ExternalLink size={14} />
                  </a>
                </div>
              </ManualSection>
            )}

            {show('inbox') && (
              <ManualSection
                id="inbox"
                number="05"
                icon={<MessageCircle />}
                eyebrow="ROTINA DE ATENDIMENTO"
                title="Operar a Inbox"
                description="Toda resposta passa novamente pelo compliance no backend."
              >
                <div className="manual-routine-grid">
                  {[
                    [
                      '1',
                      'Triagem',
                      'Separe Principal, Geral, Pedidos e IA off.',
                    ],
                    [
                      '2',
                      'Contexto',
                      'Leia histórico, janela de 24h, prioridade e notas.',
                    ],
                    [
                      '3',
                      'Responsável',
                      'Atribua a conversa antes de responder.',
                    ],
                    [
                      '4',
                      'Copiloto',
                      'Gere uma sugestão e confira fatos, tom e oferta.',
                    ],
                    [
                      '5',
                      'Envio',
                      'Envie apenas quando o backend indicar elegibilidade.',
                    ],
                    [
                      '6',
                      'Fechamento',
                      'Marque pendente ou resolvida e registre nota interna.',
                    ],
                  ].map(([number, title, detail]) => (
                    <article key={title}>
                      <span>{number}</span>
                      <strong>{title}</strong>
                      <p>{detail}</p>
                    </article>
                  ))}
                </div>
                <Callout tone="danger" title="Fora da janela de 24 horas">
                  Não force DM automática. HUMAN_AGENT é somente para resposta
                  humana permitida e nunca deve ser usado para automação.
                </Callout>
              </ManualSection>
            )}

            {show('automacoes') && (
              <ManualSection
                id="automacoes"
                number="06"
                icon={<Zap />}
                eyebrow="COMPLIANCE POR PADRÃO"
                title="Automações seguras"
                description="Teste cada gatilho isoladamente antes de habilitar o workspace."
              >
                <div className="manual-feature-grid">
                  <article>
                    <Zap />
                    <strong>Gatilhos</strong>
                    <p>
                      Palavra-chave em comentário, DM ou story, com cooldown e
                      tag.
                    </p>
                    <Link to="/gatilhos">Abrir gatilhos</Link>
                  </article>
                  <article>
                    <MessageCircle />
                    <strong>Comment-to-DM</strong>
                    <p>
                      Uma Private Reply por comentário e somente na janela
                      permitida.
                    </p>
                    <Link to="/comment-to-dm">Abrir regras</Link>
                  </article>
                  <article>
                    <Radio />
                    <strong>Sequências</strong>
                    <p>Passos agendados e revalidação antes de cada envio.</p>
                    <Link to="/sequencias">Abrir sequências</Link>
                  </article>
                </div>
                <div className="manual-policy-strip">
                  {[
                    '24h padrão',
                    '7d humano',
                    'PARAR',
                    'Cooldown 24h',
                    'Blocklist',
                    'Private Reply única',
                  ].map((policy) => (
                    <span key={policy}>
                      <ShieldCheck size={14} /> {policy}
                    </span>
                  ))}
                </div>
                <h4 className="manual-subtitle">Ordem do teste</h4>
                <ol className="manual-compact-steps">
                  <li>
                    <span>1</span> Crie a regra como inativa.
                  </li>
                  <li>
                    <span>2</span> Revise resposta, mídia, tag e rodapé
                    “Responda PARAR”.
                  </li>
                  <li>
                    <span>3</span> Teste com duas contas controladas.
                  </li>
                  <li>
                    <span>4</span> Repita o evento para provar deduplicação e
                    cooldown.
                  </li>
                  <li>
                    <span>5</span> Responda PARAR e confirme bloqueio posterior.
                  </li>
                </ol>
              </ManualSection>
            )}

            {show('modulos') && (
              <ManualSection
                id="modulos"
                number="07"
                icon={<BookOpenCheck />}
                eyebrow="ESCOPO REAL DA V1"
                title="Mapa das funcionalidades"
                description="Use esta matriz para não vender protótipo como integração real."
              >
                <div className="manual-table-wrap">
                  <table className="manual-table">
                    <thead>
                      <tr>
                        <th>Módulo</th>
                        <th>Estado</th>
                        <th>Uso permitido</th>
                      </tr>
                    </thead>
                    <tbody>
                      <ModuleRow
                        name="Autenticação e multi-tenant"
                        status="Funcional"
                        tone="green"
                      >
                        Login, sessão, papéis e isolamento RLS.
                      </ModuleRow>
                      <ModuleRow
                        name="Go-Live e webhooks"
                        status="Funcional"
                        tone="green"
                      >
                        Diagnóstico, kill switches, observabilidade e replay
                        seguro.
                      </ModuleRow>
                      <ModuleRow
                        name="Inbox e envio humano"
                        status="Piloto"
                        tone="blue"
                      >
                        Uso controlado após conectar uma conta Meta real.
                      </ModuleRow>
                      <ModuleRow
                        name="Gatilhos e Comment-to-DM"
                        status="Piloto"
                        tone="blue"
                      >
                        Uma regra curta com conta de teste e supervisão.
                      </ModuleRow>
                      <ModuleRow
                        name="Agentes e base de conhecimento"
                        status="Piloto"
                        tone="blue"
                      >
                        Copiloto com revisão humana.
                      </ModuleRow>
                      <ModuleRow
                        name="Sequências"
                        status="Parcial"
                        tone="orange"
                      >
                        Backend agenda passos; editor ainda não cobre todo o
                        ciclo.
                      </ModuleRow>
                      <ModuleRow
                        name="Dashboard, contatos e insights"
                        status="Demo"
                        tone="gray"
                      >
                        Não usar como fonte oficial de métricas ou CRM.
                      </ModuleRow>
                      <ModuleRow
                        name="Campanhas e reengajamento"
                        status="Protótipo"
                        tone="red"
                      >
                        Não realiza campanha real completa.
                      </ModuleRow>
                      <ModuleRow
                        name="Calendário, publicar e auto-like"
                        status="Protótipo"
                        tone="red"
                      >
                        Interface visual, sem execução Meta de produção.
                      </ModuleRow>
                    </tbody>
                  </table>
                </div>
              </ManualSection>
            )}

            {show('go-live') && (
              <ManualSection
                id="go-live"
                number="08"
                icon={<ClipboardCheck />}
                eyebrow="ANTES DE DISPARAR"
                title="Checklist de Go-Live"
                description="Marque somente quando houver evidência verificável."
              >
                <div className="manual-progress-card">
                  <div>
                    <strong>
                      {completed.length}/{goLiveItems.length}
                    </strong>
                    <span>gates concluídos</span>
                  </div>
                  <div className="manual-progress-track">
                    <i style={{ width: `${progress}%` }} />
                  </div>
                  <em>{progress}%</em>
                </div>
                <div className="manual-checklist">
                  {goLiveItems.map((item) => {
                    const checked = completed.includes(item)
                    return (
                      <label className={checked ? 'checked' : ''} key={item}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleChecklist(item)}
                        />
                        <span>{checked && <Check size={15} />}</span>
                        {item}
                      </label>
                    )
                  })}
                </div>
                <Callout tone="danger" title="Ativação exige decisão humana">
                  Concluir esta lista não liga nada automaticamente. O owner ou
                  admin ainda deve validar a Central e digitar a confirmação de
                  produção. Modo autônomo fica por último.
                </Callout>
              </ManualSection>
            )}

            {show('operacao') && (
              <ManualSection
                id="operacao"
                number="09"
                icon={<LifeBuoy />}
                eyebrow="OBSERVAR, BLOQUEAR, RECUPERAR"
                title="Operação e incidentes"
                description="A segurança do sistema também depende da rotina da equipe."
              >
                <div className="manual-incident-grid">
                  <article>
                    <span>01</span>
                    <strong>Bloqueie primeiro</strong>
                    <p>
                      Desligue disparos, Comment-to-DM e IA autônoma na Central.
                    </p>
                  </article>
                  <article>
                    <span>02</span>
                    <strong>Preserve evidências</strong>
                    <p>
                      Registre horário, workspace e IDs; não copie tokens ou
                      payloads pessoais.
                    </p>
                  </article>
                  <article>
                    <span>03</span>
                    <strong>Diagnostique</strong>
                    <p>
                      Confira readiness, workers, webhooks falhos e entregas
                      unknown.
                    </p>
                  </article>
                  <article>
                    <span>04</span>
                    <strong>Recupere com controle</strong>
                    <p>
                      Reprocesse apenas eventos idempotentes e valide antes de
                      reabrir.
                    </p>
                  </article>
                </div>
                <h4 className="manual-subtitle">Diagnóstico rápido</h4>
                <details className="manual-details">
                  <summary>Meta não conecta</summary>
                  <p>
                    Confira App ID/secret no backend, Redirect URI exata, papel
                    do usuário, conta Professional e App Review.
                  </p>
                </details>
                <details className="manual-details">
                  <summary>Webhook retorna 401 ou 403</summary>
                  <p>
                    401 indica assinatura HMAC inválida. 403 no challenge indica
                    Verify Token diferente do cadastrado na Meta.
                  </p>
                </details>
                <details className="manual-details">
                  <summary>IA aparece como demo</summary>
                  <p>
                    Nenhuma chave válida está configurada para o workspace ou
                    servidor. Salve a chave e teste novamente.
                  </p>
                </details>
                <details className="manual-details">
                  <summary>Mensagem foi bloqueada</summary>
                  <p>
                    Leia o motivo: opt-out, sem inbound, fora da janela,
                    cooldown, blocklist ou comentário já respondido.
                  </p>
                </details>
                <details className="manual-details">
                  <summary>Entrega ficou unknown</summary>
                  <p>
                    Não repita automaticamente. Concilie manualmente com o
                    histórico Meta antes de criar uma nova intenção.
                  </p>
                </details>
              </ManualSection>
            )}

            {show('links') && (
              <ManualSection
                id="links"
                number="10"
                icon={<ExternalLink />}
                eyebrow="ATALHOS VERIFICADOS"
                title="Links e referências"
                description="Painéis públicos e páginas obrigatórias do sistema."
              >
                <div className="manual-link-grid">
                  <ManualLink
                    href="https://wal-chat.64.181.178.125.nip.io"
                    title="Wal Chat"
                    text="Aplicação e autenticação"
                  />
                  <ManualLink
                    href="https://wal-chat.64.181.178.125.nip.io/api/ready"
                    title="Readiness"
                    text="Banco e Redis"
                  />
                  <ManualLink
                    href="https://developers.facebook.com/apps/"
                    title="Meta for Developers"
                    text="App, OAuth e webhooks"
                  />
                  <ManualLink
                    href="https://business.facebook.com/"
                    title="Meta Business Suite"
                    text="Ativos e portfólio"
                  />
                  <ManualLink
                    href="https://platform.openai.com/"
                    title="OpenAI Platform"
                    text="Projetos, chaves e uso"
                  />
                  <ManualLink
                    href="https://github.com/ShunWalChin/WalChat"
                    title="GitHub"
                    text="Código e documentação"
                  />
                  <ManualLink
                    href="/privacidade"
                    title="Privacidade"
                    text="Página legal pública"
                    internal
                  />
                  <ManualLink
                    href="/termos"
                    title="Termos"
                    text="Página legal pública"
                    internal
                  />
                  <ManualLink
                    href="/exclusao-de-dados"
                    title="Exclusão de dados"
                    text="Instruções para titulares"
                    internal
                  />
                </div>
                <Callout tone="safe" title="Acesso técnico">
                  SSH, Supabase Studio, backups e secrets são exclusivos da
                  equipe técnica autorizada e permanecem no runbook privado.
                </Callout>
              </ManualSection>
            )}
          </main>
        </div>
      )}
    </div>
  )
}

function ManualSection({
  id,
  number,
  icon,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string
  number: string
  icon: React.ReactNode
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="card manual-section" id={id}>
      <header>
        <span className="manual-section-icon">{icon}</span>
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <em>{number}</em>
      </header>
      <div className="manual-section-body">{children}</div>
    </section>
  )
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: 'safe' | 'warning' | 'danger'
  title: string
  children: React.ReactNode
}) {
  const Icon = tone === 'safe' ? ShieldCheck : AlertTriangle
  return (
    <div className={`manual-callout ${tone}`}>
      <Icon size={20} />
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  )
}

function RoleCard({
  role,
  tone,
  children,
}: {
  role: string
  tone: string
  children: React.ReactNode
}) {
  return (
    <article className={`manual-role ${tone}`}>
      <span>{role.slice(0, 1)}</span>
      <div>
        <strong>{role}</strong>
        <p>{children}</p>
      </div>
    </article>
  )
}

function CopyValue({
  id,
  label,
  value,
  copied,
  onCopy,
}: {
  id: string
  label: string
  value: string
  copied: string | null
  onCopy: (id: string, value: string) => void
}) {
  return (
    <div className="manual-copy-row">
      <span>
        <small>{label}</small>
        <code>{value}</code>
      </span>
      <button
        type="button"
        onClick={() => onCopy(id, value)}
        aria-label={`Copiar ${label}`}
      >
        {copied === id ? <CheckCircle2 size={16} /> : <Copy size={16} />}
        {copied === id ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}

function ModuleRow({
  name,
  status,
  tone,
  children,
}: {
  name: string
  status: string
  tone: string
  children: React.ReactNode
}) {
  return (
    <tr>
      <td>
        <strong>{name}</strong>
      </td>
      <td>
        <span className={`manual-status-chip ${tone}`}>{status}</span>
      </td>
      <td>{children}</td>
    </tr>
  )
}

function ManualLink({
  href,
  title,
  text,
  internal = false,
}: {
  href: string
  title: string
  text: string
  internal?: boolean
}) {
  const content = (
    <>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <ExternalLink size={16} />
    </>
  )
  return internal ? (
    <a className="manual-link-card" href={href}>
      {content}
    </a>
  ) : (
    <a
      className="manual-link-card"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {content}
    </a>
  )
}
