# ADR-0007 — Integração com o CALL: um canal local, e não uma tecla simulada

**Situação:** ACEITO
**Referências do mandato:** §5 (permissão para ações de risco), §13 (segurança), §37 (estados explicáveis)
**Depende de:** [ADR-0003 Protocolo](./ADR-0003-protocolo.md), [ADR-0004 Segurança](./ADR-0004-seguranca.md)

## Contexto

O [CALL](https://call.aionixdev.com/) é o aplicativo de voz, texto e transmissão
de tela do mesmo autor. O pedido que originou este documento foi curto: mutar o
microfone do CALL pelo celular.

Parece um botão a mais na grade. Não é — ele atravessa uma fronteira que o SLATE
nunca tinha atravessado. Todas as ações existentes terminam no Windows: uma tecla
de mídia, um processo aberto, uma chamada de energia. Esta termina **dentro de
outro aplicativo**, que tem estado próprio e pode nem estar aberto.

## Os três caminhos, e por que dois foram descartados

**Simular o atalho global de mudo do CALL.** O CALL já registra um atalho global,
e o Agente já sabe apertar teclas. Descartado: `definir_atalho_mudo` guarda uma
combinação que a **pessoa** escolhe e troca quando quiser. O SLATE estaria
chutando um acorde que não é dele, e que muda sem aviso. Um recurso que quebra
porque alguém mexeu numa preferência não é um recurso.

**Abrir `call://mudo`.** O esquema já existe, já está registrado no sistema, e a
instância única já entrega a URL para a janela aberta. Teria sido a versão de uma
hora. Descartado por dois defeitos que não têm conserto nesse caminho:

1. **É de mão única.** O celular ficaria com um botão de mudo sem saber se você
   está mudo — cara ou coroa a cada toque. E quem está com o celular na mão não
   pode conferir olhando para o computador, porque não estar na frente dele é o
   motivo de o SLATE existir.
2. **Rouba o foco.** Quem trata a segunda instância chama
   `mostrar_janela_principal`. Cada aperto do mudo arrancaria a janela do CALL
   para a frente de tudo.

**Um canal local com estado — escolhido.** O CALL abre uma porta em `127.0.0.1`,
grava porta e segredo em `%LOCALAPPDATA%\CALL\controle.json`, e mantém a conexão
aberta. O Agente acha o arquivo, conecta, e os dois sentidos passam por ali.

## Por que a conexão fica aberta

Porque estado empurrado é a diferença entre um botão e um palpite.

Quando alguém muta pelo teclado do PC, o celular precisa saber **naquele
instante** — não no próximo toque que der errado. E o mesmo canal resolve o
problema de partida: quem conecta no meio de uma chamada recebe o estado atual
antes de desenhar qualquer tecla.

## Por que existe um segredo, se já é `127.0.0.1`

Porque *local* não é *autorizado*. Qualquer processo da máquina alcança a porta,
inclusive um que a pessoa não pôs ali. O segredo fica sob `%LOCALAPPDATA%`, que
no Windows já é por usuário, e é o que separa "roda neste computador" de "pode
mexer no seu microfone". A primeira linha da conexão é sempre a credencial, e
nada é respondido antes dela — nem o estado, que já contaria se há chamada aberta.

## Valor desejado, e nunca "alterne"

O verbo carrega `mudo: true|false`. Alternar por um canal que pode repetir uma
mensagem deixa as duas pontas discordando sem ninguém perceber; dizer "fique
mudo" é idempotente e converge sozinho, quantas vezes chegar.

Isso não custa a lista fechada de ações do ADR-0004: são **dois identificadores**
— `call.mudo` e `call.falar` — para **uma tecla** na tela. O celular escolhe qual
mandar a partir do estado que já recebeu. Nada vindo do canal vira valor.

## Escopo: `system.media`, e não um escopo novo

Mutar uma chamada que já está acontecendo é a mesma autoridade que mexer no que
já está tocando — o mesmo raciocínio que pôs volume sob `system.media` em vez de
um escopo próprio. Um escopo novo obrigaria a **reparear todo aparelho
existente** para ganhar um botão de mudo, sem nenhum ganho de segurança.

> **Isto vale para o mudo, e só para ele.** "Abrir a live" transmite a área de
> trabalho para um grupo, e não é da mesma classe de risco. Se um dia entrar, tem
> de vir com escopo próprio dentro de `ESCOPOS_SOMENTE_NO_PC` — pelo mesmo motivo
> que o [ADR-0006](./ADR-0006-energia-remota.md) separou `system.power` de
> `system.wake`.

## Capacidade e estado respondem perguntas diferentes

`call.controle` diz que aquele Agente **sabe** falar com o CALL. `disponivel`, em
`call.estado`, diz se ele está falando **agora**. Um Agente novo com o CALL
fechado responde sim para a primeira e não para a segunda.

Espremer as duas numa coisa só produziria o erro que o ADR-0006 já documentou na
grade de energia: desenhar botão para o que a máquina não faz. Aqui a tecla só
existe com `disponivel` **e** `emChamada` — fora de uma chamada o CALL desiste na
primeira linha de `alternarMicrofone`, e um botão que não faz nada é pior do que
um botão ausente. As duas ausências têm frases próprias, porque têm ações
próprias: uma se resolve abrindo o CALL, a outra entrando num canal de voz.

## O que fica de fora, e por quê

**Abrir a live.** A transmissão do CALL começa em
`navigator.mediaDevices.getDisplayMedia()`, que **sempre** abre o seletor de
fonte do Chromium. Um toque no celular iniciaria um fluxo que morre numa caixa de
diálogo na máquina onde a pessoa não está. Não é lacuna de integração: é um modo
que o CALL ainda não tem. Enquanto ele não existir, o botão seria uma promessa
falsa.

**Volume do CALL no mixer.** Diferente do volume do Windows, que o SLATE já faz
por `VK_VOLUME_UP`/`VK_VOLUME_DOWN`. Viável — o CALL já depende de `wasapi` —, mas
é outro recurso, e não foi pedido.

## Consequências

- O CALL ganha um módulo (`src-tauri/src/controle.rs`) que **não pode derrubar a
  partida**: porta que não sobe ou disco que não aceita o arquivo terminam em
  silêncio, e o pior caso é o painel não achar o CALL — o mesmo caso de quem não
  tem o SLATE.
- O Agente ganha um laço que nunca desiste: o CALL abrir e fechar várias vezes
  numa tarde é uso normal, e cada volta reencontra o painel sozinha.
- O canal é genérico. Nada nele é específico do SLATE, e verbos futuros entram na
  mesma lista fechada.
- **`call.controle` é anunciada a todo par**, diferente de `action.atalhos` e
  `energia.controle`. É consequência direta do escopo escolhido: como mutar cai
  em `system.media`, que o pareamento já concede, não haveria o que marcar na
  janela. Todo aparelho pareado recebe `call.estado` e, com chamada aberta,
  uma tecla de mudo que funciona. Se algum dia isso precisar de consentimento
  por máquina, o escopo é que muda — não o anúncio.
- **Um CALL que fecha à força deixa o arquivo de descoberta para trás**, porque
  `esquecer_descoberta` só roda na saída limpa. O custo é uma conexão recusada a
  cada cinco segundos até o CALL abrir de novo e reescrever o arquivo, e o
  celular continua vendo `disponivel: false` — que é a verdade. Não vale código
  para arrumar: o Agente apagar arquivo de outro aplicativo seria pior.
