/** Configuração de personas, modo copiloto/autônomo e playground sem envio. */
import { createFileRoute } from '@tanstack/react-router'
import {
  BookOpen,
  Bot,
  BrainCircuit,
  MessageSquareText,
  Plus,
  Send,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import { agents } from '../../lib/demo-data'
import { PageIntro, StatusDot, Switch } from '../../components/ui'

export const Route = createFileRoute('/_app/agentes')({ component: AgentsPage })

function AgentsPage() {
  const [selected, setSelected] = useState(0)
  const [prompt, setPrompt] = useState(
    'Oi, vi seu conteúdo e queria entender como funciona a mentoria.',
  )
  const [answer, setAnswer] = useState('')
  const [thinking, setThinking] = useState(false)

  /** Gera uma prévia local no MVP; não transmite a resposta ao Instagram. */
  function runPlayground() {
    setThinking(true)
    window.setTimeout(() => {
      setAnswer(
        'Salve! Que bom te ver por aqui 👊 A mentoria é feita pra creator que quer organizar conteúdo e transformar audiência em negócio. Me conta: hoje seu maior desafio é crescer, vender ou manter consistência?\n\nResponda PARAR',
      )
      setThinking(false)
    }, 750)
  }

  return (
    <div className="stack-lg">
      <PageIntro
        title="IA com o seu jeito."
        description="Crie personas, alimente conhecimento e escolha entre co-piloto ou atendimento autônomo."
        actions={
          <button className="button button-orange">
            <Plus size={16} /> Novo agente
          </button>
        }
      />
      <div className="agents-grid">
        {agents.map((agent, index) => (
          <button
            className={`card agent-card ${selected === index ? 'selected' : ''}`}
            key={agent.name}
            onClick={() => setSelected(index)}
          >
            <span className="agent-avatar" style={{ background: agent.color }}>
              <Bot size={22} />
            </span>
            <div className="agent-title">
              <h3>{agent.name}</h3>
              <Switch checked={agent.active} label={agent.name} />
            </div>
            <span
              className={`mode-chip ${agent.mode === 'Autônomo' ? 'autonomous' : ''}`}
            >
              {agent.mode}
            </span>
            <p>{agent.persona}</p>
            <footer>
              <BookOpen size={14} /> {agent.knowledge} fontes de conhecimento
            </footer>
          </button>
        ))}
      </div>

      <div className="playground-grid">
        <section className="card agent-config">
          <div className="card-head">
            <div>
              <span className="eyebrow">PERSONA SELECIONADA</span>
              <h3>{agents[selected].name}</h3>
            </div>
            <BrainCircuit size={20} />
          </div>
          <label>
            Instruções da persona
            <textarea defaultValue={agents[selected].persona} />
          </label>
          <div className="two-fields">
            <label>
              Modo
              <select defaultValue={agents[selected].mode}>
                <option>Co-piloto</option>
                <option>Autônomo</option>
              </select>
            </label>
            <label>
              Tom
              <select defaultValue="Próximo e direto">
                <option>Próximo e direto</option>
                <option>Didático</option>
                <option>Comercial leve</option>
              </select>
            </label>
          </div>
          <div className="knowledge-row">
            <span>
              <BookOpen size={17} />
              <span>
                <strong>Base de conhecimento</strong>
                <small>12 documentos · atualizada hoje</small>
              </span>
            </span>
            <button className="button button-outline">Gerenciar</button>
          </div>
        </section>
        <section className="card playground">
          <div className="card-head">
            <div>
              <span className="eyebrow">PLAYGROUND</span>
              <h3>Teste antes de liberar</h3>
            </div>
            <StatusDot tone="green">Gemini 2.5 Flash</StatusDot>
          </div>
          <div className="playground-chat">
            <div className="test-message user">
              <MessageSquareText size={15} />
              <p>{prompt}</p>
            </div>
            {answer && (
              <div className="test-message ai">
                <Sparkles size={15} />
                <p>{answer}</p>
              </div>
            )}
            {thinking && (
              <div className="thinking">
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
          <div className="prompt-box">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <button className="send-button" onClick={runPlayground}>
              <Send size={16} />
            </button>
          </div>
          <small>O teste não envia mensagem real ao Instagram.</small>
        </section>
      </div>
    </div>
  )
}
