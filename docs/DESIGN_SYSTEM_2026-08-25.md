# Design system do Wal Chat — auditoria e refino, 25/08/2026

## Resumo

| Métrica                                  |  Antes | Depois |
| ---------------------------------------- | -----: | -----: |
| Tokens no `:root`                        |     19 |     53 |
| Declarações abaixo de 11px               |    332 |      0 |
| Menor tamanho de fonte declarado         |    6px |   11px |
| Texto reprovando WCAG AA (1350 amostras) |    21% |     0% |
| Contraste do indicador de foco (papel)   | 1,47:1 | 4,69:1 |

Medido no navegador, em 16 telas, sobre o bundle de produção.

## O que a auditoria encontrou

### Tipografia abaixo do legível

**332 das 470 declarações de `font-size` viviam entre 6px e 10px.** Não havia
`html { font-size }`, zoom nem `transform: scale` — eram pixels literais. Na
prática, metade do texto do shell renderizava abaixo de 12px e quase um terço
abaixo de 10px; os rótulos de navegação saíam em 8px.

Para um produto que se propõe simples de operar, esse era o achado mais caro.

### Tokens existiam, mas eram contornados

19 tokens no `:root` contra **272 cores literais distintas** em 499 ocorrências.
O sintoma clássico aparecia nos quase-duplicados: `#aaa79f` e `#aaa69d`,
`#eeece6` / `#efede7` / `#eeece7`, `#faf9f6` / `#faf8f4`. É a mesma cor
pretendida derivando por não haver um nome para ela.

### O indicador de foco não era percebido

A regra global usava `outline: 3px solid rgba(47, 102, 208, 0.28)`. A opacidade
de 28% compunha **1,47:1** sobre o papel e **1,31:1** sobre a barra escura,
contra os 3:1 que a WCAG 1.4.11 exige.

### Escalas sem passo

42 valores distintos de espaçamento e 18 de raio, com 8, 9, 10 e 11px
convivendo sem distinção de propósito.

## O que foi feito

### Piso tipográfico preservando a hierarquia

O remapeamento não achatou tudo num tamanho só — isso destruiria a hierarquia
em telas densas, onde um rótulo de 8px sobre um valor de 10px viraria o mesmo
texto. O mapa mantém a ordem:

```
6, 7, 8  →  11        11, 12  →  13
9, 10    →  12        13      →  14
```

Nenhum passo passa a ser maior que o seguinte. Resultado: 0 declarações abaixo
de 11px, sem estouro horizontal em nenhuma das 16 telas.

`small` recebeu um passo explícito porque escala 0,8em por padrão do navegador
e escapava do piso — dentro de um bloco de 13px ele caía para 10px.

### Tokens semânticos com escopo

A descoberta que organizou o resto: **o laranja da marca não pode ser um token
só**. Como texto no papel ele dá 2,97:1; escurecê-lo resolve no claro e piora no
escuro. A mesma tensão vale para o cinza secundário.

A resposta foi escopo, não exceção:

```css
:root {
  --orange-text: #cb3503; /* letra sobre superfície clara */
  --orange-text-on-dark: #fa7846; /* letra sobre superfície escura */
}

.glass-dark,
.go-live-hero,
.manual-hero /* … */ {
  --orange-text: var(--orange-text-on-dark);
  --muted: #848179;
}
```

Cada regra escreve `color: var(--orange-text)` sem saber onde está; a cascata
escolhe a variante certa. Foi o que permitiu corrigir 74 usos de uma vez.

### A barra lateral precisou do próprio escopo

Ela é translúcida (92%), então o fundo composto atrás dela é `#272724` — e sob
um item ativo chega a `#353533`, bem mais claro que o `#151513` do token. Um
único valor de cinza não passa em `#181815` e em `#353533` ao mesmo tempo, então
a barra recebeu o seu par de valores.

Esse detalhe custou duas rodadas de medição: calibrar contra a cor do token, e
não contra o fundo realmente composto, produzia valores que continuavam
reprovando.

### Contraste corrigido na origem

Todo ajuste foi calculado até cruzar o limiar, nunca estimado:

| Elemento                      |  Antes | Depois |
| ----------------------------- | -----: | -----: |
| Botão primário (texto branco) | 3,39:1 | 4,51:1 |
| Rótulos de navegação          | 3,48:1 | 4,51:1 |
| `--muted` em texto secundário | 4,16:1 | 4,73:1 |
| Laranja como texto            | 2,97:1 | 4,55:1 |
| Numeral de passo do Manual    | 1,46:1 | 3,09:1 |

O botão primário mudou só o preenchimento (`--orange-strong`), preservando o
laranja da marca em todo lugar que não carrega letra.

## Camada de tokens

```
Tipografia   --text-2xs (11) … --text-display (43)      9 passos
Espaçamento  --space-1 (4) … --space-10 (40)            8 passos
Raio         --radius-sm (6) … --radius-pill (999)      5 passos
Foco         --focus-ring, -width, -offset
Neutros      --surface-raised, --surface-sunk, --line-soft, --ink-faint
Semânticos   --orange-text, --orange-text-on-dark, --orange-strong,
             --ink-on-dark-faint, --ink-on-dark-muted
```

## O que continua aberto

- **266 cores literais distintas** permanecem no corpo da folha. As
  consolidadas foram as que tinham duplicata evidente; migrar o resto exige
  decidir o papel semântico de cada uma, uma a uma.
- **As escalas de espaçamento e raio estão definidas mas não aplicadas.** Os
  tokens existem; as 1762 regras continuam com valores literais. Aplicá-los é
  mecânico, mas muda layout e precisa ser feito por área, com verificação.
- **Nenhum estado `:active`** em todo o sistema — 31 regras de `:hover`, zero de
  pressionado.
- **Não há tema escuro.** Nenhuma consulta a `prefers-color-scheme`. É uma
  escolha, não uma falha, mas vale registrar como decisão explícita.

## Como verificar

O harness usado está descrito aqui porque a parte difícil não é medir contraste,
é **descobrir o fundo real**: superfícies translúcidas precisam ter suas camadas
compostas de trás para frente até a raiz. Procurar o primeiro ancestral "opaco o
bastante" erra — foi o que fez duas medições minhas darem resultados
contraditórios antes de a função ser corrigida.
