# SLATE — Registro de Decisões

Índice cronológico das decisões tomadas de forma autônoma durante a execução,
conforme o mandato §50. As decisões arquiteturais de peso têm documento próprio
em [`docs/architecture/`](../architecture/); este arquivo é o índice e a casa
das decisões pequenas demais para virar um documento.

---

## 2026-08-15

### D-010 — PWA na Vercel, API no Railway — **decisão do operador**

A PWA é publicada na Vercel, ligada ao repositório, com versão nova a cada push
na `main`. A API continua no Railway, onde já roda junto do Postgres.

A divisão não é arbitrária. A PWA é conteúdo estático mais renderização, que é
exatamente o que a Vercel distribui bem; a API é um processo de vida longa com
conexão de banco, que é o que o Railway hospeda bem. E manter a API perto do
banco evita uma volta pela internet a cada consulta.

O que amarra os dois é o proxy: o navegador fala só com a Vercel, e ela repassa
`/api` para o Railway. Isso mantém o cookie de sessão como primeira parte —
sem isso, o WebKit não o devolveria, e a PWA não teria sessão no iPhone nem no
iPad ([ADR-0005](../architecture/ADR-0005-contas-e-sessoes.md)).

Consequência a lembrar: a API valida a origem por comparação exata, então
**trocar o domínio da PWA exige atualizar `ORIGENS_PERMITIDAS`**. Isso já custou
uma rodada — a API respondeu 403 até o domínio da Vercel entrar na lista. É o
comportamento correto, e não um incômodo a ser removido: uma verificação
tolerante aceitaria domínios que apenas se parecem com o certo.

### D-001 — Repositório único com workspaces do pnpm
→ [ADR-0001](../architecture/ADR-0001-arquitetura-do-sistema.md)

Três clientes consomem o mesmo pacote de protocolo. Divergência de contrato
entre repositórios é exatamente o modo de falha que este formato elimina.

### D-002 — WebRTC DataChannel como transporte principal
→ [ADR-0002](../architecture/ADR-0002-transporte.md)

**A decisão mais consequente até agora.** O desenho intuitivo — o Agente abre
um WebSocket na rede local e a PWA conecta — não é viável: conteúdo misto
bloqueia `ws://` numa página HTTPS, nenhuma autoridade certificadora emite
certificado para IP privado, e o Chrome 142 passou a exigir permissão para
acesso à rede local. O WebRTC é isento das regras de conteúdo misto e criptografa
via DTLS por construção.

### D-003 — Tauri em vez de Electron para o Agente Desktop
→ [ADR-0001](../architecture/ADR-0001-arquitetura-do-sistema.md)

Tamanho do instalador e memória residente dominam num agente que fica sempre
ligado. A cadeia Rust/MSVC foi verificada na máquina alvo antes da decisão ser
tomada.

### D-004 — Serviço de sinalização ainda não provisionado

O mandato §19 proíbe provisionar antes da necessidade. O Centro de Controle
precisa de Postgres e nada mais. A sinalização é provisionada quando a etapa de
pareamento começar, e nesse momento o suporte a WebSocket nas Funções da Vercel
será reavaliado contra o Railway por tempo de vida da conexão e custo, em vez de
assumido de antemão.

### D-005 — O estado do plano vive no Postgres, não no repositório

O mandato §23 exige progresso calculado, o §24 exige alteração por comando sem
edição manual da página, e o §25 exige atualização em tempo real. Um arquivo JSON
renderizado no build reprova nos três — exigiria uma nova publicação para
refletir uma mudança de status. Por isso o estado é relacional, com a CLI como
caminho de escrita e SSE como caminho de leitura.

### D-006 — Definições de CI fora de `.github/workflows/` — **revertida, e não cumprida**

A decisão original: como o escopo do token recusava push de workflow, as
definições ficariam versionadas em `docs/deployment/ci/` e seriam movidas
depois, para que "o trabalho estivesse feito e só a ativação esperasse".

**A decisão não foi executada.** Os arquivos nunca foram escritos, e a frase
"o trabalho está feito" foi repetida em três documentos e nas conversas com o
operador como se fosse fato. Quando o escopo foi liberado, não havia nada para
mover.

A esteira foi escrita nesse momento, direto em `.github/workflows/ci.yml`, e o
segredo do banco de homologação configurado autonomamente.

Fica registrada em vez de apagada porque a falha vale mais que a decisão: um
contorno que ninguém consegue verificar não é contorno, é adiamento disfarçado.
Contorno declarado agora precisa apontar para artefato que existe.

### D-007 — O Centro de Controle roda local, não hospedado — **decisão do operador**

O mandato (§14, §21) colocava o Centro de Controle na Vercel. O operador mudou
isso durante a execução, por dois motivos: uma página de acompanhamento que
precisa de uma publicação para refletir uma mudança de status derrota o próprio
propósito de ser ao vivo, e o Centro de Controle é um instrumento temporário que
deixa de existir quando o SLATE for lançado — hospedar é desperdício.

Passou a rodar localmente (`pnpm roadmap:ui`) contra o Postgres **na nuvem**, que
segue guardando o estado. Nada mudou no modelo de dados, no caminho de escrita
nem no cálculo de progresso; mudou apenas onde o processo de leitura roda. O
tempo real ficou estritamente melhor: sem o teto de tempo de função, o fluxo SSE
mantém uma conexão só em vez de se reiniciar a cada quatro minutos.

Isto não afrouxa o §14 para o produto. A PWA e seus serviços continuam na nuvem;
apenas esta ferramenta interna é local.

### D-008 — Publicações na Vercel bloqueadas por assento de time

Publicações do `slate-control-center` ficavam presas indefinidamente. A causa foi
identificada na resposta crua da API: `readyState: BLOCKED` com
`seatBlock.blockCode: TEAM_ACCESS_REQUIRED` e `isVerified: false`, e
`isInConcurrentBuildsQueue: false`. É bloqueio de assento no time, não fila de
build e não problema técnico — as CLIs 58 e 59 não conhecem o estado `BLOCKED` e
o exibem como `UNKNOWN`.

Registrado como [AÇÃO-003](./OPERATOR_ACTIONS.md). Não impede mais nada, já que a
D-007 eliminou a necessidade de hospedar esta aplicação — mas precisa ser
resolvido antes da PWA, e por isso segue em aberto em vez de encerrado.

### D-009 — Interface e documentação em português — **decisão do operador**

O produto é da Aionixdev e o operador trabalha em português. A interface do
Centro de Controle, o conteúdo do plano, as ações do operador e a documentação
são escritos em português.

Permanecem em inglês, por serem contrato de dados e não interface: as chaves dos
itens do plano (`P0-M1-T1`), os valores de status no banco (`COMPLETED`,
`IN_PROGRESS`), nomes de tabelas e colunas, e identificadores de código. Traduzir
esses quebraria integrações e migrações sem ganho de leitura para ninguém.
