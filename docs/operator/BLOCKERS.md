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

### IMPEDIMENTO-001 — Workflows do GitHub Actions não podem ser commitados

- **Tipo:** IMPEDE UMA FRENTE
- **Impede:** a automação de CI/CD
- **Não impede:** código da aplicação, publicações, validação, testes
- **Causa:** o token do `gh` não tem o escopo `workflow`
- **Responsável:** operador — ver [AÇÃO-001](./OPERATOR_ACTIONS.md#ação-001--liberar-o-escopo-workflow-no-token-do-github)
- **Contorno em vigor:** as definições dos workflows estão escritas e
  versionadas em `docs/deployment/ci/`, e são movidas para `.github/workflows/`
  assim que o escopo for liberado. Nenhum trabalho é perdido nem adiado — só a
  ativação espera.

---

## Resolvidos

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
