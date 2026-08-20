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
import {
  ComplianceBanner,
  PageIntro,
  PrototypeNotice,
  Switch,
} from '../../components/ui'

export const Route = createFileRoute('/_app/auto-like')({
  component: AutoLikePage,
})

const modes = [
  {
    id: 'all',
    title: 'Tudo que chegar',
    text: 'Curte todo comentário novo, exceto blocklist.',
    icon: Heart,
    count: 'Prévia',
  },
  {
    id: 'positive',
    title: 'Só sentimento positivo',
    text: 'Gemini analisa contexto e evita crítica ou ironia.',
    icon: Brain,
    count: 'Prévia',
  },
  {
    id: 'keyword',
    title: 'Só palavra-gatilho',
    text: 'Curte quando houver quero, link, preço ou aula.',
    icon: Sparkles,
    count: 'Prévia',
  },
]

function AutoLikePage() {
  const [enabled] = useState(false)
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
              <small>Aguardando backend</small>
            </span>
            <Switch checked={enabled} disabled label="Auto-like" />
          </span>
        }
      />
      <PrototypeNotice title="Auto-like ainda não executa ações externas">
        Esta tela é uma prévia de configuração. O switch está bloqueado até a
        persistência, a auditoria e a chamada oficial de reação da Meta serem
        homologadas.
      </PrototypeNotice>
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
              <input defaultValue="quero, link, preço, valor, aula" disabled />
            </label>
            <small>Separe por vírgula. Acentos e caixa são ignorados.</small>
          </div>
        </section>
        <aside className="card like-activity">
          <span className="eyebrow">HOJE</span>
          <h3>Sem atividade real conectada</h3>
          <div className="like-ring">
            <span>
              <strong>0</strong>
              <small>curtidos</small>
            </span>
          </div>
          <div className="like-breakdown">
            <span>
              <CheckCircle2 size={15} />
              Positivos <strong>0</strong>
            </span>
            <span>
              <MessageCircle size={15} />
              Neutros <strong>0</strong>
            </span>
            <span>
              <ShieldCheck size={15} />
              Bloqueados <strong>0</strong>
            </span>
          </div>
          <p className="ai-insight">
            <Brain size={17} />
            <span>
              <strong>Leitura da IA</strong>Disponível depois que comentários
              reais e o provedor de IA forem validados.
            </span>
          </p>
        </aside>
      </div>
    </div>
  )
}
