/** Rota layout que agrupa todas as telas autenticadas sob `AppShell`. */
import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '../components/app-shell'
import { seoHead } from '../lib/seo'

export const Route = createFileRoute('/_app')({
  head: () =>
    seoHead({
      title: 'Área de operação',
      description: 'Área autenticada de operação do Wal Chat.',
      path: '/dashboard',
      noindex: true,
    }),
  component: AppShell,
})
