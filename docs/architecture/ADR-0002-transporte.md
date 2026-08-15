# ADR-0002 — Transporte: WebRTC DataChannel com sinalização na nuvem

**Situação:** ACEITO (validado por pesquisa em 15/08/2026)
**Substitui:** nada
**Referências do mandato:** §12 (pareamento e conectividade), §13 (segurança), §7 (PWA obrigatória)

## Contexto

A PWA do SLATE é servida por HTTPS. Ela precisa alcançar um Agente Desktop
rodando na máquina Windows do usuário, de preferência na mesma rede local, com
baixa latência. O mandato §12 proíbe fazer o usuário digitar IP, porta ou token,
e exige explicitamente uma *validação técnica* antes de congelar o protocolo.

Este documento é o resultado dessa validação.

## O desenho óbvio não funciona

A abordagem intuitiva — o Agente abre um servidor WebSocket local e a PWA conecta
em `ws://192.168.1.x:porta` — falha por três motivos independentes:

1. **Conteúdo misto.** Uma página HTTPS não pode abrir conexão `ws://`. Os
   navegadores bloqueiam direto.
2. **Certificado é impossível.** Subir para `wss://` exigiria um certificado
   válido para um IP privado. Nenhuma autoridade certificadora pública emite
   isso. Distribuir uma chave privada junto com o instalador e instalar uma raiz
   confiável é um antipadrão de segurança e um ímã para antivírus.
3. **O acesso à rede local está fechando.** O Chrome 138 introduziu a checagem
   de Acesso à Rede Local atrás de uma flag; o **Chrome 142 lançou o pedido de
   permissão**. Requisições de sites públicos para `192.168.0.0/16`,
   `169.254.0.0/16`, `fc00::/7`, `fe80::/10`, loopback e `.local` passaram a ser
   controladas. Conexões locais por WebSocket, WebTransport e WebRTC estão
   documentadas como *ainda não* controladas, mas explicitamente planejadas.
   Construir o transporte principal sobre um mecanismo em vias de ser restringido
   é irresponsável para um produto comercial.

## Decisão

**Transporte principal: WebRTC DataChannel, negociado por um serviço de
sinalização na nuvem, preferindo o caminho direto na rede local e caindo para
retransmissão via TURN quando necessário.**

Ponto a ponto contra as falhas acima:

- O WebRTC **não está sujeito às regras de conteúdo misto**. Uma página HTTPS
  pode estabelecer conexão com um par na rede local.
- O WebRTC exige **DTLS**; o canal é criptografado ponta a ponta por construção.
  Não escrevemos criptografia de transporte à mão, e nunca precisamos de
  certificado emitido para IP privado.
- **A ofuscação por mDNS não atrapalha aqui, por assimetria.** Os navegadores
  substituem os *próprios* candidatos por nomes aleatórios `<uuid>.local` para
  não vazar o IP local do usuário para qualquer página. O Agente Desktop é uma
  aplicação *nativa*, sem essa restrição: ele anuncia o IP real da rede local. O
  ICE só precisa que um dos lados ofereça um candidato alcançável, então o
  navegador conecta direto no Agente. O mecanismo de privacidade que quebra
  conexões navegador-para-navegador na rede local não quebra
  navegador-para-nativo.

### Escolha de caminho

```
PWA ──── SDP/ICE pela sinalização (WSS, nuvem) ────► Agente Desktop
    ◄─────────── DataChannel (DTLS) ───────────────►
                  ▲                      ▲
          candidato local          candidato de relay
          (mesma rede, direto)     (TURN, alternativa)
```

O ICE naturalmente prefere o caminho de menor latência e cai para a alternativa
de forma transparente. Os dois casos são o mesmo código na camada de aplicação —
a aplicação enxerga um único `RTCDataChannel` seja qual for. Isso atende ao §12:
"preferência por caminho direto e de baixa latência, alternativa transparente".

### Sinalização

Um serviço WSS persistente. Ele intermedia ofertas e respostas SDP e candidatos
ICE entre os dispositivos pareados de uma conta autenticada. Ele enxerga apenas
os metadados de estabelecimento da sessão, nunca o tráfego de controle nem seu
conteúdo. Sinalização é ponto de encontro, não caminho de dados.

### Pareamento

Encontro mediado por conta, não descoberta de rede (§12: nunca inventar
mecanismo de descoberta que os navegadores não suportam — navegação por mDNS
simplesmente não existe para páginas web). O Agente se autentica na conta; a PWA
se autentica na mesma conta; o Agente aparece na lista de dispositivos da PWA. A
identidade criptográfica do dispositivo e o handshake de pareamento serão
especificados no ADR-0004 (Segurança), ainda não escrito — é a tarefa `P0-M1-T4`
do plano e precede a etapa de pareamento.

## Consequências

**A favor**
- Nenhum problema de conteúdo misto ou certificado, nunca.
- Criptografia obrigatória e padronizada, em vez de artesanal.
- Latência de rede local no caso comum; funciona entre redes via retransmissão.
- Sobrevive à adoção do Acesso à Rede Local — não dependemos de acesso livre.

**Custos aceitos**
- Complexidade de implementação bem maior que um WebSocket simples. ICE,
  renegociação e reconexão dão trabalho de verdade.
- Exige o serviço de sinalização alcançável para a conexão *inicial*. Uma sessão
  já estabelecida sobrevive à queda da sinalização.
- A retransmissão TURN tem custo de banda quando o caminho direto falha (NAT
  simétrico, VLAN de visitantes, isolamento de clientes no ponto de acesso).
  Fica registrado como linha de custo; espera-se que seja minoria, já que o
  cenário alvo é a mesma rede local.
- WebRTC em Rust (`webrtc-rs` / `str0m`) é uma dependência mais pesada que um
  servidor WebSocket.

**Deliberadamente adiado**
- Se o WebRTC se mostrar instável em algum navegador alvo, a saída é um caminho
  por WebSocket retransmitido pela sinalização — mais latência, mas o protocolo
  de aplicação em `packages/protocol` é independente de transporte justamente
  para que essa troca continue barata. É por isso que a camada de protocolo não
  assume a semântica do DataChannel.

## Validação realizada

- Situação e alcance do Acesso à Rede Local no Chrome — confirmado na
  documentação do Chrome for Developers, lançamento do Chrome 142.
- Comportamento dos candidatos ICE por mDNS e sua aplicabilidade apenas a
  navegadores — confirmado em material do WICG/IETF e nos rastreadores de bugs
  dos navegadores.

## Referências

- <https://developer.chrome.com/blog/local-network-access>
- <https://github.com/WICG/local-network-access/blob/main/explainer.md>
- <https://datatracker.ietf.org/meeting/103/materials/slides-103-rtcweb-mdns-ice-candidates-00>
- <https://bloggeek.me/psa-mdns-and-local-ice-candidates-are-coming/>
