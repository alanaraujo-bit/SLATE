# SLATE — Ações do Operador

## AÇÃO-007 — Criar a chave do relay TURN

**SITUAÇÃO:** ABERTA
**TRAVA O PROJETO:** SIM, apenas o fallback entre redes restritivas
**IMPEDE:** concluir `P1-M5-T4` e provar o caminho forçado por relay. O caminho
direto na mesma rede continua funcionando.

### Por que

O TURN precisa de infraestrutura pública com UDP, TCP e TLS. O Railway não
expõe UDP ao público, portanto hospedar `coturn` no projeto entregaria um
fallback parcial. A decisão D-011 adotou o Cloudflare Realtime TURN: a API já
gera credenciais temporárias e nunca expõe o token de emissão aos clientes.

### O que fazer

1. No painel Cloudflare, abrir **Realtime → TURN** e criar uma chave chamada
   `slate-production`.
2. Guardar no serviço `slate-api` do Railway:

   ```text
   CLOUDFLARE_TURN_KEY_ID=<identificador da chave>
   CLOUDFLARE_TURN_API_TOKEN=<token mostrado uma única vez>
   TURN_TTL_SEGUNDOS=21600
   ```

3. Se o domínio público da API mudar, definir no projeto `slate-pwa` da Vercel
   `URL_SINALIZACAO_PUBLICA=wss://<domínio>/sinalizacao` antes do build. A CSP
   autoriza somente essa origem exata.

### Como validar

Executar o teste de interoperabilidade com `iceTransportPolicy: "relay"` e
confirmar em `getStats()` que o par selecionado contém candidato `relay`. Não
basta o DataChannel abrir: o teste precisa registrar o tipo do candidato usado.

### O que já foi feito

A API valida a resposta do provedor, remove as rotas na porta 53 que navegadores
bloqueiam, renova antes da expiração e cai para STUN/caminho direto se o provedor
falhar. PWA e Agente aplicam a mesma lista ICE sem conhecer o segredo de emissão.

### O que acontece depois

O mesmo DataChannel passa a funcionar entre redes diferentes e sob NAT
simétrico, sem mudança de interface ou configuração pelo usuário.

---

Ações que dependem exclusivamente do operador (Alan / Aionixdev) e que não
podem ser feitas de forma autônoma. Conforme o mandato §28, nenhuma delas para
o projeto; cada uma registra exatamente o que impede.

Situações possíveis: `ABERTA` · `EM ANDAMENTO` · `RESOLVIDA` · `NÃO SERÁ FEITA`

---

## AÇÃO-001 — Liberar o escopo `workflow` no token do GitHub

**SITUAÇÃO:** ✅ RESOLVIDA em 15/08/2026
**TRAVA O PROJETO:** NÃO
**IMPEDIA:** apenas a esteira de integração contínua (GitHub Actions).

> **Correção de um registro falso.** Enquanto esta ação esteve aberta, este
> documento afirmou — e eu repeti ao operador — que as definições da esteira já
> estavam "escritas e versionadas em `docs/deployment/ci/`, esperando apenas o
> escopo". **Isso não era verdade: os arquivos não existiam.** Foi um plano que
> declarei e não executei, e que depois passei a repetir como fato consumado.
> A esteira foi escrita de fato no momento em que o escopo foi liberado, e está
> em `.github/workflows/ci.yml`. O registro fica aqui em vez de ser apagado,
> porque o mandato §57 proíbe esconder erro para o relatório ficar bonito.

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

### O que foi feito depois de resolvida

- `.github/workflows/ci.yml` escrito e enviado.
- Segredo `DATABASE_URL_STAGING` configurado no repositório apontando para o
  Postgres de homologação — feito autonomamente, sem depender do operador.
- Três etapas: tipos e testes unitários; testes de integração da CLI; testes
  ponta a ponta com o Centro de Controle no ar.

As etapas que precisam de banco se pulam sozinhas quando o segredo não existe,
em vez de falhar. Uma etapa que fica vermelha por falta de configuração treina
todo mundo a ignorar CI vermelho, que é pior do que não ter CI.

### Pendência conhecida

Não há verificação de lint na esteira, porque o projeto ainda não tem ESLint
configurado. Está registrado como trabalho real no plano, não como se já
estivesse pronto.

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

Os instaladores publicados passam a ser confiáveis e os alertas do SmartScreen
desaparecem. A assinatura criptográfica do atualizador é independente e já é
obrigatória; Authenticode identifica a Aionixdev para o Windows e para a pessoa.

---

## AÇÃO-008 — Token somente leitura para releases privadas do Agente

**SITUAÇÃO:** ✅ NÃO É MAIS NECESSÁRIA em 15/08/2026 — o repositório virou público
**TRAVA O PROJETO:** NÃO

> **Por que deixou de valer.** Esta ação existia porque assets de release de um
> repositório privado não são baixáveis anonimamente. Com o repositório público,
> o Agente lê `releases/latest/download/latest.json` direto do GitHub: sem token,
> sem desvio pela API, e uma peça a menos que pode falhar entre a release e o
> computador de quem usa.
>
> A rota `/atualizacoes/...` continua na API, com seus testes. Ela não é usada
> pelo Agente 0.1.3 em diante e volta a fazer sentido se o repositório algum dia
> for fechado de novo — por isso não foi apagada.
>
> O texto original fica abaixo.

### Por que

Assets de release de um repositório privado não são baixáveis anonimamente. O
Agente não pode carregar um token do GitHub, porque qualquer pessoa conseguiria
extraí-lo do executável. A API do SLATE consulta a release no servidor e devolve
ao Agente apenas uma URL temporária do pacote específico.

### O que fazer

1. Criar um fine-grained personal access token no GitHub restrito apenas ao
   repositório `alanaraujo-bit/SLATE`, com acesso de leitura a **Contents**.
2. Adicionar no serviço da API no Railway:
   `GITHUB_RELEASE_TOKEN=<token>`.
3. Manter `GITHUB_RELEASE_REPOSITORY=alanaraujo-bit/SLATE` e
   `URL_PUBLICA_API=https://slate.aionixdev.com/api` (os padrões atuais já são
   esses; explicitar é recomendado).
4. Fazer redeploy da API.

### Como validar

Após publicar uma release maior que a instalada:

```text
GET https://slate.aionixdev.com/api/atualizacoes/windows/x86_64/0.1.0
```

responde `200` com `version`, `url` e `signature`; abrir `url` responde com um
redirecionamento temporário para o pacote `-setup.exe`. Um ID de asset que não
pertence à release responde `404`, e nenhum token aparece em nenhuma resposta.

### O que acontece depois

A busca automática e o botão **Buscar atualização** passam a consumir as
releases reais sem expor a credencial do repositório.

---

## AÇÃO-009 — Guardar a chave de atualização no GitHub Actions

**SITUAÇÃO:** ✅ RESOLVIDA em 15/08/2026
**TRAVA O PROJETO:** NÃO

> Os dois segredos foram gravados com autorização do operador e a release
> **SLATE 0.1.3** saiu assinada: `latest.json`, `SLATE_0.1.3_x64-setup.exe` e o
> `.sig` correspondente. O download foi conferido sem autenticação nenhuma,
> que é o caminho que o Agente percorre.
>
> **Pendência que continua sendo só do operador:** a cópia de segurança cifrada
> de `updater.key` e da senha, fora deste computador. A partir desta release,
> perder a chave deixa toda instalação existente sem caminho de atualização —
> a recuperação seria reinstalar manualmente, máquina por máquina.

### Por que

O workflow precisa receber a chave privada e sua senha para assinar cada release.
Enviar esses segredos ao GitHub é uma operação sensível e exige autorização
explícita do operador. A chave privada nunca entra no repositório.

### O que fazer

Autorizar a gravação de `TAURI_SIGNING_PRIVATE_KEY` e
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` nos secrets do repositório. As fontes locais
estão protegidas para o usuário atual em:

```text
%LOCALAPPDATA%\Aionixdev\SLATE\release
```

Fazer também uma cópia de segurança cifrada. Depois que a primeira release sair,
perder a chave impede atualizar automaticamente instalações antigas.

### Como validar

`gh secret list --repo alanaraujo-bit/SLATE` mostra os dois nomes (nunca os
valores), e o workflow **Publicar Agente Desktop** produz o `.exe`, o `.sig` e o
`latest.json` sem erro de chave ausente.

### O que já foi feito

A chave forte foi gerada, a pública está embutida no Agente, os arquivos locais
têm ACL restrita e um teste prova que um único bit alterado invalida o pacote.

### O que acontece depois

Criar a tag `slate-vX.Y.Z` passa a publicar uma atualização verificável de ponta
a ponta.

---

## AÇÃO-006 — Dar acesso ao repositório para a aplicação da Vercel no GitHub

**SITUAÇÃO:** ABERTA
**TRAVA O PROJETO:** NÃO
**IMPEDE:** apenas o deploy automático. Publicar pela linha de comando funciona
normalmente, e é assim que as versões estão indo ao ar.

### Por que

Três pushes na `main` não geraram versão nova. A Vercel informa que o
repositório está conectado, mas o GitHub não tem nenhum webhook apontando para
ela.

Minha primeira hipótese foi falta de acesso ao repositório, por ele ser
privado. **Estava errada** — a instalação já está com *All repositories*.

A causa real aparece na tela de configuração da aplicação: há um aviso de
*"Vercel is requesting an update to its permissions"*, com um botão de revisão,
**aguardando aprovação**. Entre as permissões pedidas está escrita e leitura em
*repository hooks* — exatamente a que falta para criar o webhook de deploy. Com
a atualização pendente, a conexão aparece como feita do lado da Vercel e mesmo
assim nenhum evento de push chega até lá.

### Causa encontrada — e um diagnóstico meu que estava errado

**O deploy automático sempre funcionou.** Cada push gerou uma publicação. Só que
todas ficavam com estado `Blocked`, e o comando `vercel ls` **não lista
publicações bloqueadas** — ele mostrava apenas a última publicação manual, e eu
concluí que nada estava disparando.

Passei um bom tempo investigando webhook, permissões e reconexão por causa de
uma lista incompleta que tratei como se fosse a realidade. O painel mostrava o
contrário desde o começo. A lição é a mesma que já apareceu antes neste
projeto: quando uma ferramenta responde "não há nada", vale confirmar se ela
mostra tudo antes de acreditar.

**A causa real:** os commits estavam assinados com um email que não pertence à
conta do GitHub do operador. A Vercel identifica o autor de um commit pelo
email e recusa publicar em nome de quem não é membro do time — é uma proteção
contra alguém com acesso ao repositório publicar em produção.

Publicação manual passava porque é autenticada como o usuário da linha de
comando; publicação automática é atribuída ao autor do commit, que era um
endereço desconhecido.

O email do autor foi corrigido para o endereço `noreply` do GitHub, sempre
reconhecido como pertencente à conta e sem expor endereço pessoal.

### O que fazer, se ainda ficar bloqueado

Se mesmo com o autor correto a publicação continuar `Blocked`, a conta do
GitHub precisa estar vinculada ao perfil da Vercel:

1. Abra <https://vercel.com/account/login-connections>
2. Confirme que **GitHub** aparece conectado à conta `alanaraujo-bit`
3. Publicações bloqueadas podem ser liberadas uma a uma pelo painel, em
   <https://vercel.com/aionixdev/slate-pwa/deployments>

### Como validar

Qualquer push na `main` passa a aparecer como versão nova em
<https://vercel.com/aionixdev/slate-pwa>.

### O que já foi feito

O projeto está criado e configurado — diretório raiz `apps/pwa`, framework
Next.js, variável `API_URL` apontando para a API, e domínio
`slate.aionixdev.com` respondendo. A publicação manual funciona, então nenhuma
entrega depende disto.

---

## AÇÃO-005 — Subdomínios para a PWA e para a API

**SITUAÇÃO:** ✅ NÃO É MAIS NECESSÁRIA — a arquitetura mudou
**TRAVA O PROJETO:** NÃO

> **Por que deixou de valer.** Esta ação existia para que PWA e API ficassem no
> mesmo domínio registrável, já que um cookie `SameSite=Lax` não atravessa
> entre sites diferentes.
>
> O proxy resolveu isso de forma mais completa: o navegador fala **só** com a
> PWA, que repassa `/api` para a API. Origem única é ainda melhor que mesmo
> site — o cookie é de primeira parte, e nenhum navegador tem restrição a isso.
> A PWA está na Vercel e a API no Railway, domínios completamente diferentes, e
> a sessão funciona.
>
> O que sobrou como consequência prática é outra coisa, e está registrada no
> guia de teste: **trocar o domínio da PWA exige atualizar `ORIGENS_PERMITIDAS`
> na API**, porque a verificação de origem é por comparação exata.
>
> O texto original fica abaixo, porque a análise que levou até aqui continua
> correta — e é ela que explica por que o proxy não é só conveniência.

### Por que

A sessão usa cookie `HttpOnly` com `SameSite=Lax`, que é a configuração mais
segura disponível. Ela tem um preço: **o cookie não acompanha requisições entre
sites diferentes**, e "site" é o domínio registrável — a porta não conta.

| PWA | API | Mesmo site? | Sessão funciona? |
|---|---|---|---|
| `localhost:4400` | `localhost:4500` | sim | sim |
| `slate.aionixdev.com` | `api.aionixdev.com` | sim | sim |
| `slate.vercel.app` | `slate.up.railway.app` | **não** | **não** |

A terceira linha é o que aconteceria usando os domínios que as plataformas dão
de graça: o login pareceria funcionar e a sessão sumiria na requisição
seguinte. Em desenvolvimento isso nunca apareceria, porque duas portas de
`localhost` já são o mesmo site.

### O que fazer

Apontar dois subdomínios de `aionixdev.com`:

1. `api.slate.aionixdev.com` → serviço da API no Railway (o painel do Railway
   mostra o CNAME ao adicionar o domínio).
2. `slate.aionixdev.com` → a PWA, onde ela for hospedada.

Depois, definir no serviço da API:

```
ORIGENS_PERMITIDAS=https://slate.aionixdev.com
DOMINIO_COOKIE=.aionixdev.com
```

### Como validar

Entrar pela PWA publicada e recarregar a página. Se continuar conectado, o
cookie está atravessando. Se cair para a tela de entrada, os domínios não estão
no mesmo site.

### O que já foi feito

Toda a configuração é lida de variáveis de ambiente e validada na partida — o
serviço se recusa a subir em produção sem `ORIGENS_PERMITIDAS`, em vez de
aceitar qualquer origem em silêncio. A verificação de origem em requisições que
alteram estado já está implementada e não depende do comportamento do cookie.

### O que acontece depois

A PWA passa a manter a sessão em produção, e o pareamento pode ser concluído
fora do ambiente de desenvolvimento.

---

## AÇÃO-004 — Provedor de envio de e-mail

**SITUAÇÃO:** ABERTA
**TRAVA O PROJETO:** NÃO
**IMPEDE:** recuperação de senha e verificação de e-mail. Cadastro e entrada
funcionam normalmente.

### Por que

Recuperar uma conta exige mandar um e-mail, e mandar e-mail exige credencial de
um provedor — que é uma contratação, ainda que em plano gratuito.

Isso importa mais do que parece: **sem recuperação, esquecer a senha custa todos
os dispositivos pareados e todos os painéis da pessoa.** Por isso a decisão foi
tomada e declarada agora ([ADR-0005](../architecture/ADR-0005-contas-e-sessoes.md)),
e não descoberta depois pelo primeiro usuário que esquecer a senha.

### O que fazer

1. Criar conta num provedor de e-mail transacional — Resend, Postmark ou Amazon
   SES resolvem. Todos têm plano gratuito suficiente para começar.
2. Verificar o domínio `aionixdev.com` no provedor, para que a mensagem não caia
   em spam.
3. Guardar a chave como variável no serviço da API no Railway:

   ```
   EMAIL_API_KEY=...
   EMAIL_REMETENTE=slate@aionixdev.com
   ```

### Como validar

Pedir recuperação de senha e receber o e-mail na caixa de entrada — não no spam.

### O que já foi feito

O fluxo inteiro está implementado: token de uso único, expiração curta e
invalidação de todas as sessões ao trocar a senha. O envio está atrás de uma
interface cuja implementação atual **registra em log em vez de enviar**, e que
se recusa a rodar em produção — para que a ausência do provedor seja um erro
visível e não um e-mail que some em silêncio.

A tela de cadastro avisa, no momento do cadastro, que a recuperação por e-mail
ainda não está ativa.

### O que acontece depois

Trocar a implementação de log pela do provedor, e remover o aviso da tela de
cadastro.

---

## AÇÃO-003 — Publicações na Vercel não saíam da fila

**SITUAÇÃO:** ✅ RESOLVIDA em 15/08/2026 — voltou a funcionar sozinha
**TRAVA O PROJETO:** NÃO

> **Como foi resolvida:** não foi por nenhuma ação de código. Ao criar o projeto
> `slate-pwa`, o deploy compilou e chegou a `READY` normalmente. O bloqueio era
> mesmo do lado da conta ou da plataforma, exatamente como o diagnóstico
> apontava — e deixou de valer sem que nada no repositório mudasse.
>
> Vale registrar o que isso confirma: o tempo gasto tentando contornar pelo
> lado do código teria sido perdido de qualquer forma. Foi a leitura da
> resposta crua da API, e não mais tentativas, que separou "problema meu" de
> "problema deles".

A PWA está publicada na Vercel, com deploy automático a cada push na `main`.

### Por que — causa identificada

No escopo `aionixdev` da Vercel, o projeto `slate-control-center` publicou com
sucesso exatamente uma vez (44s, `READY`). Toda publicação posterior foi criada
mas nunca começou a compilar. A CLI mostrava o status como `UNKNOWN` e não
retornava log nenhum, o que escondia o motivo.

Rodando `vercel deploy --debug`, a resposta crua da API entrega a causa:

```json
"readyState": "BLOCKED",
"status": "BLOCKED",
"seatBlock": { "blockCode": "TEAM_ACCESS_REQUIRED", "isVerified": false },
"isInConcurrentBuildsQueue": false,
"isInSystemBuildsQueue": false
```

Ou seja:

- o estado real é **`BLOCKED`** — a CLI (58 e 59) não conhece esse valor e o
  exibe como `UNKNOWN`, que é por que o diagnóstico normal não levava a lugar
  nenhum;
- o motivo é **`TEAM_ACCESS_REQUIRED`** com **`isVerified: false`** — é um
  bloqueio de assento no time `aionixdev`, não um problema técnico;
- `isInConcurrentBuildsQueue: false` confirma que **nunca foi fila de build**.

Isso encerra a investigação: nada no repositório, no build ou na configuração do
projeto causa ou resolve isso. O que foi verificado pelo caminho e continua
válido como garantia de que o lado do código está sadio:

| Hipótese | Teste | Resultado |
|---|---|---|
| Fila travada por um build preso | Removi as publicações paradas | Voltou na hora, com a fila vazia |
| CLI desatualizada reportando errado | Atualizei 58.9.0 → 59.0.0 | Igual (mas `--debug` revelou o estado real) |
| Build quebrado ou monorepo mal configurado | `vercel build` local | Funciona |
| Problema no código ou nas dependências | Mesmo commit compilado em Docker | Compila e roda |
| Ambiente remoto de build | `vercel deploy --prebuilt` | Também bloqueado |

### O que fazer

1. Abrir <https://vercel.com/teams/aionixdev/settings/members> e conferir o
   assento da conta `alanarauj0` no time `aionixdev`. O código
   `TEAM_ACCESS_REQUIRED` indica assento ausente, não confirmado ou pendente de
   aprovação.
2. Conferir se há convite pendente de aceite ou verificação de e-mail em aberto
   — `isVerified: false` aponta para isso.
3. Conferir cobrança do time em
   <https://vercel.com/teams/aionixdev/settings/billing>: em times pagos por
   assento, um pagamento pendente bloqueia assentos e, por consequência,
   publicações.
4. Se o assento estiver correto e verificado, acionar o suporte da Vercel
   citando `blockCode: TEAM_ACCESS_REQUIRED` e o id de publicação
   `dpl_96RDqKidmsE2fSK1ygzJmbbPSf2Q`.

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
