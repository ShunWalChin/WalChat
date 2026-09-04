import {
  CheckCircle2,
  Clipboard,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Unplug,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api-client'
import { StatusDot } from './ui'

type Provider = 'google_ads' | 'meta_capi'

type ConversionConnection = {
  id: string
  provider: Provider
  deliveryMode: 'direct' | 'n8n'
  status: 'pending' | 'connected' | 'error' | 'disconnected'
  accountId: string
  managerAccountId: string | null
  accountEmail: string | null
  apiVersion: string
  defaultCurrency: string
  lastValidatedAt: string | null
  lastEventAt: string | null
  lastError: string | null
  credentials: {
    oauth?: boolean
    developerToken?: boolean
    accessToken?: boolean
    testEventCode?: boolean
  }
}

export type ConversionRule = {
  id: string
  stageId: string
  name: string
  googleEnabled: boolean
  googleConversionActionId: string | null
  metaEnabled: boolean
  metaEventName: string | null
  metaActionSource: string
  valueMode: 'lead' | 'fixed' | 'none'
  fixedValueCents: number | null
  currency: string
  requireConsent: boolean
  isActive: boolean
}

export type ConversionTrackingStatus = {
  platform: { googleOAuthConfigured: boolean; graphVersion: string }
  permissions: { canManage: boolean }
  connections: ConversionConnection[]
  rules: ConversionRule[]
  stages: Array<{
    id: string
    pipelineId: string
    name: string
    terminalState: string
    pipelineName?: string
  }>
  recentEvents: Array<{
    id: string
    event_name: string
    status: string
    value_cents: number | null
    currency: string
    error_code: string | null
    provider_results: Record<string, unknown>
    event_time: string
    processed_at: string | null
  }>
}

type RuleFormState = {
  id?: string
  stageId: string
  name: string
  googleEnabled: boolean
  googleConversionActionId: string
  metaEnabled: boolean
  metaEventName: string
  metaActionSource: string
  valueMode: 'lead' | 'fixed' | 'none'
  fixedValueCents?: number
  currency: string
  requireConsent: boolean
  isActive: boolean
}

const emptyRule: RuleFormState = {
  id: undefined as string | undefined,
  stageId: '',
  name: 'Lead qualificado',
  googleEnabled: true,
  googleConversionActionId: '',
  metaEnabled: true,
  metaEventName: 'Lead',
  metaActionSource: 'system_generated',
  valueMode: 'lead',
  fixedValueCents: undefined as number | undefined,
  currency: 'BRL',
  requireConsent: true,
  isActive: true,
}

const gtmSnippet = `<script>
(function () {
  var q = new URLSearchParams(location.search);
  var cookie = Object.fromEntries(document.cookie.split('; ').map(function (v) {
    var p = v.indexOf('='); return [v.slice(0, p), v.slice(p + 1)];
  }));
  var values = {
    gclid: q.get('gclid'), gbraid: q.get('gbraid'), wbraid: q.get('wbraid'),
    fbclid: q.get('fbclid'), fbc: cookie._fbc, fbp: cookie._fbp,
    utm_source: q.get('utm_source'), utm_medium: q.get('utm_medium'),
    utm_campaign: q.get('utm_campaign'), utm_content: q.get('utm_content'),
    utm_term: q.get('utm_term'), landing_url: location.href,
    referrer_url: document.referrer, client_user_agent: navigator.userAgent,
    ad_user_data_consent: 'unknown', captured_at: new Date().toISOString()
  };
  Object.keys(values).forEach(function (name) {
    var field = document.querySelector('[name="' + name + '"]');
    if (field && values[name]) field.value = values[name];
  });
})();
</script>`

function localDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(value))
    : 'Ainda não'
}

export function ConversionTrackingPanel({
  status,
  loading,
  onRefresh,
}: {
  status: ConversionTrackingStatus | null
  loading: boolean
  onRefresh: () => Promise<void>
}) {
  const google = status?.connections.find(
    (connection) => connection.provider === 'google_ads',
  )
  const meta = status?.connections.find(
    (connection) => connection.provider === 'meta_capi',
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error'
    text: string
  } | null>(null)
  const [googleForm, setGoogleForm] = useState({
    customerId: '',
    managerCustomerId: '',
    developerToken: '',
    deliveryMode: 'direct' as 'direct' | 'n8n',
  })
  const [metaForm, setMetaForm] = useState({
    datasetId: '',
    accessToken: '',
    testEventCode: '',
    deliveryMode: 'direct' as 'direct' | 'n8n',
    testMode: false,
  })
  const [ruleForm, setRuleForm] = useState<RuleFormState>(emptyRule)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (google)
      setGoogleForm((current) => ({
        ...current,
        customerId: google.accountId,
        managerCustomerId: google.managerAccountId ?? '',
        deliveryMode: google.deliveryMode,
      }))
    if (meta)
      setMetaForm((current) => ({
        ...current,
        datasetId: meta.accountId,
        deliveryMode: meta.deliveryMode,
        testMode: Boolean(meta.credentials.testEventCode),
      }))
  }, [google, meta])

  useEffect(() => {
    if (!ruleForm.stageId && status?.stages[0])
      setRuleForm((current) => ({
        ...current,
        stageId: status.stages[0].id,
      }))
  }, [ruleForm.stageId, status?.stages])

  useEffect(() => {
    const oauthStatus = new URLSearchParams(window.location.search).get(
      'googleAds',
    )
    if (oauthStatus)
      setFeedback({
        tone: oauthStatus === 'connected' ? 'success' : 'error',
        text:
          oauthStatus === 'connected'
            ? 'Conta Google autorizada. Complete o ID do cliente e valide.'
            : 'A autorização do Google Ads não foi concluída.',
      })
    if (oauthStatus) {
      const cleanUrl = new URL(window.location.href)
      cleanUrl.searchParams.delete('googleAds')
      window.history.replaceState(null, '', cleanUrl)
    }
  }, [])

  const readyProviders = useMemo(
    () =>
      status?.connections.filter(
        (connection) => connection.status === 'connected',
      ).length ?? 0,
    [status?.connections],
  )

  async function action(
    key: string,
    work: () => Promise<void>,
    success: string,
  ) {
    setBusy(key)
    setFeedback(null)
    try {
      await work()
      await onRefresh()
      setFeedback({ tone: 'success', text: success })
      return true
    } catch (caught) {
      setFeedback({
        tone: 'error',
        text: caught instanceof Error ? caught.message : 'A operação falhou.',
      })
      return false
    } finally {
      setBusy(null)
    }
  }

  async function connectGoogle() {
    await action(
      'google-oauth',
      async () => {
        const result = await apiFetch<{ authorizationUrl: string }>(
          '/api/integrations/conversions/google/start',
          { method: 'POST' },
        )
        window.location.assign(result.authorizationUrl)
      },
      'Abrindo autorização do Google Ads.',
    )
  }

  async function saveGoogle() {
    const saved = await action(
      'google-save',
      () =>
        apiFetch('/api/integrations/conversions/configure', {
          method: 'PUT',
          body: JSON.stringify({
            provider: 'google_ads',
            customerId: googleForm.customerId.replace(/\D/g, ''),
            managerCustomerId:
              googleForm.managerCustomerId.replace(/\D/g, '') || undefined,
            developerToken: googleForm.developerToken || undefined,
            deliveryMode: googleForm.deliveryMode,
            defaultCurrency: 'BRL',
          }),
        }),
      'Configuração do Google Ads salva. Faça o teste antes de ativar regras.',
    )
    if (saved) setGoogleForm((current) => ({ ...current, developerToken: '' }))
  }

  async function saveMeta() {
    const saved = await action(
      'meta-save',
      () =>
        apiFetch('/api/integrations/conversions/configure', {
          method: 'PUT',
          body: JSON.stringify({
            provider: 'meta_capi',
            datasetId: metaForm.datasetId.replace(/\D/g, ''),
            accessToken: metaForm.accessToken || undefined,
            testEventCode: metaForm.testEventCode || undefined,
            clearTestEventCode: !metaForm.testMode,
            deliveryMode: metaForm.deliveryMode,
            defaultCurrency: 'BRL',
          }),
        }),
      'Configuração da Meta CAPI salva. Faça o teste antes de ativar regras.',
    )
    if (saved)
      setMetaForm((current) => ({
        ...current,
        accessToken: '',
        testEventCode: '',
      }))
  }

  async function testProvider(provider: Provider) {
    await action(
      `${provider}-test`,
      () =>
        apiFetch('/api/integrations/conversions/test', {
          method: 'POST',
          body: JSON.stringify({ provider }),
        }),
      `${provider === 'google_ads' ? 'Google Ads' : 'Meta CAPI'} validado com sucesso.`,
    )
  }

  async function disconnect(provider: Provider) {
    if (!window.confirm('Desconectar e apagar as credenciais deste provedor?'))
      return
    await action(
      `${provider}-disconnect`,
      () =>
        apiFetch(
          `/api/integrations/conversions/disconnect?provider=${provider}`,
          { method: 'DELETE' },
        ),
      'Provedor desconectado.',
    )
  }

  async function saveRule() {
    const saved = await action(
      'rule-save',
      () =>
        apiFetch('/api/integrations/conversions/rules', {
          method: 'POST',
          body: JSON.stringify({
            operation: 'save',
            rule: {
              ...ruleForm,
              id: ruleForm.id || undefined,
              googleConversionActionId:
                ruleForm.googleConversionActionId || undefined,
              metaEventName: ruleForm.metaEventName || undefined,
              fixedValueCents:
                ruleForm.valueMode === 'fixed'
                  ? ruleForm.fixedValueCents
                  : undefined,
            },
          }),
        }),
      'Regra de conversão salva. Novas entradas nessa etapa serão enfileiradas.',
    )
    if (saved)
      setRuleForm({
        ...emptyRule,
        stageId: status?.stages[0]?.id ?? '',
      })
  }

  async function deleteRule(ruleId: string) {
    if (!window.confirm('Excluir esta regra de conversão?')) return
    await action(
      'rule-delete',
      () =>
        apiFetch('/api/integrations/conversions/rules', {
          method: 'POST',
          body: JSON.stringify({ operation: 'delete', ruleId }),
        }),
      'Regra excluída.',
    )
  }

  async function replay(eventId: string) {
    await action(
      `replay-${eventId}`,
      () =>
        apiFetch('/api/integrations/conversions/replay', {
          method: 'POST',
          body: JSON.stringify({ eventId }),
        }),
      'Conversão reenfileirada com o mesmo identificador idempotente.',
    )
  }

  if (loading && !status)
    return (
      <section className="card conversion-panel-loading">
        <LoaderCircle className="spin" size={22} /> Carregando OCI/CAPI…
      </section>
    )

  return (
    <section
      className="card conversion-panel"
      aria-labelledby="conversions-title"
    >
      <div className="connection-wizard-head">
        <div>
          <span className="eyebrow">OFFLINE CONVERSIONS</span>
          <h2 id="conversions-title">Google Ads OCI + Meta CAPI</h2>
          <p>
            Capture o clique, relacione ao contato e devolva conversões reais
            quando o lead avançar no CRM.
          </p>
        </div>
        <StatusDot tone={readyProviders > 0 ? 'green' : 'orange'}>
          {readyProviders} de 2 provedores validados
        </StatusDot>
      </div>

      {feedback && (
        <div
          className={
            feedback.tone === 'success' ? 'form-success' : 'form-error'
          }
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {feedback.tone === 'success' ? (
            <CheckCircle2 size={16} />
          ) : (
            <ShieldCheck size={16} />
          )}
          {feedback.text}
        </div>
      )}

      <div className="conversion-provider-grid">
        <ProviderBox
          title="Google Ads — OCI"
          description="OAuth, developer token e ação de conversão UPLOAD_CLICKS."
          connection={google}
        >
          <label className="form-field">
            <span>ID do cliente (10 dígitos)</span>
            <input
              inputMode="numeric"
              value={googleForm.customerId}
              onChange={(event) =>
                setGoogleForm((current) => ({
                  ...current,
                  customerId: event.target.value,
                }))
              }
              placeholder="1234567890"
              maxLength={12}
            />
          </label>
          <label className="form-field">
            <span>ID da conta gerente (opcional)</span>
            <input
              inputMode="numeric"
              value={googleForm.managerCustomerId}
              onChange={(event) =>
                setGoogleForm((current) => ({
                  ...current,
                  managerCustomerId: event.target.value,
                }))
              }
              placeholder="Sem hífens"
              maxLength={12}
            />
          </label>
          <label className="form-field">
            <span>
              Developer token{' '}
              {google?.credentials.developerToken && '(já salvo)'}
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={googleForm.developerToken}
              onChange={(event) =>
                setGoogleForm((current) => ({
                  ...current,
                  developerToken: event.target.value,
                }))
              }
              placeholder="Nunca será exibido novamente"
            />
          </label>
          <DeliveryMode
            value={googleForm.deliveryMode}
            onChange={(deliveryMode) =>
              setGoogleForm((current) => ({ ...current, deliveryMode }))
            }
          />
          <div className="connection-actions compact">
            <button
              className="button button-outline"
              onClick={() => void connectGoogle()}
              disabled={
                !status?.permissions.canManage ||
                !status.platform.googleOAuthConfigured ||
                Boolean(busy)
              }
            >
              <ExternalLink size={15} />
              {google?.credentials.oauth
                ? 'Reautorizar OAuth'
                : 'Autorizar Google'}
            </button>
            <button
              className="button button-orange"
              onClick={() => void saveGoogle()}
              disabled={
                !status?.permissions.canManage ||
                googleForm.customerId.replace(/\D/g, '').length !== 10 ||
                Boolean(busy)
              }
            >
              {busy === 'google-save' && (
                <LoaderCircle className="spin" size={15} />
              )}
              Salvar
            </button>
            <button
              className="button button-outline"
              onClick={() => void testProvider('google_ads')}
              disabled={!google || Boolean(busy)}
            >
              <Send size={15} /> Testar
            </button>
            {google && (
              <button
                className="button button-danger-quiet"
                onClick={() => void disconnect('google_ads')}
                disabled={Boolean(busy)}
                aria-label="Desconectar Google Ads"
              >
                <Unplug size={15} />
              </button>
            )}
          </div>
        </ProviderBox>

        <ProviderBox
          title="Meta — Conversions API"
          description={`Dataset/pixel, token de sistema e Graph ${status?.platform.graphVersion ?? 'v25.0'}.`}
          connection={meta}
        >
          <label className="form-field">
            <span>ID do dataset ou pixel</span>
            <input
              inputMode="numeric"
              value={metaForm.datasetId}
              onChange={(event) =>
                setMetaForm((current) => ({
                  ...current,
                  datasetId: event.target.value,
                }))
              }
              maxLength={40}
            />
          </label>
          <label className="form-field">
            <span>
              Access token {meta?.credentials.accessToken && '(já salvo)'}
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={metaForm.accessToken}
              onChange={(event) =>
                setMetaForm((current) => ({
                  ...current,
                  accessToken: event.target.value,
                }))
              }
              placeholder="Nunca será exibido novamente"
            />
          </label>
          <label className="form-field">
            <span>Test Event Code (opcional)</span>
            <input
              type="password"
              autoComplete="new-password"
              value={metaForm.testEventCode}
              disabled={!metaForm.testMode}
              onChange={(event) =>
                setMetaForm((current) => ({
                  ...current,
                  testEventCode: event.target.value,
                }))
              }
              placeholder={
                meta?.credentials.testEventCode ? 'Já salvo' : 'TEST12345'
              }
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={metaForm.testMode}
              onChange={(event) =>
                setMetaForm((current) => ({
                  ...current,
                  testMode: event.target.checked,
                }))
              }
            />
            Manter modo de teste ativo
          </label>
          <DeliveryMode
            value={metaForm.deliveryMode}
            onChange={(deliveryMode) =>
              setMetaForm((current) => ({ ...current, deliveryMode }))
            }
          />
          <div className="connection-actions compact">
            <button
              className="button button-orange"
              onClick={() => void saveMeta()}
              disabled={
                !status?.permissions.canManage ||
                metaForm.datasetId.replace(/\D/g, '').length < 5 ||
                Boolean(busy)
              }
            >
              {busy === 'meta-save' && (
                <LoaderCircle className="spin" size={15} />
              )}
              Salvar
            </button>
            <button
              className="button button-outline"
              onClick={() => void testProvider('meta_capi')}
              disabled={!meta || Boolean(busy)}
            >
              <Send size={15} /> Testar
            </button>
            {meta && (
              <button
                className="button button-danger-quiet"
                onClick={() => void disconnect('meta_capi')}
                disabled={Boolean(busy)}
                aria-label="Desconectar Meta CAPI"
              >
                <Unplug size={15} />
              </button>
            )}
          </div>
        </ProviderBox>
      </div>

      <div className="conversion-section">
        <div className="conversion-section-head">
          <div>
            <span className="eyebrow">REGRAS DO FUNIL</span>
            <h3>Quando devolver uma conversão</h3>
          </div>
          <small>Uma regra por etapa; sem retroenvio automático.</small>
        </div>
        <div className="conversion-rule-form">
          <label className="form-field">
            <span>Etapa do CRM</span>
            <select
              value={ruleForm.stageId}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  stageId: event.target.value,
                }))
              }
            >
              {status?.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.pipelineName ? `${stage.pipelineName} · ` : ''}
                  {stage.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Nome da conversão</span>
            <input
              value={ruleForm.name}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              maxLength={120}
            />
          </label>
          <label className="form-field">
            <span>Valor</span>
            <select
              value={ruleForm.valueMode}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  valueMode: event.target.value as 'lead' | 'fixed' | 'none',
                }))
              }
            >
              <option value="lead">Valor da oportunidade</option>
              <option value="fixed">Valor fixo</option>
              <option value="none">Sem valor</option>
            </select>
          </label>
          {ruleForm.valueMode === 'fixed' && (
            <label className="form-field">
              <span>Valor fixo (R$)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={(ruleForm.fixedValueCents ?? 0) / 100}
                onChange={(event) =>
                  setRuleForm((current) => ({
                    ...current,
                    fixedValueCents: Math.round(
                      Number(event.target.value) * 100,
                    ),
                  }))
                }
              />
            </label>
          )}
          <label className="check-row">
            <input
              type="checkbox"
              checked={ruleForm.googleEnabled}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  googleEnabled: event.target.checked,
                }))
              }
            />
            Google Ads
          </label>
          {ruleForm.googleEnabled && (
            <label className="form-field">
              <span>ID da ação de conversão</span>
              <input
                inputMode="numeric"
                value={ruleForm.googleConversionActionId}
                onChange={(event) =>
                  setRuleForm((current) => ({
                    ...current,
                    googleConversionActionId: event.target.value.replace(
                      /\D/g,
                      '',
                    ),
                  }))
                }
              />
            </label>
          )}
          <label className="check-row">
            <input
              type="checkbox"
              checked={ruleForm.metaEnabled}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  metaEnabled: event.target.checked,
                }))
              }
            />
            Meta CAPI
          </label>
          {ruleForm.metaEnabled && (
            <label className="form-field">
              <span>Nome do evento Meta</span>
              <input
                value={ruleForm.metaEventName}
                onChange={(event) =>
                  setRuleForm((current) => ({
                    ...current,
                    metaEventName: event.target.value,
                  }))
                }
              />
            </label>
          )}
          {ruleForm.metaEnabled && (
            <label className="form-field">
              <span>Origem do evento Meta</span>
              <select
                value={ruleForm.metaActionSource}
                onChange={(event) =>
                  setRuleForm((current) => ({
                    ...current,
                    metaActionSource: event.target.value,
                  }))
                }
              >
                <option value="system_generated">Sistema/CRM</option>
                <option value="website">Website</option>
                <option value="chat">Chat</option>
                <option value="phone_call">Ligação</option>
                <option value="email">E-mail</option>
                <option value="physical_store">Loja física</option>
                <option value="other">Outra</option>
              </select>
            </label>
          )}
          <label className="check-row wide">
            <input
              type="checkbox"
              checked={ruleForm.requireConsent}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  requireConsent: event.target.checked,
                }))
              }
            />
            Exigir consentimento antes de enviar dados do usuário
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={ruleForm.isActive}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  isActive: event.target.checked,
                }))
              }
            />
            Regra ativa
          </label>
          <button
            className="button button-dark"
            onClick={() => void saveRule()}
            disabled={
              !status?.permissions.canManage ||
              !ruleForm.stageId ||
              !ruleForm.name.trim() ||
              Boolean(busy)
            }
          >
            {ruleForm.id ? <RefreshCw size={15} /> : <Plus size={15} />}
            {ruleForm.id ? 'Atualizar regra' : 'Criar regra'}
          </button>
        </div>
        <div className="conversion-rule-list">
          {status?.rules.map((rule) => (
            <div key={rule.id}>
              <span>
                <strong>{rule.name}</strong>
                <small>
                  {
                    status.stages.find((stage) => stage.id === rule.stageId)
                      ?.name
                  }
                  {' · '}
                  {[rule.googleEnabled && 'Google', rule.metaEnabled && 'Meta']
                    .filter(Boolean)
                    .join(' + ')}
                </small>
              </span>
              <StatusDot tone={rule.isActive ? 'green' : 'gray'}>
                {rule.isActive ? 'Ativa' : 'Pausada'}
              </StatusDot>
              <button
                className="icon-button"
                aria-label={`Editar ${rule.name}`}
                onClick={() =>
                  setRuleForm({
                    ...emptyRule,
                    ...rule,
                    googleConversionActionId:
                      rule.googleConversionActionId ?? '',
                    metaEventName: rule.metaEventName ?? '',
                    fixedValueCents: rule.fixedValueCents ?? undefined,
                  })
                }
              >
                <RefreshCw size={15} />
              </button>
              <button
                className="icon-button danger"
                aria-label={`Excluir ${rule.name}`}
                onClick={() => void deleteRule(rule.id)}
                disabled={Boolean(busy)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {!status?.rules.length && <p>Nenhuma regra configurada.</p>}
        </div>
      </div>

      <details className="conversion-advanced">
        <summary>
          <span>
            <strong>Implementação técnica e diagnóstico</strong>
            <small>Snippet do site e últimas entregas do pipeline</small>
          </span>
        </summary>
        <div className="conversion-section conversion-technical-grid">
          <div>
            <div className="conversion-section-head">
              <div>
                <span className="eyebrow">CAPTURA EXTERNA</span>
                <h3>Snippet para GTM/formulários</h3>
              </div>
              <button
                className="button button-outline"
                onClick={() => {
                  void navigator.clipboard.writeText(gtmSnippet)
                  setCopied(true)
                }}
              >
                <Clipboard size={15} /> {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="conversion-code">
              <code>{gtmSnippet}</code>
            </pre>
            <p className="helper-text">
              O WalChat também captura esses dados automaticamente na agenda
              pública. Envie os campos ao webhook de leads. O hash SHA-256 final
              é sempre refeito no servidor.
            </p>
          </div>
          <div>
            <div className="conversion-section-head">
              <div>
                <span className="eyebrow">ÚLTIMAS ENTREGAS</span>
                <h3>Saúde do pipeline</h3>
              </div>
            </div>
            <div className="conversion-event-list">
              {status?.recentEvents.map((event) => (
                <div key={event.id}>
                  <span>
                    <strong>{event.event_name}</strong>
                    <small>{localDate(event.event_time)}</small>
                  </span>
                  <StatusDot
                    tone={
                      event.status === 'completed'
                        ? 'green'
                        : ['failed', 'blocked'].includes(event.status)
                          ? 'red'
                          : 'orange'
                    }
                  >
                    {event.status}
                  </StatusDot>
                  {['failed', 'partial', 'blocked'].includes(event.status) && (
                    <button
                      className="icon-button"
                      aria-label={`Reenviar ${event.event_name}`}
                      title={event.error_code ?? 'Reenviar'}
                      onClick={() => void replay(event.id)}
                      disabled={Boolean(busy)}
                    >
                      {busy === `replay-${event.id}` ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <RefreshCw size={15} />
                      )}
                    </button>
                  )}
                </div>
              ))}
              {!status?.recentEvents.length && (
                <p>Nenhuma conversão processada.</p>
              )}
            </div>
          </div>
        </div>
      </details>
    </section>
  )
}

function ProviderBox({
  title,
  description,
  connection,
  children,
}: {
  title: string
  description: string
  connection?: ConversionConnection
  children: React.ReactNode
}) {
  return (
    <section className="conversion-provider-box">
      <header>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <StatusDot
          tone={connection?.status === 'connected' ? 'green' : 'orange'}
        >
          {connection?.status === 'connected' ? 'Validado' : 'Pendente'}
        </StatusDot>
      </header>
      {children}
      {connection && (
        <small className="connection-meta">
          Última validação: {localDate(connection.lastValidatedAt)}
          {connection.lastError ? ` · ${connection.lastError}` : ''}
        </small>
      )}
    </section>
  )
}

function DeliveryMode({
  value,
  onChange,
}: {
  value: 'direct' | 'n8n'
  onChange: (value: 'direct' | 'n8n') => void
}) {
  return (
    <label className="form-field">
      <span>Roteamento</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as 'direct' | 'n8n')}
      >
        <option value="direct">Direto pelo WalChat</option>
        <option value="n8n">Orquestrar via n8n</option>
      </select>
    </label>
  )
}
