# Onde paramos — 16/08/2026

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
| Atalhos de programa (`.exe`) | 🟡 metade — ver §3 |
| Perfis de atalhos | ❌ não começou |

Versões: Agente **0.1.6** publicado e assinado; PWA e API em produção com tudo
acima.

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

## 3. O que está pela metade: atalhos de programa

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

**Falta, e é o que impede o uso:**

1. **Tela no Agente** (`apps/desktop/src/Agente.tsx`) — botão "Adicionar
   programa" que chama `escolher_programa` e depois `criar_atalho`, lista com
   ícone, nome editável, seletor de cor e remoção. Sem isso não há como
   cadastrar.
2. **Mensagem de deck no protocolo** — `packages/protocol/src/mensagens.ts` não
   tem nenhum `deck.*` em `SCHEMAS`. Precisa de um `deck.estado` levando
   `{ id, nome, cor, icone }[]`. A capacidade `deck.sync` já existe em
   `CAPACIDADES`.
3. **Envio no transporte** — `transporte.rs` manda o deck depois do hello, só
   para pares com `system.process`. A lista já está disponível ali: `atalhos`
   foi passada até `EventosPar`.
4. **PWA renderiza** — hoje `apps/pwa/lib/controles.ts` tem lista fixa. Precisa
   aceitar a lista vinda do Agente e desenhar ícone (`<img src={dataUri}>`) e
   cor por tecla, reusando `--tom` que o CSS já expõe em `.tecla`.

**Passo seguinte (perfis):** guardar no Agente, por computador — eles
referenciam executáveis que só existem naquela máquina, e no servidor virariam
lista de jogos inexistentes no outro PC. Reusar o padrão de gravação atômica com
reserva de `pares.rs`. `contextoAlterado` no protocolo já prevê `profileId`.

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

### O e2e da PWA está vermelho há 8 execuções

O job `pwa` do `ci.yml` sobe a PWA com `next start` mas **não sobe a API nem
define `API_URL`** — então os 17 testes de conta e pareamento não têm como
passar. É anterior a esta sessão. O job `integracao`, no mesmo arquivo, já mostra
o padrão de subir com banco.

Isto ficou caro: se estivesse verde, teria pegado o beco sem saída do pareamento
antes do operador.

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

1. **Terminar os atalhos de programa** — §3.
2. **Perfis** — vários conjuntos de atalhos, com nome e ícone próprios.
3. **Retorno do visual** — o redesign subiu sem os olhos dele. Design não se
   verifica com build passando.
4. **Prevenção de PCs duplicados.** Foram limpos 3 registros obsoletos hoje, mas
   nada impede que voltem: eles nascem de o Agente perder o arquivo de
   identidade. Deduplicar por **nome** é tentador e é armadilha — dois PCs podem
   se chamar igual, e o projeto já decidiu nunca revogar por nome. O conserto
   certo é descobrir por que a identidade sumiu quatro vezes num dia.
