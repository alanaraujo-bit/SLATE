# SLATE — Ações do Operador

Ações que dependem exclusivamente do operador (Alan / Aionixdev) e que não
podem ser feitas de forma autônoma. Conforme o mandato §28, nenhuma delas para
o projeto; cada uma registra exatamente o que impede.

Situações possíveis: `ABERTA` · `EM ANDAMENTO` · `RESOLVIDA` · `NÃO SERÁ FEITA`

---

## AÇÃO-001 — Liberar o escopo `workflow` no token do GitHub

**SITUAÇÃO:** ABERTA
**TRAVA O PROJETO:** NÃO
**IMPEDE:** apenas a esteira de integração contínua (GitHub Actions). Todo o
desenvolvimento, publicação e validação seguem normalmente.

### Por que

O token autenticado do `gh` tem os escopos `gist, read:org, repo`, mas não tem
`workflow`. O GitHub recusa qualquer push cujo diff toque `.github/workflows/**`
com a mensagem *refusing to allow an OAuth App to create or update workflow*.
Sem esse escopo, a automação de CI (mandato §17, §56) não pode ser enviada ao
repositório.

Isto é uma permissão de token — não é uma compra nem um contrato externo.

### O que fazer

1. No prompt do Claude Code, rode:

   ```
   ! gh auth refresh -h github.com -s workflow
   ```

2. Abre uma janela do navegador pedindo autorização no GitHub. Aprove.
3. Confirme com `gh auth status` — os escopos devem passar a incluir `workflow`.

### Como validar

```
gh auth status
```
Esperado: `Token scopes: 'gist', 'read:org', 'repo', 'workflow'`

### O que já foi feito

Nada depende de isso vir primeiro. As definições da esteira estão escritas e
versionadas em `docs/deployment/ci/` até o escopo ser liberado, quando então são
movidas para `.github/workflows/` num único commit.

### O que acontece depois

As esteiras (checagem de tipos, lint, testes unitários e ponta a ponta contra o
ambiente em execução) passam a rodar a cada push, e os critérios de qualidade do
plano começam a reportar resultados automáticos em vez de execuções manuais.

---

## AÇÃO-002 — Certificado de assinatura de código para o instalador Windows

**SITUAÇÃO:** ABERTA
**TRAVA O PROJETO:** NÃO
**IMPEDE:** apenas a distribuição confiável do instalador. O Agente compila,
instala e roda; o SmartScreen do Windows vai alertar na primeira execução até
haver assinatura.

### Por que

O mandato §8 exige um instalador real para Windows. A assinatura Authenticode
exige um certificado (OV ou EV) comprado de uma autoridade certificadora. É uma
compra comercial que exige validação da identidade da Aionixdev — não pode ser
feita de forma autônoma.

### O que fazer

1. Comprar um certificado de assinatura de código OV ou EV (por exemplo
   DigiCert, Sectigo, SSL.com) em nome da pessoa jurídica Aionixdev. O EV dá
   reputação imediata no SmartScreen; o OV constrói reputação com o tempo.
2. Concluir a validação da empresa junto à autoridade certificadora.
3. Guardar o certificado e a senha como secrets do repositório no GitHub:
   `WINDOWS_CERT_BASE64` e `WINDOWS_CERT_PASSWORD`.

### Como validar

Um instalador gerado mostra a Aionixdev como editor verificado nas propriedades,
e `signtool verify /pa slate-setup.exe` passa.

### O que já foi feito

Toda a esteira de build e empacotamento está escrita de forma que assinar seja
apenas um passo de configuração; enquanto isso, o build de release produz um
instalador sem assinatura.

### O que acontece depois

Os instaladores publicados passam a ser confiáveis, os alertas do SmartScreen
desaparecem, e a atualização automática consegue verificar assinaturas.

---

## AÇÃO-003 — Publicações na Vercel não saem da fila

**SITUAÇÃO:** ABERTA
**TRAVA O PROJETO:** NÃO
**IMPEDE:** nada hoje. O Centro de Controle roda localmente por decisão do
operador ([D-007](./DECISIONS.md)). Precisa ser resolvido antes da PWA do SLATE,
que é de fato hospedada na nuvem.

### Por que

No escopo `aionixdev` da Vercel, o projeto `slate-control-center` publicou com
sucesso exatamente uma vez (44s, `READY`). Toda publicação posterior foi criada
mas nunca começou a compilar:

- o status fica num valor que a CLI mostra como `UNKNOWN`, nunca `READY`
- não existe log de build — `vercel inspect --logs` não retorna nada
- `vercel promote` recusa com `422 … is not ready`

Descartados como causa:

| Hipótese | Teste | Resultado |
|---|---|---|
| Fila travada por um build preso | Removi as publicações paradas | Voltou na hora, com a fila vazia |
| CLI desatualizada reportando errado | Atualizei 58.9.0 → 59.0.0 | Igual |
| Build quebrado ou monorepo mal configurado | `vercel build` local | Funciona |
| Problema no código ou nas dependências | Mesmo commit compilado em Docker | Compila e roda |
| Ambiente remoto de build | `vercel deploy --prebuilt` | Também não sai da fila |

A última linha é decisiva: uma publicação pré-compilada não executa build remoto
nenhum, e mesmo assim trava igual. A falha está na aceitação da publicação, não
na compilação, e está acima do projeto — provavelmente um limite da conta, uma
retenção por cobrança, ou um incidente da plataforma.

### O que fazer

1. Abrir <https://vercel.com/aionixdev/slate-control-center> e ler o status de
   qualquer publicação mais nova que `pa0vyded8`. O painel mostra um motivo que
   a CLI não expõe.
2. Conferir na conta se há retenção por cobrança, limite de gasto atingido ou
   limite de builds simultâneos esgotado: <https://vercel.com/account/billing> e
   a página de uso do time.
3. Conferir <https://www.vercel-status.com> por incidente entre
   2026-08-15 01:00 e 02:00 (horário de Brasília).
4. Se nada disso explicar, acionar o suporte da Vercel com o id de publicação
   `dpl_96RDqKidmsE2fSK1ygzJmbbPSf2Q`, que foi criado e nunca compilou.

### Como validar

```
vercel deploy --prod --yes --scope aionixdev
```
Esperado: chegar em `● Ready` e o domínio servir a nova versão.

### O que já foi feito

O projeto existe e está corretamente configurado: diretório raiz
`apps/control-center`, framework `nextjs`, GitHub conectado e `DATABASE_URL`
definida para Produção e Preview. Existe também um `Dockerfile` validado, então
a aplicação pode ser hospedada em qualquer lugar com container caso a Vercel
continue travada.

### O que acontece depois

A hospedagem na nuvem volta a ficar disponível para a etapa da PWA. O Centro de
Controle não precisa dela e continua rodando localmente.

---
