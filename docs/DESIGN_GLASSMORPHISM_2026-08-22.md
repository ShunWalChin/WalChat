# Glassmorphism do Wal Chat

Data da revisão: 22 de agosto de 2026.

## Objetivo

A interface usa um glassmorphism leve para criar profundidade sem prejudicar a
leitura operacional. O tratamento preserva o estilo urbano do Wal Chat, com
fundo `#f2f0ea`, superfícies claras, preto, laranja e azul da marca. Não são
usados gradientes roxos genéricos.

## Aplicação

- barra superior fixa e navegação lateral;
- cards, indicadores, atalhos e blocos de autenticação;
- campos de formulário e botões secundários;
- avisos de compliance, protótipo e consentimento;
- páginas públicas, 404 e confirmação.

Os tokens centrais ficam em `src/styles.css`: `--glass-surface`,
`--glass-surface-strong`, `--glass-surface-dark`, `--glass-border`,
`--glass-line`, `--glass-blur` e `--glass-shadow`.

## Acessibilidade e desempenho

- o texto continua opaco e com contraste alto;
- o blur é reduzido em telas com até 650 px;
- `prefers-reduced-transparency: reduce` remove o efeito e mantém superfícies
  sólidas;
- navegadores sem `backdrop-filter` recebem fallback opaco;
- os estados de foco e a hierarquia de cores existentes foram preservados.

## Validação executada

- landing page, dashboard, contatos e calendário inspecionados no navegador;
- desktop em 1280 × 720 e mobile em 375 × 812;
- nenhum overflow horizontal global encontrado;
- nenhum erro ou warning de console nas rotas verificadas;
- build de produção e lint concluídos sem falha.
