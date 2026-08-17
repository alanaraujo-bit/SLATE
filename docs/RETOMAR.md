# Onde paramos — 17/08/2026

> **Adendo da sessão de Energia Remota — publicado em 17/08.** PWA em produção e
> **Agente 0.1.8** assinado no ar, com `.exe`, `.sig` e `latest.json` anunciando
> a versão. A disciplina do cache foi respeitada: push, CI inteiro verde
> (`32074976732`, cinco jobs, e é ele quem grava o cache `agente-windows`), e só
> então a tag. A publicação saiu em ~6 min.
>
> O marco `P3-M5` foi aberto no plano com
> 13 tarefas. **Desligar funciona ponta a ponta; acordar não existe ainda.** O
> que decide tudo está no [ADR-0006](./architecture/ADR-0006-energia-remota.md):
> um navegador não emite quadro de broadcast, então acordar exige um Agente vivo
> dentro da rede do alvo — e estar na mesma rede **não** ajuda a PWA. Para o
> navegador, "em casa" e "no 4G" são igualmente impossíveis.
>
> Pronto: perfil de capacidades lido de verdade do Windows (conferido contra
> `powercfg` nesta máquina), as seis ações no registro fechado, escopos
> `system.power` e `system.wake` separados e fora do pareamento, `energia.estado`
> viajando até o celular, e a grade de energia na PWA com segurar-para-confirmar.
>
> Falta: a ponte que emite o pacote (`P3-M5-T7`), o último estado conhecido na
> nuvem (`T6`), a máquina de estados do acordar na tela (`T8`), auditoria (`T4`)
> e o diagnóstico no Agente (`T9`). `Execucao::AcordarAlvo` hoje responde
> "acordar outro computador ainda não está disponível" — de propósito, para não
> responder que deu certo sem ter emitido pacote nenhum.
>
> **A armadilha de sempre apareceu de novo**, e vale ler: a grade de energia
> estava só no caminho da grade clássica, e `ControlesBasicos` retorna cedo
> quando há perfis. Ou seja, quem tem o Agente novo não veria energia nenhuma.
> Build verde, testes verdes, recurso invisível. O que achou foi renderizar as
> duas telas e olhar — e a mesma rodada achou mais três defeitos visuais.

Escrito no fim de uma sessão longa, para quem continuar amanhã ou numa conversa
nova. O [CONTINUACAO.md](./CONTINUACAO.md) explica o projeto; **este arquivo
explica o momento**: o que acabou de mudar, o que está pela metade e o que já
custou tempo hoje.

---

## 1. O que está funcionando agora

Testado e em produção, salvo onde indicado.

| | Estado |
|---|---|
| Login do Agente persiste entre aberturas | ✅ |
| Publicação de release: 13m34s → **5m48s** | ✅ |
| Testar sem publicar release (`tauri dev`, 26s) | ✅ |
| Mídia completa (faixa, parada, volume, mudo) | ✅ |
| Painel em modo deitado | ✅ |
| Atalhos de site (YouTube, Twitch, Netflix, Prime, Disney+, Spotify) | ✅ |
| Pareamento sem beco sem saída | ✅ |
| QR lendo no iPhone | ✅ |
| Toque repetido sem espera | ✅ |
| Telas separadas (Painel / Ajustes) + visual novo | ✅ no ar, **sem retorno do operador ainda** |
| Atalhos de programa (`.exe`) | ✅ ponta a ponta, com o ícone do próprio programa |
| Painéis (perfis de atalhos) | ✅ editor no Agente, troca e páginas no celular |
| Marcas próprias dos serviços | ✅ desenho nosso, no design system |
| Editor de painéis com prévia de telefone | ✅ conferido nos dois temas |

✅ **Tudo isto está publicado.** A PWA subiu sozinha na Vercel e o Agente
**0.1.7** saiu assinado em 17/08, com `.exe`, `.sig` e `latest.json` no ar. Os
Agentes instalados enxergam a atualização pelo endpoint de sempre.

Versões: Agente **0.1.7** publicado e assinado; PWA e API em produção.

Um Agente que ainda não atualizou continua funcionando com a PWA nova: sem
perfis no `deck.estado`, o celular mantém a grade clássica. Nada quebra — os
painéis só aparecem depois que aquele computador atualizar.

## 2. As decisões desta sessão que não podem ser desfeitas por engano

### O computador define, o celular arranja

É a decisão estruturante dos atalhos de programa, e ela **não foi inventada
agora** — o ADR-0004 já colocava `action.define` em `ESCOPOS_SOMENTE_NO_PC`
enquanto `deck.read`/`deck.write` são concedíveis a um aparelho.

- **Definir** (qual `.exe`, nome, cor, ícone) acontece na janela do Agente, com
  o seletor de arquivo nativo do Windows.
- **Arranjar** (perfis, ordem, o que aparece) é do celular.
- O celular manda `programa.<id>`; o caminho sai da lista em disco.

**Nunca faça o celular enviar caminho de arquivo.** Existe teste para o dia em
que alguém achar que isso "simplifica":
`atalho_de_programa_exige_a_mesma_concessao_e_nunca_carrega_caminho`.

### Abrir programa é permissão local, sem rota de API

O pareamento concede `ESCOPOS_PADRAO`, que **não** tem `system.process`. A
permissão é uma caixa na janela do Agente, por aparelho. Não existe
`PATCH /dispositivos/:id` e não deve existir: conceder poder pela conta é
exatamente o que o ADR-0004 proíbe. A conta revoga; conceder, nunca.

A concessão mora em `escoposLocais` (campo separado de `escopos`) em
`pares.rs`, porque `guardar_confirmado` reconstrói o par a partir do
`Dispositivo` da nuvem e apagaria uma permissão somada no mesmo campo. Teste:
`a_concessao_local_sobrevive_a_reconfirmacao_do_pareamento`.

`action.atalhos` é anunciada **por par** no hello — dois celulares no mesmo PC
recebem helos diferentes.

### Aparelho revogado repareia pela mesma linha

Recusar chave revogada não protegia nada (reparear exige a mesma cerimônia
física de um pareamento novo) e prendia o aparelho para sempre, porque o celular
reusa a chave que guardou. Agora a confirmação **reativa a linha existente**, sem
criar cópia, e os escopos voltam ao padrão.

`chave_de_outra_conta` continua bloqueando — ali a barreira é real.

## 3. Atalhos de programa e painéis — fechados

**Pronto e testado (44 testes Rust):**

- `apps/desktop/src-tauri/src/atalhos.rs` — cadastro, persistência atômica,
  validação de caminho, limite de 100, 12 cores espelhando `--s-control-*`.
- `apps/desktop/src-tauri/src/icone.rs` — extrai o ícone do próprio `.exe`
  (Shell → GDI → PNG data URI). Testado contra `notepad.exe`, conferindo a
  assinatura do PNG nos bytes decodificados.
- `acoes.rs` — resolve `programa.<id>`, exige `system.process`, revalida o
  caminho na execução e executa com `Command::new` (nunca linha concatenada).
- `lib.rs` — comandos `escolher_programa`, `listar_atalhos`, `criar_atalho`,
  `remover_atalho`, `renomear_atalho`. Plugin `tauri-plugin-dialog` registrado.

**Os quatro itens que faltavam aqui foram fechados em 17/08:** a tela no
Agente, o `deck.estado` no protocolo, o envio no transporte e a renderização na
PWA. Os painéis vieram junto, e o arquivo em disco subiu para a versão 2, com
migração da 1 testada (`migra_v1_sem_perder_programas_e_monta_perfil_padrao`).

**Onde os painéis moram, e por quê:** no Agente, por computador. Eles
referenciam executáveis que só existem naquela máquina; guardados no servidor
virariam lista de jogos inexistentes no outro PC.

**Duas coisas que não parecem importar e importam:**

- **Os painéis viajam só na primeira fatia do `deck.estado`.** É combinado com
  a remontagem em `transporte-webrtc.ts`, que zera os perfis ao ver `parte ==
  1`. Mandá-los numa fatia posterior os faz sumir; repetir em todas gasta banda
  à toa. Teste: `os_paineis_viajam_na_primeira_fatia_e_so_nela`.
- **`salvar_perfil` renumera as posições em vez de recusar o perfil.** A janela
  reordena trocando `ordem` entre vizinhos, e dois itens empatados fazem a
  troca não trocar nada — a seta para de funcionar e nada explica por quê.
  Empate é fácil de produzir sem ninguém errar. Teste:
  `posicoes_empatadas_sao_renumeradas_em_vez_de_recusadas`.

## 4. Operação — o que morde

### A API roda no ambiente `staging`, e o deploy é manual

Isto custou horas hoje. **O `slate-api` não tem trigger de GitHub** (`repoTriggers`
vazio, `source.repo` nulo): nada acontece quando você empurra para a `main`. E
ele vive no ambiente **`staging`**, não em `production` — em production só existe
o Postgres.

O resultado foi a API ficar 3 commits atrás por um dia, com a PWA atualizando
sozinha na Vercel. O sintoma chegou como bug de pareamento no celular, e a
investigação foi inteira na direção errada até o banco mostrar a verdade.

Para publicar a API:

```bash
railway link --project slate --environment staging --service slate-api
railway up --detach     # da RAIZ do repo; o build usa services/api/Dockerfile
```

**Pendência real:** conectar o repositório ao serviço para deployar sozinho no
push. Enquanto não fizer, isto volta a acontecer.

### ~~O e2e da PWA está vermelho há 8 execuções~~ — consertado em 17/08

Eram três causas, nenhuma delas defeito de código: faltava subir a API,
faltava `ORIGENS_PERMITIDAS` (o Next repassa o `Origin` e a lista vazia recusa
todo POST com 403), e `interoperabilidade-webrtc.spec.ts` sobe uma sonda em
Rust com `cargo run` numa máquina Ubuntu sem toolchain.

**A execução 32049170198 fechou com os cinco jobs verdes** — a primeira vez.

Vale manter assim: os defeitos que esta sessão achou à mão são exatamente a
classe de coisa que uma suíte ponta a ponta verde pega sem ninguém olhar.

### Release: empurre para a `main` e espere o CI antes de marcar a tag

Cache do GitHub Actions é isolado por ref, e **uma tag não enxerga o cache de
outra tag** — só o do branch padrão. Por isso quem grava o cache é o job `agente`
do CI, no `main`, e a publicação só lê (`save-if: false`, mesmo `shared-key`).
Marcar a tag antes do CI terminar faz a release sair fria.

## 5. Armadilhas descobertas hoje

| Armadilha | Sintoma | Onde |
|---|---|---|
| `cookie_store(true)` do reqwest é só memória | Agente pedia e-mail e senha a cada abertura | `api.rs` |
| Vite vigia `src-tauri/target` | `tauri dev` morre com `EBUSY` no Windows, e sobra publicar release para testar | `vite.config.ts` |
| CSP sem `worker-src` | QR nunca lê **só no iPhone** — Android usa `BarcodeDetector` e não passa pelo Worker | `next.config.ts` |
| Esperar resposta antes do toque seguinte | Volume impraticável; o transporte já aceitava pedidos simultâneos | `controles-basicos.tsx` |
| Cache de Actions isolado por tag | Cache do CI não acelera a publicação | workflows |
| Recurso inteiro pronto e nenhum comando registrado | Painéis não chegavam ao celular, sem erro em lugar nenhum | `lib.rs` |
| `next dev` + CSP sem `unsafe-eval` | React não hidrata: capturas bonitas e **todo clique ignorado em silêncio** | harness de prévia |
| `.tecla span` e `.tecla svg` vencem a cor da marca | Netflix, Prime e Disney+ todos na cor do perfil | `globals.css` |

## 6. Como rodar para testar

```bash
pnpm dev:local          # API + PWA + túnel HTTPS + Agente, tudo recarregando
pnpm dev:local --sem-agente
```

Mudança em Rust reconstrói em ~26–53s; mudança de interface é instantânea.
**Publicar release não é ferramenta de teste** — serve para distribuir a outras
máquinas.

⚠️ O Agente instalado e o Agente dev compartilham a mesma pasta de dados e a
mesma identidade. Rodar os dois ao mesmo tempo faz os dois brigarem pela
sinalização; feche um antes de abrir o outro.

## 7. O que o operador pediu e ainda não recebeu

1. ~~**Terminar os atalhos de programa**~~ — feito.
2. ~~**Perfis**~~ — feito, e vale saber como quase não foi: o recurso estava
   construído dos dois lados — editor na janela, schema no protocolo,
   remontagem em fatias na PWA — e mesmo assim nenhum painel chegava ao
   celular. Faltavam os seis comandos Tauri no `lib.rs`, que o editor chamava
   sem existirem, e o `deck.estado` saía do Agente só com `atalhos`. Nada
   falhava e nada avisava: o celular mostrava a grade clássica como se painel
   algum existisse. **A lição é a de sempre neste projeto — build verde não
   prova que testou.** O que achou foi renderizar as duas telas e olhar.
3. **Retorno do visual** — continua pendente do lado dele, mas já não é sem
   olhos: o editor de painéis e o painel do celular foram renderizados em
   Chromium, nos dois temas e nas duas orientações, e três defeitos saíram daí
   (marca do Prime idêntica à do YouTube a 20px, marcas todas na cor do perfil,
   grade usando um terço da tela). Ver §8.
4. **Prevenção de PCs duplicados.** Foram limpos 3 registros obsoletos hoje, mas
   nada impede que voltem: eles nascem de o Agente perder o arquivo de
   identidade. Deduplicar por **nome** é tentador e é armadilha — dois PCs podem
   se chamar igual, e o projeto já decidiu nunca revogar por nome. O conserto
   certo é descobrir por que a identidade sumiu quatro vezes num dia.

---

## 8. Como olhar a interface sem esperar build

Descoberto nesta sessão, e é a ferramenta que achou todos os defeitos visuais
acima. Nenhum dos dois harnesses é versionado — eles estão em
`.git/info/exclude`.

### O Agente, num navegador

O editor de painéis não precisa do Tauri para ser desenhado; precisa só de
alguém que responda ao `invoke`. Um `vite.previa.config.ts` com um apelido de
`@tauri-apps/api/core` para um arquivo que devolve dados plausíveis põe a tela
no Chromium em segundos, em vez dos minutos de um `cargo build`.

**Cuidado que custou uma rodada:** sem a barra lateral, `.agente` põe a tela na
coluna de 13,5rem e o que se vê é a régua do harness, não o editor. O harness
precisa reproduzir a casca real.

### A PWA, no telefone que não existe

Playwright com viewport de 390×844 e 844×390, e `deviceScaleFactor: 3`.

**Use o build de produção, não o `next dev`.** A CSP do projeto não libera
`unsafe-eval`, e o HMR do Next precisa dele: em desenvolvimento o React nunca
hidrata, a página fica estática e **todo clique é ignorado em silêncio**. O
sintoma engana — as capturas saem bonitas e sempre iguais, como se o estado não
mudasse. `pnpm run build && next start` resolve.

Pelo mesmo motivo, `page.evaluate` não funciona contra a PWA. Para inspecionar,
use os localizadores do Playwright (`locator`, `getByRole`), que não passam por
`eval`.

---

## 9. O que depende de você quando voltar

Nada aqui bloqueia continuar programando. É o que **só você pode fazer**, em
ordem de importância.

### 1. ~~Publicar o Agente~~ — feito: 0.1.7 no ar

Publicado em 17/08 a partir de `cfa0fed`, com a disciplina do cache respeitada:
empurrar para a `main`, esperar o CI (execução `32055712666`, cinco jobs
verdes, e é ele quem grava o cache `agente-windows`) e só então marcar a tag.

**Vale saber para a próxima:** o bump de versão mexe no `Cargo.lock`, e o
`Cargo.lock` entra na chave do cache. Marcar a tag no mesmo instante do push
teria feito a release procurar um cache que ainda não existia para aquele
lock. Esperar o CI é o que manteve a publicação em **5min30** em vez dos treze
minutos antigos.

Conferido depois de sair: `latest.json` anunciando `0.1.7`, o `.exe` baixando
com 200 pelo endereço que o próprio `tauri.conf.json` consulta, e a assinatura
presente. Só falta abrir o Agente numa máquina e aceitar a atualização.

### 2. Olhar e dizer o que achou

Foi tudo conferido em Chromium, nos dois temas e nas duas orientações, mas
Chromium não é o seu telefone na sua mão. Vale olhar especificamente:

- O tamanho das teclas. Elas agora crescem para ocupar a tela, com teto de
  10rem. Se ficarem grandes demais para o seu gosto, é uma linha —
  `grid-auto-rows` em `.grade-perfil`.
- As seis marcas dos serviços. São desenho nosso, de propósito: um produto de
  assinatura não embute logotipo registrado de terceiros. Se alguma não estiver
  reconhecível o bastante, dá para redesenhar sem mexer em mais nada.

### 3. Experimentar o painel que entra sozinho — e é o único código não rodado

Um painel pode listar programas em **Entrar sozinho**: quando um deles fica em
primeiro plano no computador, o celular abre aquele painel na hora.

**É a única parte desta sessão cujo resultado em execução ninguém viu** — e a
lacuna é menor do que parece. A leitura do Windows (`GetForegroundWindow` →
`OpenProcess` → `QueryFullProcessImageNameW`) compila **e linka** no
`windows-latest` do CI: o job `agente` roda `cargo test --locked` no alvo
completo, não só a biblioteca. Ou seja, as chamadas existem, as assinaturas
batem e o binário monta.

O que ninguém conferiu é o **valor devolvido diante de uma área de trabalho de
verdade** — se a janela em foco vira mesmo o nome de arquivo esperado. Aqui só
`cargo test --lib` rodou, porque o Agente instalado tranca o binário.

O que compensa isso é o desenho: **a vigilância nem chega a perguntar ao
Windows enquanto nenhum painel tiver regra.** Depois da migração todo painel
nasce sem nenhuma, então quem só atualizar o Agente não ganha comportamento
novo. Você liga digitando um executável no editor, e desliga apagando.

Toda a decisão — qual painel um programa pede, o que fazer num empate, quando
vale a pena olhar — está em funções puras testadas em `atalhos.rs`. O módulo do
Windows só devolve um nome de arquivo ou nada.

Dois limites conhecidos, para não parecerem defeito:

- **Programa aberto como administrador lê como nada.** `OpenProcess` responde
  acesso negado a um processo mais privilegiado que o Agente, e alguns jogos
  com anti-cheat rodam elevados. O painel simplesmente não troca.
- **Programa sem regra não devolve ninguém ao painel inicial.** Abrir o bloco
  de notas no meio de uma transmissão não tira da mão os controles em uso.

E a regra de convivência, que vale conferir: **um toque seu vence o
automático** até o computador mudar para outro programa. Escolheu "Cinema" com
o OBS aberto? Fica em Cinema. Abriu o Valorant depois? Aí sim o painel segue.

### 4. Uma pendência antiga que continua de pé

- **O `slate-api` não tem trigger de GitHub.** Todo deploy da API é manual, e
  já custou um dia de investigação na direção errada. Nada desta sessão mexeu
  na API, então ela não está atrasada agora — mas o próximo commit em
  `services/api` volta a precisar de `railway up` na mão.

O e2e da PWA, que estava nesta lista, foi consertado — ver §4, "Operação — o
que morde".
