# SLATE — Impedimentos

Um **impedimento** é algo que trava um trabalho que de outra forma seria
executável. A distinção do mandato §28:

- **IMPEDE UMA FRENTE** — trava uma funcionalidade; todas as outras seguem.
- **TRAVA O PROJETO** — trava todo o trabalho executável. Exige escalada imediata.

O que depende do operador fica em
[OPERATOR_ACTIONS.md](./OPERATOR_ACTIONS.md); este arquivo registra impedimentos
técnicos descobertos durante a execução.

---

## Ativos

_Nenhum._

---

## Resolvidos

### IMPEDIMENTO-001 — Workflows do GitHub Actions não podiam ser commitados

- **Tipo:** IMPEDIA UMA FRENTE
- **Situação:** resolvido em 15/08/2026 pelo operador, via
  [AÇÃO-001](./OPERATOR_ACTIONS.md)
- **Causa:** o token do `gh` não tinha o escopo `workflow`
- **Lição, e é desconfortável:** enquanto isso esteve aberto, registrei aqui que
  os workflows já estavam escritos e só esperavam o escopo. **Não estavam.** Era
  um plano que virou afirmação de fato por repetição, e ficou de pé porque
  ninguém checava um contorno declarado — só o impedimento em si era observado.
  Contorno declarado precisa ser verificável, senão ele só empurra o trabalho
  para frente escondendo que foi empurrado.

### IMPEDIMENTO-002 — Publicações na Vercel presas em estado desconhecido

- **Tipo:** IMPEDE UMA FRENTE
- **Situação:** diagnosticado; a causa passou a ser
  [AÇÃO-003](./OPERATOR_ACTIONS.md) por depender do operador
- **Causa raiz:** o estado real das publicações era `BLOCKED`, com
  `seatBlock.blockCode = TEAM_ACCESS_REQUIRED` e `isVerified: false`. As CLIs
  58 e 59 da Vercel não conhecem o estado `BLOCKED` e o exibem como `UNKNOWN`,
  sem log e sem motivo — o que fez o diagnóstico pelo caminho normal (inspect,
  logs, promote) não levar a lugar nenhum. Só a resposta crua da API, via
  `vercel deploy --debug`, mostrou o código do bloqueio.
- **Lição:** quando uma ferramenta reporta um estado genérico e não oferece
  detalhe, vale ir à resposta crua da API antes de investir em hipóteses. Três
  hipóteses plausíveis (fila, CLI, build) foram testadas e descartadas antes
  disso, o que custou tempo que uma flag de debug teria evitado.
