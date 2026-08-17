# SLATE — ponto de partida para quem continua

Escrito em 15/08/2026, no fim da primeira fase de construção, para quem for
assumir o projeto a partir daqui. Atualizado no mesmo dia após a implementação
do transporte e da base de distribuição do Agente.

Não é um resumo do que foi feito — o histórico do Git já conta isso. É o que
não está óbvio no código e que custaria tempo redescobrir.

---

> **Retomando o trabalho?** Leia antes o [RETOMAR.md](./RETOMAR.md): ele conta
> o estado do momento — o que está pela metade, o que já custou tempo e o que o
> operador ainda espera receber.

---

## 1. O que existe e funciona

| Peça | Onde | Situação |
|---|---|---|
| **PWA** | <https://slate.aionixdev.com> (Vercel) | Instalável, offline, conta, pareamento e primeiro controle real |
| **API** | Railway, serviço `slate-api` | Contas, sessões, pareamento, sinalização WSS e relay privado de releases |
| **Postgres** | Railway, dois ambientes | `production` e `staging` |
| **Agente Desktop** | `apps/desktop` | Pareia, abre WebRTC, executa mídia, inicia com o Windows e busca atualizações assinadas |
| **Painel do projeto** | `pnpm roadmap:ui` → localhost:4300 | Progresso calculado, em tempo real |

**O ciclo de pareamento fecha de ponta a ponta.** Celular pede → mostra código →
Agente confirma → dispositivo aparece nos dois lados.

Na última verificação local completa passaram **342 testes JavaScript/TypeScript**
e **16 testes Rust**. A execução separada da API contra o Postgres real de
staging passou **137 de 137 testes**. As suítes que dependem do banco continuam
se pulando quando `DATABASE_URL` não existe; não confunda uma execução local sem
banco com a validação de integração e ponta a ponta.

## 2. O que **não** existe

- **Motor de Ações completo.** O primeiro corte vertical existe: a PWA envia
  `midia.reproduzir-pausar`, o Agente valida registro, timestamp, sequência,
  repetição e escopos, executa `VK_MEDIA_PLAY_PAUSE` no Windows e devolve o
  resultado. Sequências, condições, atrasos, variáveis e as demais ações ainda
  não existem.
- **Grade configurável de controles.** A grade existe e é fixa: mídia (pausar,
  faixa, parar), volume e seis atalhos de abertura. **Editor de decks não
  existe** — a lista de teclas está no código, em `apps/pwa/lib/controles.ts` e
  em `apps/desktop/src-tauri/src/acoes.rs`, e acrescentar uma tecla é editar os
  dois lados e publicar. Nada aparece na tela sem funcionar do outro lado: cada
  grupo é liberado por capacidade negociada no handshake.
Estas duas descrições ficaram para trás e valem uma correção: a grade **é**
configurável desde 17/08 — painéis com nome, cor, colunas, páginas e troca
automática por programa em foco, montados na janela do Agente. A lista fixa
em `controles.ts` e `acoes.rs` continua existindo como catálogo do que pode ser
colocado num painel, e é ela que segue exigindo os dois lados.

A **publicação automática do Agente** também já funciona: marcar uma tag
`slate-v*` gera instalador, assinatura e `latest.json`. A primeira release saiu
na 0.1.3 e a mais recente é a **0.1.7**.

## 3. Decisões que parecem erradas até você saber por quê

Estas são as que um olhar novo tende a "corrigir" — e que voltariam a quebrar o
que já funciona.

### A API é servida em `/api` na mesma origem da PWA, via proxy

Parece indireção desnecessária. Não é.

O cookie de sessão é `HttpOnly` com `SameSite=Lax`. Apontando a PWA para outra
origem, **o WebKit não devolve o cookie** — e WebKit é o motor de todo navegador
no iPhone e no iPad. O sintoma é cruel: o login responde sucesso e a sessão
some na requisição seguinte.

Com origem única o cookie é de primeira parte, e nenhum navegador restringe
isso. Detalhes em [ADR-0005](./architecture/ADR-0005-contas-e-sessoes.md).

### A verificação de origem é comparação exata, sem curinga

Trocar o domínio da PWA **exige** atualizar `ORIGENS_PERMITIDAS` no serviço
`slate-api`. Já custou duas rodadas de 403.

Isso é proposital: uma verificação por sufixo aceitaria
`slate.aionixdev.com.site-malicioso.com`. Não relaxe isso.

### O código de pareamento vai do celular para o computador, nunca o contrário

Essa direção é o que separa "invadiram minha conta" de "invadiram meu
computador". Entrar na conta prova conhecimento da senha; digitar o código **no
PC** prova presença física diante dele.

O Agente é a exceção — registra-se sem código — porque estar rodando ali já é a
prova que o código existiria para suprir.

### Não usamos biblioteca de autenticação

O SLATE tem dois clientes e só um é navegador. O Agente Rust autentica por
chave, e esse caminho existe de qualquer forma. Uma biblioteca web resolveria
metade e deixaria dois sistemas de sessão sem relação entre si.

Nenhuma primitiva é inventada: `scrypt`, `timingSafeEqual` e `randomBytes` vêm
do Node. A sessão é opaca — um valor aleatório cujo hash fica no banco.

### O Painel do projeto roda local, não hospedado

Decisão do operador. Uma página de acompanhamento que exige publicação para
refletir uma mudança derrota o próprio propósito, e a ferramenta é temporária.
O banco continua na nuvem.

### Abrir programa é permissão local, e não existe rota de API para ela

Parece lacuna. É a decisão.

O pareamento concede `ESCOPOS_PADRAO`, que tem `system.media` e **não** tem
`system.process`. Para o celular abrir YouTube, Twitch e afins, alguém marca a
caixa na janela do Agente, naquele computador. Não há `PATCH /dispositivos/:id`
e não deve haver: o ADR-0004 diz que um dispositivo jamais amplia os próprios
poderes, e uma rota de conceder escopo pela conta é exatamente isso com outro
nome. A conta pode **revogar** um aparelho; conceder poder novo, nunca.

Três consequências que não são óbvias:

- **A concessão mora em `pares.rs`, não no banco.** `acoes.rs` verifica
  `par.escopos`, que vem da raiz de confiança local — a coluna `escopos` da API
  nunca é consultada na execução. Guardar no servidor criaria uma segunda fonte
  de verdade que ninguém lê.
- **Ela fica em `escoposLocais`, campo separado de `escopos`.** `guardar_confirmado`
  reconstrói o par a partir do `Dispositivo` da nuvem: somados num campo só, a
  permissão seria apagada na reconfirmação seguinte, e o sintoma — funciona
  agora, some depois — é dos caros. O teste
  `a_concessao_local_sobrevive_a_reconfirmacao_do_pareamento` tranca isso.
- **A capacidade `action.atalhos` é anunciada por par**, no hello, e só a quem
  tem a concessão. É assim que o painel do celular ganha e perde os atalhos sem
  consultar a conta. Dois celulares no mesmo computador recebem helos diferentes.

Ponta solta conhecida: a lista de aparelhos na PWA mostra os escopos do
servidor, que subestimam o que o aparelho faz de fato. É inconsistência de
exibição, não de segurança. A correção é o Agente **reportar** as concessões
para cima — nunca o servidor concedê-las para baixo.

### O algoritmo de assinatura é negociado, não fixo

Ed25519 é preferido, ECDSA P-256 é alternativa. Ed25519 só chegou a todos os
motores entre 2024 e 2025 e alcançava ~79% dos usuários — fixá-lo excluiria
gente real.

O suporte é testado **gerando uma chave**, não consultando lista de navegadores.

## 4. Armadilhas que já custaram tempo

Cada uma destas foi descoberta do jeito difícil.

| Armadilha | Sintoma | O que fazer |
|---|---|---|
| Cookie `Secure` em `http://localhost` | Login funciona no Chrome, falha no Safari | Em desenvolvimento o padrão é **sem** `Secure`; ver `services/api/src/config.ts` |
| Rewrites do Next resolvem **no build** | `/api` responde 404 com a API no ar | `API_URL` precisa existir no build; ver `apps/pwa/Dockerfile` |
| Rede privada do Railway é **IPv6** | Proxy responde 500 com a API saudável | O servidor escuta em `::`; ver `services/api/src/main.ts` |
| `pnpm` não achata dependências | `ERR_MODULE_NOT_FOUND` em produção | Copiar `node_modules` de **cada** pacote no Dockerfile |
| Service worker com versão fixa | Aplicação abre versão antiga offline | `sw.js` é gerado no build; ver `apps/pwa/scripts/gerar-sw.mjs` |
| Email do autor do commit | Deploy fica `Blocked` na Vercel | Usar o endereço `noreply` do GitHub |
| `vercel ls` esconde deploys `Blocked` | "Nenhum deploy disparou" quando disparou | Conferir no painel, não só na CLI |
| `cookie_store(true)` do reqwest é **só memória** | Agente pede e-mail e senha a cada abertura, com cookie de 30 dias válido | `cookie_provider` com armazenamento gravado em disco; ver `apps/desktop/src-tauri/src/api.rs` |
| Cache do GitHub Actions é **isolado por tag** | Cache do CI não acelera a publicação, e uma release nunca aproveita a anterior | O `main` grava, a tag só lê; `shared-key` igual nos dois workflows |

### Duas lições que se repetiram

**Ferramenta que responde "não há nada" pode estar mostrando uma lista
incompleta.** Aconteceu com `vercel ls`. Custou uma investigação inteira na
direção errada.

**Teste verde não prova que testou.** Um teste de reconexão usava
`route.abort()`, que não derruba conexão SSE já aberta — passava sem exercitar
nada. Pior que teste ausente, porque dá confiança.

## 5. Como rodar

```bash
pnpm install

# Painel do projeto — localhost:4300
pnpm roadmap:ui

# API — localhost:4500
cd services/api
DATABASE_URL="<postgres>" PORT=4500 pnpm exec tsx src/main.ts

# PWA — localhost:4400
cd apps/pwa
API_URL=http://localhost:4500 pnpm run build && pnpm exec next start -p 4400

# Agente
cd apps/desktop/src-tauri
SLATE_API_URL=http://localhost:4500 cargo tauri dev
```

Testes:

```bash
pnpm -r test                                    # unitários
cd apps/desktop/src-tauri && cargo test         # Rust
cd apps/pwa && pnpm test:e2e                    # ponta a ponta
E2E_BASE_URL=https://slate.aionixdev.com pnpm test:e2e   # contra produção
```

> Rode contra produção de vez em quando. Cookie `Secure` e política de
> segurança só se comportam de verdade sob HTTPS.

## 6. Transporte em tempo real — implementação em validação

É o que destrava tudo o mais. A sinalização WSS na API, os pares WebRTC na PWA e
no Agente e a ligação à máquina de estados já estão implementados no worktree.
Os gates de relay TURN real, reconexão prolongada e validação ponta a ponta
continuam pendentes; não conclua P1-M5 antes dessas provas.

### A decisão já tomada, e por quê

**WebRTC DataChannel**, com sinalização na nuvem e alternativa por
retransmissão. O desenho intuitivo — Agente abre um WebSocket na rede local —
**não funciona**, por três motivos independentes:

1. Página HTTPS não abre `ws://` (conteúdo misto).
2. Nenhuma autoridade certificadora emite certificado para IP privado.
3. O Chrome 142 passou a exigir permissão para acesso à rede local.

Detalhes em [ADR-0002](./architecture/ADR-0002-transporte.md). **Leia antes de
começar.**

### O que sustenta a implementação

- `packages/protocol` — envelope, versionamento, negociação de capacidades,
  28 testes cobrindo duplicidade, timestamp, reconexão e versão incompatível.
- `packages/identidade` — chaves, assinatura, verificação.
- O modelo de segurança em [ADR-0004](./architecture/ADR-0004-seguranca.md),
  incluindo a vinculação do fingerprint DTLS que impede a sinalização de
  interceptar a conexão.

### Onde a sinalização deve morar

Em `services/api`, o serviço que já existe. O [ADR-0001](./architecture/ADR-0001-arquitetura-do-sistema.md)
prevê isso explicitamente — não crie um serviço novo.

### Ordem usada

1. Sinalização (WSS) em `services/api`, autenticada por chave de dispositivo.
2. Par WebRTC no navegador, dentro da PWA.
3. Par WebRTC no Agente, em Rust com `webrtc-rs`.
4. Máquina de estados de conexão, ligada aos estados que a PWA já sabe exibir
   (`apps/pwa/lib/estados-conexao.ts` — todos os oito já têm mensagem e teste).
5. Primeiro corte do Motor de Ações e controle de reproduzir/pausar, concluído.

O Agente `0.1.2` acrescentou pareamento por QR descartável sem remover o código
de seis dígitos. A PWA consulta a presença WSS, escolhe a identidade confiável
que está realmente online e separa instalações antigas de computadores com o
mesmo nome; nunca revoga automaticamente apenas pelo nome.

## 7. Distribuição e atualização do Agente

O NSIS usa imagens próprias do SLATE, textos completos em português e instalação
por usuário. `pnpm --filter @slate/desktop instalador` lê a chave Minisign fora
do repositório, gera o `.exe` e sua assinatura `.exe.sig` e se recusa a produzir
uma release sem chave.

O Agente busca atualização oito segundos após abrir e a cada seis horas. A busca
automática é silenciosa quando a rede falha; a busca manual sempre responde. A
pessoa vê versão, notas, bytes baixados e pode adiar. A instalação é passiva e só
começa depois da confirmação explícita.

O instalador oficial não é mais gerado à mão: ele sai da tag. A versão corrente
é a **0.1.7**, publicada com `.exe`, `.exe.sig` e `latest.json` em
<https://github.com/alanaraujo-bit/SLATE/releases>. O `pnpm instalador` continua
existindo para gerar um `.exe` local sem publicar nada.

O relay privado de releases existe em `services/api/src/atualizacoes.ts`: a API
consulta a release com um token servidor-servidor, valida o manifesto e entrega
um redirecionamento temporário apenas para o artefato daquela release. Ele foi
escrito para um repositório privado. **O repositório é público hoje, e o
`tauri.conf.json` aponta o atualizador direto para o GitHub** — um salto a menos
e nenhuma dependência do Railway na hora de atualizar. Se o repositório voltar a
ser privado, o atualizador para de funcionar até o endpoint voltar para a API.

Perder a chave privada de atualização impede publicar versões aceitas pelos
Agentes já instalados: mantenha um backup cifrado antes da primeira release.

### Quanto tempo a publicação leva, e por quê

A busca em si é rápida — o `latest.json` responde em menos de um segundo. O que
se sentia como "o Agente não acha a atualização" era a publicação ainda não
existir: o workflow levava treze minutos e meio, recompilando webrtc, tauri e o
resto do mundo duas vezes, uma em `debug` para os testes e outra em `release`
para o instalador.

Duas mudanças atacam isso, e a segunda depende de entender a primeira:

1. **`Swatinem/rust-cache` nos dois workflows.** Cache do GitHub Actions é
   isolado por ref, e uma tag não enxerga o cache de outra tag — só o do branch
   padrão. Por isso quem **grava** é o job `agente` do CI, no `main`, e a
   publicação só **lê** (`save-if: false`), com o mesmo `shared-key`. O CI
   também faz um `cargo build --release` só para aquecer: `debug` e `release`
   são artefatos diferentes, e um cache só de `debug` não encurtaria nada
   justamente no passo em que alguém está esperando.
2. **`lto = "thin"` no perfil de release.** O LTO gordo religa o programa
   inteiro num passo final que nenhum cache alcança — rodava por completo em
   toda publicação, mesmo sem uma linha de Rust ter mudado.

**A primeira publicação depois dessas mudanças ainda vai demorar o tempo
antigo**, porque o cache nasce vazio. Empurre para o `main` e espere o CI
terminar antes de marcar a tag: é o que garante que a publicação encontre cache
para ler.

### A sessão do Agente sobrevive ao fechamento

O `cookie_store(true)` do reqwest guarda cookies só em memória. O cookie de
sessão vale trinta dias e nenhum deles sobrevivia ao fechamento do processo —
um Agente que inicia com o Windows pedia e-mail e senha a cada reinício.

Agora o armazenamento é gravado em `sessao.bin`, na mesma pasta e sob o mesmo
DPAPI da chave privada: o cookie é credencial ao portador, tão útil a quem o
roube quanto a senha. Sair apaga o arquivo, e não só a memória. Um arquivo
ilegível — corrompido, ou protegido por outra conta do Windows — vale o mesmo
que não ter sessão: pede login, não impede o Agente de abrir.

## 8. Pendências do operador

Nenhuma bloqueia o desenvolvimento. Detalhes em
[OPERATOR_ACTIONS.md](./operator/OPERATOR_ACTIONS.md).

| | O que impede |
|---|---|
| **AÇÃO-002** Certificado de assinatura | SmartScreen avisa ao instalar o Agente |
| **AÇÃO-004** Provedor de e-mail | Recuperação de senha; a tela de cadastro avisa |
| **AÇÃO-007** Credenciais TURN | Prova real do caminho relay do WebRTC |

Duas saíram da lista:

- **AÇÃO-009** (secrets da chave de atualização) está feita — `TAURI_SIGNING_
  PRIVATE_KEY` e sua senha existem no repositório, e as releases saem assinadas
  desde a 0.1.3.
- **AÇÃO-008** (token de leitura de releases no Railway) deixou de ser
  necessária quando o repositório passou a ser público: o `tauri.conf.json`
  aponta o atualizador direto para o GitHub, sem passar pela API. Ela volta a
  ser necessária **se o repositório voltar a ser privado** — ver §7.

## 9. Como manter o plano honesto

O progresso é **calculado**, nunca escrito. A CLI se recusa a concluir um item
com critério pendente ou filho inacabado — e essa recusa é o mecanismo, não um
obstáculo.

```bash
pnpm roadmap report
pnpm roadmap start P1-M5-T1
pnpm roadmap gate P1-M5-T1 <critério> --pass --evidence "..."
pnpm roadmap complete P1-M5-T1
```

Se um item não tem critérios definidos, adicione-os em
`packages/db/src/roadmap-data.ts` e recarregue com `pnpm --filter @slate/db exec
tsx src/seed.ts`. A recarga é aditiva: atualiza títulos e descrições, nunca
rebobina um status já avançado.

**Não afrouxe os critérios para o número subir.** O valor do painel é ele ser
verdadeiro; um número inflado custa mais do que um número baixo.

---

## Estado em números

| | |
|---|---|
| Progresso calculado | **20,1%** |
| Tarefas concluídas | 31 de 120 |
| Verificação local mais recente | 342 testes JS/TS + 16 Rust |
| Integração da API em staging | 137 de 137 testes |
| Fase 0 | 100% |
| Fase 1 (Plataforma) | Design System e Protocolo concluídos |
