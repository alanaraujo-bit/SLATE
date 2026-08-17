# ADR-0006 — Energia remota: desligar com segurança, acordar com honestidade

**Situação:** ACEITO
**Referências do mandato:** §5 (permissão para ações de risco), §13 (segurança), §37 (estados explicáveis)
**Depende de:** [ADR-0002 Transporte](./ADR-0002-transporte.md), [ADR-0003 Protocolo](./ADR-0003-protocolo.md), [ADR-0004 Segurança](./ADR-0004-seguranca.md)

## Contexto

A funcionalidade pedida é: o computador está desligado, a pessoa toca "Ligar" no
celular, o computador volta e o SLATE confirma que ele está online.

Metade disso é trabalho comum. Bloquear, suspender, hibernar, reiniciar e
desligar acontecem com o Agente **online** — são ações como qualquer outra,
entrando pelo registro fechado de `acoes.rs`, com escopo, anti-repetição e
auditoria que já existem.

A outra metade não é comum, e é onde quase todo produto mente: **acordar
acontece com o Agente offline, por definição.** Não há software rodando no alvo.
Quem acorda a máquina é o firmware da placa de rede, e ele precisa receber um
quadro Ethernet.

Este documento existe porque essa assimetria governa todo o resto do desenho.

## O fato físico que decide tudo

> **Um navegador não emite pacote UDP bruto, e não emite quadro de broadcast.**

Não existe API. `fetch`, WebSocket e WebRTC produzem tráfego estruturado para um
destino que já existe e responde — e o alvo, desligado, não responde nada. Não é
limitação de permissão que se contorne pedindo permissão: não há superfície.

Disso decorre, sem exceção:

> **Acordar exige sempre um componente ativo dentro do domínio de broadcast do
> alvo.** A PWA sozinha nunca acorda computador nenhum, esteja ela no 4G ou no
> mesmo Wi-Fi da máquina.

Estar na mesma rede que o alvo **não ajuda a PWA**. Este é o ponto contraintuitivo
que precisa estar escrito: a intuição diz que o caso "estou em casa" é o fácil e
o caso "estou na rua" é o difícil. Para o navegador os dois são igualmente
impossíveis, e pela mesma razão.

Portanto o desenho inteiro se resume a uma pergunta: **quem, dentro daquela rede,
emite o pacote?**

## Decisão

### 1. Duas metades, deliberadamente separadas

| | Agente do alvo | Caminho |
|---|---|---|
| **Desligar** (bloquear, suspender, hibernar, reiniciar, desligar, cancelar) | online | ação comum pelo DataChannel |
| **Acordar** | offline | ponte: outro Agente da conta, online naquela rede |

As duas não compartilham marco no plano, e é de propósito. Acordar depende de
hardware, de firmware e de topologia — coisas que podem legitimamente não existir
na máquina de alguém. Desligar não depende de nada disso. Amarrar as duas faria
uma capacidade que funciona ficar refém de uma que talvez não funcione.

### 2. A ponte de acordar é um Agente, e o pedido é uma ação comum

O pacote mágico é emitido por **um Agente do SLATE que esteja online na mesma
rede do alvo**. O celular não fala com o alvo (que está desligado); ele executa
uma ação no Agente-ponte, exatamente como executa qualquer outra.

```
PWA ──► sinalização ──► Agente-ponte (online, mesma rede do alvo)
                              │
                              ├─► consulta a nuvem: qual o alvo?
                              │
                              └─► pacote mágico em broadcast na LAN
                                              │
                                              ▼
                                     Alvo acorda ──► Agente sobe
                                              │
PWA ◄──────── ONLINE ◄──── sinalização ◄──────┘
```

Isto foi escolhido em vez de um tipo de mensagem novo na sinalização porque
**reaproveita tudo o que já protege uma ação**: validação de envelope, janela de
timestamp, sequência, ids já vistos, escopo verificado no par confiável e
registro de auditoria. Um caminho paralelo pela sinalização teria que reconstruir
cada uma dessas defesas, e a que fosse esquecida seria descoberta tarde.

Consequência aceita: a ponte precisa ser um computador que **aquele celular
também pareou**. O Agente recusa quem não está na lista local de pares, e isso é
correto — não vamos abrir exceção na porta de entrada para acomodar uma
conveniência.

### 3. O celular manda o identificador; o endereço físico nunca sai da nuvem

Mesma regra que já vale para atalhos de programa, e pelo mesmo motivo. O celular
envia `sistema.acordar` com o **identificador do computador alvo**. A ponte
pergunta à nuvem, autenticada pela própria identidade e restrita à própria conta,
qual o endereço físico daquele alvo.

Se o endereço viajasse no pedido, qualquer aparelho pareado poderia mandar um
Agente emitir quadros para endereços arbitrários da rede. É pouco dano e é dano
desnecessário: o identificador como chave de busca custa a mesma linha de código
e fecha a porta.

Existe teste para o dia em que alguém achar que mandar o endereço "simplifica",
na mesma família de
`atalho_de_programa_exige_a_mesma_concessao_e_nunca_carrega_caminho`.

### 4. Pronto para Retorno é o estado escolhido, não um estado inventado

**Pronto para Retorno** é o menor consumo daquela máquina que ainda preserva
retorno confiável. O SLATE escolhe a partir do perfil detectado:

1. Se o retorno a partir de **desligado** for confiável naquela máquina —
   desliga.
2. Senão, se o retorno a partir de **hibernação** for confiável — hiberna.
3. Senão — não existe Pronto para Retorno naquela máquina, e a interface diz
   isso, com os controles de desligar continuando disponíveis.

O terceiro item é a parte que não pode ser suavizada. **Não prometemos consumo
zero com retorno.** Se não chega energia à placa de rede, nenhum software
resolve, e apresentar isso como "configuração pendente" seria mentir sobre
hardware.

### 5. Níveis de compatibilidade

Derivados de capacidade medida, nunca de modelo de máquina.

| Nível | O que significa |
|---|---|
| **COMPLETO** | Retorno a partir de desligado, e há ponte na rede. |
| **PADRÃO** | Pronto para Retorno por hibernação, com retorno pela rede local. |
| **LIMITADO** | Controles de desligar disponíveis; retorno pela rede indisponível. |

Um nível nunca é presumido: enquanto o autoteste não rodou, a capacidade é
**desconhecida**, que é uma resposta diferente de "não suporta" e de "suporta".

### 6. Desligar é autoridade própria, e acordar é outra

Nem uma nem outra vem no pareamento. Ambas são caixas marcadas na janela do
Agente, por aparelho, guardadas em `escoposLocais` — o campo separado que
`guardar_confirmado` não apaga ao reconstruir o par a partir da nuvem.

Ficam **separadas entre si** porque não são o mesmo risco. Acordar não destrói
nada: no pior caso a máquina liga sem necessidade. Desligar pode custar trabalho
não salvo. Um único escopo forçaria quem quer o botão de ligar a conceder também
o de desligar.

Pelo mesmo motivo, desligar e reiniciar **não forçam** o fechamento de programas
por padrão: um documento não salvo vale mais que a garantia de que o comando
funcionou.

### 7. Desligar tem contagem, e "aceito" não é "aconteceu"

Desligar e reiniciar disparam com **15 segundos de contagem**, não
imediatamente. Duas razões concretas:

- Quem está fisicamente na frente da máquina consegue cancelar um comando
  disparado por engano do celular — o caso do bolso, ou da criança com o
  telefone na mão.
- É o que dá sentido a `sistema.cancelar-desligamento`. Sem janela, não há o que
  cancelar, e a ação existiria só no papel.

A consequência precisa estar na interface, porque é a mesma disciplina do
acordar, espelhada: **o `ok` da ação significa que a contagem começou, não que a
máquina desligou.** Assim como `WAKE_SENT` não é `ONLINE`, "desligamento aceito"
não é "computador desligado" — e nesse intervalo o desligamento ainda pode ser
abortado localmente ou barrado por um programa com trabalho aberto.

A PWA mostra a contagem e oferece cancelar durante ela. Quem confirma que a
máquina de fato desligou é o mesmo sinal que confirma tudo o mais neste
documento: a sessão caindo, e depois o computador aparecendo como offline.

## Acordar de outra rede

O caso "estou no 4G e quero ligar o PC de casa". Vale registrar o que foi
examinado, porque é onde a tentação de prometer é maior.

### O que não vamos fazer

- **Encaminhamento de porta com ARP estático** — funciona, e exige abrir uma
  porta do roteador para a internet e configurar entrada ARP permanente. É
  configuração manual avançada e superfície exposta. O mandato pede o contrário
  das duas coisas.
- **Broadcast dirigido** — desligado por padrão em praticamente todo roteador
  doméstico há duas décadas, justamente por ser vetor de amplificação.
- **Exigir qualquer equipamento comprado** — proibido pelo mandato, e
  desnecessário dado o item abaixo.

### O que vamos fazer

**Outro Agente da conta, online naquela rede, é a ponte.** É a mesma mecânica do
item 2 do desenho: a PWA no 4G alcança a ponte pela sinalização na nuvem — que é
pública — e a ponte emite o pacote localmente. Nada é aberto no roteador, nada é
comprado, e a segurança é a mesma de qualquer outra ação.

Isso cobre com honestidade a casa com mais de um computador, o computador que
fica ligado, o notebook de trabalho na mesma rede.

**E não cobre a casa com um computador só, que é justamente o cenário do
mandato.** Quando não há ponte, a interface detecta e explica — não mostra um
botão que não faz nada, e não chama de "configuração pendente" o que é ausência
de componente.

### Registrado como recusado por ora

- **Acordar por relógio (RTC/wake timer).** O alvo acordaria sozinho de tempos em
  tempos, consultaria a nuvem e decidiria continuar ligado ou voltar a dormir.
  É puramente software e funcionaria sem ponte. Foi recusado por agora: consome
  energia periodicamente numa funcionalidade cujo propósito é economizar, o
  computador liga sozinho de madrugada sem explicação visível, e a latência
  ("liga em até 15 minutos") não é a experiência que o mandato descreve. Fica
  registrado porque, para o cenário de um computador só, é a única alternativa
  software-only conhecida — e pode voltar como opção explícita, nunca como padrão.
- **Intel AMT / vPro.** É a resposta correta de verdade para "acordar de
  qualquer lugar": pilha de rede fora do sistema operacional, funciona desligado.
  Existe só em máquinas empresariais e o provisionamento passa pelo firmware.
  Será **detectado e informado** quando presente, não implementado agora.

## Consequências

**A favor**
- Acordar herda, sem código novo, todas as defesas que já protegem uma ação.
- A separação em duas metades deixa a parte que funciona chegar a 100% mesmo se
  a outra esbarrar em hardware.
- Nenhuma compra, nenhuma porta aberta, nenhuma alteração de firmware por baixo
  dos panos.

**Custos aceitos**
- Acordar depende de haver outro Agente online naquela rede. É uma limitação
  real, detectada e explicada — não contornada com promessa.
- O perfil de capacidades precisa ser guardado na nuvem para que um computador
  desligado seja sequer visível na lista. Hoje a presença é a única fonte, e
  ausente é indistinguível de inexistente.
- Parte das capacidades só pode ser provada com a máquina física. Enquanto o
  autoteste não rodou, o SLATE diz "não testado", que é feio e é verdade.

**Deliberadamente adiado**
- Acordar por relógio, como opção explícita para quem tem um computador só.
- Provisionamento de AMT.
