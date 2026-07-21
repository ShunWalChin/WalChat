/** Configuração dos três modos de auto-like, com estado exclusivamente demonstrativo. */
import { createFileRoute } from '@tanstack/react-router'
import {
  Brain,
  CheckCircle2,
  Heart,
  MessageCircle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import { ComplianceBanner, PageIntro, Switch } from '../../components/ui'

export const Route = createFileRoute('/_app/auto-like')({
  component: AutoLikePage,
})

const modes = [
  {
    id: 'all',
    title: 'Tudo que chegar',
    text: 'Curte todo comentário novo, exceto blocklist.',
    icon: Heart,
    count: '247/semana',
  },
  {
    id: 'positive',
    title: 'Só sentimento positivo',
    text: 'Gemini analisa contexto e evita crítica ou ironia.',
    icon: Brain,
    count: '193/semana',
  },
  {
    id: 'keyword',
    title: 'Só palavra-gatilho',
    text: 'Curte quando houver quero, link, preço ou aula.',
    icon: Sparkles,
    count: '118/semana',
  },
]

function AutoLikePage() {
  const [enabled, setEnabled] = useState(true)
  const [mode, setMode] = useState('positive')
  return (
    <div className="stack-lg">
      <PageIntro
        title="Dá moral sem perder a mão."
        description="Reconheça comentários automaticamente, com filtro de spam e leitura de sentimento."
        actions={
          <span className="master-switch">
            <span>
              <strong>Auto-like</strong>
              <small>{enabled ? 'Rodando' : 'Pausado'}</small>
            </span>
            <Switch
              checked={enabled}
              onChange={() => setEnabled(!enabled)}
              label="Auto-like"
            />
          </span>
        }
      />
      <ComplianceBanner compact />
      <div className="auto-like-layout">
        <section className="card modes-card">
          <span className="eyebrow">ESCOLHA O MODO</span>
          <div className="mode-options">
            {modes.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  className={mode === item.id ? 'active' : ''}
                  onClick={() => setMode(item.id)}
                >
                  <span className="radio-circle">
                    {mode === item.id && <i />}
                  </span>
                  <span className="mode-icon">
                    <Icon size={20} />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.text}</p>
                  </div>
                  <em>{item.count}</em>
                </button>
              )
            })}
          </div>
          <div className="keyword-config">
            <label>
              Palavras-gatilho
              <input defaultValue="quero, link, preço, valor, aula" />
            </label>
            <small>Separe por vírgula. Acentos e caixa são ignorados.</small>
          </div>
        </section>
        <aside className="card like-activity">
          <span className="eyebrow">HOJE</span>
          <h3>36 comentários avaliados</h3>
          <div className="like-ring">
            <span>
              <strong>29</strong>
              <small>curtidos</small>
            </span>
          </div>
          <div className="like-breakdown">
            <span>
              <CheckCircle2 size={15} />
              Positivos <strong>29</strong>
            </span>
            <span>
              <MessageCircle size={15} />
              Neutros <strong>5</strong>
            </span>
            <span>
              <ShieldCheck size={15} />
              Bloqueados <strong>2</strong>
            </span>
          </div>
          <p className="ai-insight">
            <Brain size={17} />
            <span>
              <strong>Leitura da IA</strong>A audiência reagiu melhor ao CTA
              simples e ao tom de bastidor.
            </span>
          </p>
        </aside>
      </div>
    </div>
  )
}
