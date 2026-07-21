/** Página pública de instruções e protocolo de exclusão de dados. */
import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { LegalPage } from '../components/legal-page'

export const Route = createFileRoute('/exclusao-de-dados')({
  component: DeletionPage,
})

function DeletionPage() {
  const [sent, setSent] = useState(false)
  return (
    <LegalPage eyebrow="CONTROLE DOS SEUS DADOS" title="Exclusão de Dados">
      <p>
        Você pode desconectar o Instagram e excluir permanentemente os dados
        associados ao seu workspace. A solicitação inclui contatos, mensagens,
        métricas, automações, conteúdos e credenciais armazenadas.
      </p>
      <h2>Como solicitar</h2>
      <ol>
        <li>Informe abaixo o email usado no Wal Chat.</li>
        <li>Confirme a solicitação pelo email recebido.</li>
        <li>
          Concluiremos a exclusão em até 30 dias e enviaremos um comprovante.
        </li>
      </ol>
      {sent ? (
        <div className="deletion-success">
          <CheckCircle2 size={22} />
          <div>
            <strong>Solicitação registrada</strong>
            <p>Confira seu email para confirmar a exclusão.</p>
          </div>
        </div>
      ) : (
        <form
          className="deletion-form"
          onSubmit={(event) => {
            event.preventDefault()
            setSent(true)
          }}
        >
          <label>
            Email da conta
            <input type="email" placeholder="voce@exemplo.com" required />
          </label>
          <label>
            Usuário do Instagram (opcional)
            <input placeholder="@seuperfil" />
          </label>
          <button className="button button-orange" type="submit">
            <Trash2 size={16} />
            Solicitar exclusão
          </button>
        </form>
      )}
      <h2>Callback da Meta</h2>
      <p>
        Solicitações recebidas pelo mecanismo de exclusão da Meta geram um
        código de confirmação e seguem o mesmo fluxo seguro. Dados que precisem
        ser mantidos por obrigação legal serão isolados e eliminados ao fim do
        prazo aplicável.
      </p>
    </LegalPage>
  )
}
