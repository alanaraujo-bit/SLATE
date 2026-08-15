# ADR-0001 — Arquitetura do sistema e formato do repositório

**Situação:** ACEITO
**Referências do mandato:** §8, §14, §19, §33

## Contexto

O SLATE são quatro peças de software que cooperam — uma PWA para celular, um
agente desktop para Windows, serviços na nuvem e um centro de controle interno —
que compartilham um protocolo, uma linguagem visual e um modelo de dados. Cada
uma evolui em ritmo próprio.

## Decisão

### Repositório único, com workspaces do pnpm

```
apps/
  pwa               A PWA do SLATE — a superfície de controle (Next.js, Vercel)
  control-center    Centro de Controle de Desenvolvimento (Next.js, local)
  desktop           Agente Desktop para Windows (Tauri + React + núcleo em Rust)
services/
  api               HTTP, sinalização WebRTC e coordenação TURN (Node, Railway)
packages/
  protocol          Contratos de mensagem, schemas, versão do protocolo
  design-system     Tokens e primitivas compartilhadas entre PWA e desktop
  db                Schema e migrações (Drizzle, Postgres)
  roadmap-cli       CLI interna que altera o estado do plano (§24)
```

Repositório único porque `packages/protocol` é consumido por três clientes
independentes que não podem divergir. Sincronizar contratos entre repositórios é
justamente o modo de falha que este formato existe para evitar. O mandato §33
alerta contra microsserviços prematuros; workspaces dão fronteira de módulo sem
fronteira de distribuição.

### Onde cada coisa roda

| Preocupação | Onde | Por quê |
|---|---|---|
| PWA, páginas públicas, APIs HTTP | Vercel | Distribuição na borda, publicações de pré-visualização por branch (§16) |
| Postgres | Railway | Estado persistente; a preferência declarada no mandato (§34) |
| Sinalização e retransmissão | Railway | Conexões WebSocket longas e coordenação TURN |
| Integração com Windows | Agente Desktop | Único lugar com acesso ao sistema operacional |
| Centro de Controle | Máquina do operador | Decisão do operador (D-007): ferramenta temporária que não deve exigir publicação para refletir uma mudança |

> **Emenda de 15/08/2026 — um único serviço de servidor.** A decisão posterior
> do [ADR-0005](./ADR-0005-contas-e-sessoes.md) consolidou contas, APIs HTTP e
> sinalização em `services/api`. A fronteira lógica da sinalização continua
> existindo como módulo, mas não como um segundo serviço implantado.

**A sinalização ainda não foi criada de propósito.** O mandato §19 proíbe
provisionar infraestrutura antes da necessidade. Ela é adicionada ao processo
da API quando a etapa de transporte começar. O Railway continua sendo o destino
porque a conexão WebSocket é persistente; não será criado um microsserviço só
para separar uma preocupação que cabe no processo já existente.

### Agente Desktop: Tauri com Rust

Validado, não presumido. O Tauri dá um instalador pequeno, um processo nativo de
verdade para acessar as APIs do Windows, e uma interface em webview que pode
reaproveitar o `design-system`. O núcleo em Rust é onde ficam a observação de
processos, o Motor de Ações e o par WebRTC. A cadeia de ferramentas foi
verificada na máquina alvo antes da decisão: o `cargo` compila e linka pelo MSVC.

A alternativa considerada foi Electron — descartada pelo tamanho do instalador e
pelo consumo de memória de um agente que fica sempre residente, que é exatamente
o perfil em que esses custos são menos aceitáveis.

## Consequências

- Um `pnpm install`, um sistema de tipos, uma configuração de lint.
- Mudanças de protocolo são atômicas entre os clientes, dentro de um commit.
- Projetos na Vercel publicam a partir de subdiretórios do mesmo repositório;
  cada projeto define seu próprio diretório raiz.
- Exige disciplina: pacotes do workspace não podem se importar em ciclo.
