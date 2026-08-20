/** Google Analytics 4 em modo básico: nenhuma tag é carregada sem consentimento. */
import { Link, useRouterState } from '@tanstack/react-router'
import { BarChart3, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { siteConfig } from '../lib/site-config'

const STORAGE_KEY = 'wal-chat-analytics-consent-v1'
const OPEN_EVENT = 'wal-chat:open-analytics-preferences'
type Consent = 'accepted' | 'declined'
type AnalyticsWindow = Window & {
  dataLayer?: Array<unknown[]>
  gtag?: (...args: unknown[]) => void
}

function validMeasurementId(value: string | null) {
  return value && /^G-[A-Z0-9]{6,20}$/i.test(value) ? value : null
}

function enableAnalytics(measurementId: string) {
  const analyticsWindow = window as AnalyticsWindow
  if (!analyticsWindow.gtag) {
    analyticsWindow.dataLayer = analyticsWindow.dataLayer ?? []
    analyticsWindow.gtag = (...args: unknown[]) => {
      analyticsWindow.dataLayer?.push(args)
    }
    analyticsWindow.gtag('js', new Date())
    analyticsWindow.gtag('consent', 'default', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    })
    analyticsWindow.gtag('config', measurementId, {
      anonymize_ip: true,
      send_page_view: false,
    })
  }
  if (!document.querySelector(`script[data-wal-ga="${measurementId}"]`)) {
    const script = document.createElement('script')
    script.async = true
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`
    script.dataset.walGa = measurementId
    document.head.append(script)
  }
}

export function AnalyticsConsent() {
  const measurementId = validMeasurementId(siteConfig.analyticsId)
  const [consent, setConsent] = useState<Consent | null>(null)
  const location = useRouterState({ select: (state) => state.location })

  useEffect(() => {
    if (!measurementId) return
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'accepted' || stored === 'declined') setConsent(stored)
  }, [measurementId])

  useEffect(() => {
    const reopen = () => setConsent(null)
    window.addEventListener(OPEN_EVENT, reopen)
    return () => window.removeEventListener(OPEN_EVENT, reopen)
  }, [])

  useEffect(() => {
    if (!measurementId || consent !== 'accepted') return
    enableAnalytics(measurementId)
    ;(window as AnalyticsWindow).gtag?.('event', 'page_view', {
      page_path: `${location.pathname}${location.searchStr}`,
      page_title: document.title,
    })
  }, [consent, location.pathname, location.searchStr, measurementId])

  if (!measurementId || consent !== null) return null

  function decide(value: Consent) {
    if (value === 'declined')
      (window as AnalyticsWindow).gtag?.('consent', 'update', {
        analytics_storage: 'denied',
      })
    window.localStorage.setItem(STORAGE_KEY, value)
    setConsent(value)
  }

  return (
    <aside
      className="analytics-consent"
      aria-label="Preferências de medição"
      role="dialog"
      aria-modal="false"
    >
      <span className="analytics-consent-icon">
        <BarChart3 size={21} />
      </span>
      <div>
        <strong>Medição com privacidade</strong>
        <p>
          Usamos Analytics somente se você aceitar. Publicidade personalizada
          permanece desligada. Leia a <Link to="/privacidade">política</Link>.
        </p>
      </div>
      <div className="analytics-consent-actions">
        <button
          className="button button-outline"
          onClick={() => decide('declined')}
        >
          <X size={16} /> Recusar
        </button>
        <button
          className="button button-dark"
          onClick={() => decide('accepted')}
        >
          <ShieldCheck size={16} /> Aceitar medição
        </button>
      </div>
    </aside>
  )
}

export function openAnalyticsPreferences() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}
