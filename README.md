<div align="center">

# SLATE

**Transforma qualquer celular ou tablet numa superfície de controle inteligente e contextual para o seu computador.**

_SLATE by Aionix — um produto da Aionixdev_

</div>

---

## O que é o SLATE

Seu celular deixa de ser uma segunda tela e passa a ser uma extensão operacional
do PC. O SLATE entende o que você está fazendo — qual aplicativo está em foco,
qual jogo está rodando, em qual branch você está — e apresenta os controles
certos sem você pedir.

Não é uma grade de botões. É uma plataforma: um motor de contexto, um motor de
ações e um canal de estado bidirecional, com superfícies de controle por cima.

## Arquitetura em um olhar

```
        ┌──────────────┐   WebRTC DataChannel (DTLS)   ┌────────────────┐
        │  PWA SLATE   │◄─────────── direto ──────────►│ Agente Desktop │
        │ celular/tablet│                               │    Windows     │
        └──────┬───────┘                                └───────┬────────┘
               │            ┌───────────────────┐               │
               └───────────►│    Sinalização    │◄──────────────┘
                            │   só SDP / ICE    │
                            └───────────────────┘
```

O transporte é WebRTC, e não um WebSocket na rede local, por motivos que não são
óbvios — veja o [ADR-0002](./docs/architecture/ADR-0002-transporte.md). Em
resumo: uma página HTTPS não consegue abrir `ws://`, nenhuma autoridade
certificadora emite certificado para IP privado, e o Chrome 142 passou a exigir
permissão para acesso à rede local. O WebRTC contorna os três.

## Estrutura do repositório

| Caminho | Para que serve |
|---|---|
| `apps/pwa` | A superfície de controle do SLATE (PWA) |
| `apps/control-center` | Centro de Controle de Desenvolvimento — o plano ao vivo |
| `apps/desktop` | Agente Desktop para Windows (Tauri + Rust) |
| `packages/protocol` | Contratos de mensagem compartilhados por todos os clientes |
| `packages/design-system` | Tokens e primitivas de design |
| `packages/db` | Schema e migrações do Postgres |
| `packages/roadmap-cli` | CLI interna que move o estado do plano |

## Acompanhar o desenvolvimento

O Centro de Controle mostra fases, marcos, critérios de qualidade, execução
atual, atividade e o que depende de você — atualizando em tempo real, sem
recarregar a página.

```bash
pnpm install
pnpm roadmap:ui      # abre em http://localhost:4300
```

Ele roda localmente contra o Postgres na nuvem: o estado é compartilhado e
persistente, mas nenhuma publicação é necessária para refletir uma mudança
(decisão [D-007](./docs/operator/DECISIONS.md)).

Para mover o estado do plano:

```bash
pnpm roadmap report              # progresso calculado
pnpm roadmap start P1-M1-T1      # marcar em andamento
pnpm roadmap complete P1-M1-T1   # recusado se houver critério pendente
```

## Documentação

- [Decisões de arquitetura](./docs/architecture/) — por que as coisas são como são
- [Ações do operador](./docs/operator/OPERATOR_ACTIONS.md) — o que depende de você
- [Registro de decisões](./docs/operator/DECISIONS.md)
- [Impedimentos](./docs/operator/BLOCKERS.md)

## Idioma

Interface, plano de trabalho e documentação em português. Continuam em inglês,
por serem contrato de dados e não interface: chaves dos itens do plano
(`P0-M1-T1`), valores de status no banco (`COMPLETED`), nomes de tabelas e
colunas, e identificadores de código.

---

© Aionixdev. Todos os direitos reservados.
