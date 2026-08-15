# ADR-0004 — Modelo de segurança: identidade, pareamento e autorização

**Situação:** ACEITO
**Referências do mandato:** §13 (segurança), §12 (pareamento), §5 (permissão para ações de risco)
**Depende de:** [ADR-0002 Transporte](./ADR-0002-transporte.md)

## Contexto

O SLATE controla o computador de alguém. Um erro aqui não gera um bug: gera
execução remota de comandos na máquina de um cliente. Duas frases do mandato §13
são os requisitos que tudo aqui existe para satisfazer:

> Um dispositivo não pareado jamais deve controlar o PC.
> Um website arbitrário na LAN jamais deve conseguir chamar o Agent e executar comandos.

O transporte já está resolvido: WebRTC dá DTLS obrigatório, então o canal é
criptografado por construção. O que falta é responder *quem* está do outro lado
e *o que* essa pessoa pode fazer.

## Decisão

### 1. Identidade do dispositivo é um par de chaves, não um token

Cada dispositivo — Agente e cada celular/tablet — gera um par de chaves
**Ed25519** no primeiro uso. A chave pública é a identidade do dispositivo. Ela
nunca muda; se for necessário trocar, isso é um dispositivo novo.

**No Agente (Windows):** a chave privada é gerada e guardada em disco protegida
por **DPAPI** (`CryptProtectData`, escopo de usuário). O material fica atrelado à
conta de usuário do Windows — copiar o arquivo para outra máquina não serve.

**Na PWA (navegador):** a chave é gerada via WebCrypto com
`extractable: false` e persistida no **IndexedDB**, onde um `CryptoKey` é
estruturalmente clonável. O que fica guardado é uma referência ao material, não o
material.

> **Limite real desta escolha, declarado de propósito.** Uma chave
> não-extraível **não é uma primitiva de segurança contra código malicioso na
> própria página** — é resistência à exfiltração, não à utilização. Um XSS na PWA
> não consegue *ler* nem *copiar* a chave, mas consegue *usá-la para assinar*
> enquanto a página estiver aberta. Comprometimento do processo de renderização
> ou ataques de canal lateral podem, em teoria, extrair até chaves marcadas como
> não-extraíveis.
>
> Portanto a chave do navegador **não é tratada como o único fator de defesa**.
> É por isso que existem os escopos da §4 e a confirmação obrigatória da §5:
> mesmo com a chave em uso indevido, o dano é limitado ao que aquele dispositivo
> foi autorizado a fazer, e as ações realmente perigosas exigem confirmação
> física no PC. Alegar que a chave não-extraível "resolve XSS" seria falso.

### 2. Pareamento exige posse física do PC

Autenticar na conta **não é suficiente** para parear um dispositivo. Se fosse,
uma senha vazada viraria execução remota de comandos.

```
PWA                       Nuvem                    Agente (no PC)
 │                          │                          │
 │─ pedir pareamento ──────►│                          │
 │                          │─ notificar ─────────────►│
 │                          │                          │
 │◄─ código de 6 dígitos ───│                          │
 │                          │                          │
 │   usuário lê o código no celular e digita no PC ────►│
 │                          │                          │
 │                          │◄─ confirmar + assinar ───│
 │◄─ pareado ───────────────│                          │
```

O código curto vale **uma vez**, expira em **2 minutos** e tolera **3 tentativas**
antes de invalidar o pedido inteiro. Ele não é segredo criptográfico — é prova de
que quem pede está fisicamente na frente do PC. A segurança vem das chaves; o
código só amarra o pareamento à presença física.

Concluído o pareamento, cada lado guarda a **chave pública do outro**. Essa é a
raiz de confiança dali em diante.

### 3. A sinalização não consegue interceptar a conexão

Esta é a propriedade que justifica confiar num intermediário na nuvem.

No WebRTC, a oferta e a resposta SDP carregam o **fingerprint do certificado
DTLS** de cada lado. Cada dispositivo **assina seu próprio fingerprint com a
chave de longo prazo** antes de mandar para a sinalização, e cada lado verifica a
assinatura com a chave pública que guardou no pareamento.

Consequência: o serviço de sinalização pode ler, atrasar ou descartar mensagens
de negociação — mas **não pode se colocar no meio**, porque não consegue produzir
uma assinatura válida para um fingerprint diferente. Um servidor de sinalização
comprometido causa indisponibilidade, não interceptação.

### 4. Autorização é por escopo, e escopo é por dispositivo

Um dispositivo pareado não ganha poder total. Ele recebe escopos:

| Escopo | Permite |
|---|---|
| `state.read` | Receber estado: métricas, mídia, contexto |
| `deck.read` | Ler painéis e layouts |
| `deck.write` | Editar painéis, controles e vínculos |
| `action.execute` | Executar ações já configuradas |
| `action.define` | Criar ou alterar definições de ação |
| `system.media` | Controle de mídia e volume |
| `system.input` | Emular teclado e mouse |
| `system.process` | Abrir e focar aplicativos |
| `system.shell` | Executar comandos e scripts arbitrários |

O padrão de um dispositivo recém-pareado é `state.read`, `deck.read`,
`action.execute`, `system.media`. **`system.shell` e `action.define` nunca são
concedidos por padrão** e só podem ser habilitados na interface do Agente, no
próprio PC — nunca pela PWA, porque um dispositivo não pode ampliar os próprios
poderes.

Toda mensagem de comando é verificada contra os escopos do dispositivo **no
Agente**, no momento da execução. A PWA esconder um botão é conveniência de
interface; não é controle de acesso.

### 5. Tokens são curtos e provados por posse de chave

O acesso à sinalização usa um token de sessão de **5 minutos**, obtido por
desafio-resposta: o servidor manda um nonce, o dispositivo assina com sua chave,
o servidor verifica contra a chave pública registrada. Não existe segredo de
longa duração trafegando.

O canal de dados em si não usa token — a autenticação dele é o vínculo entre
chave de longo prazo e fingerprint DTLS descrito na §3.

### 6. Comandos resistem a repetição

Cada mensagem de comando carrega `nonce`, `timestamp` e um contador monotônico
por sessão. O Agente recusa:

- timestamp fora de uma janela de **30 segundos**;
- contador menor ou igual ao último aceito naquela sessão;
- nonce já visto na janela.

Isso impede que um comando capturado seja reenviado depois. Dentro de uma sessão
DTLS o próprio transporte já protege; as regras acima cobrem o caso de
reconexão e de troca de sessão.

### 7. Revogação funciona offline

Revogar um dispositivo remove a chave pública da conta **e** da lista local do
Agente. Como o Agente só aceita pares cuja chave pública ele conhece localmente,
a revogação vale mesmo se o Agente estiver sem internet — ele não precisa
consultar ninguém para recusar. A revogação sincroniza para a nuvem quando houver
conexão, mas não depende dela para ter efeito no PC.

## Modelo de ameaças

| Ameaça | Resultado | Por quê |
|---|---|---|
| Site qualquer na rede local tenta falar com o Agente | Falha | Sem chave pareada, não há canal. E o Agente não expõe porta HTTP local ([ADR-0002](./ADR-0002-transporte.md)) |
| Senha da conta vazada | Não vira controle do PC | Parear exige o código de 6 dígitos digitado no próprio PC |
| Sinalização comprometida | Indisponibilidade, não interceptação | Fingerprint DTLS assinado com chave de longo prazo (§3) |
| Rede local hostil / Wi-Fi público | Sem impacto | DTLS ponta a ponta; a rede só transporta bytes cifrados |
| Celular roubado | Contido por revogação | Chave revogada localmente no Agente; vale offline |
| Comando capturado e reenviado | Recusado | Nonce, janela de tempo e contador (§6) |
| **XSS na PWA** | **Contido, não eliminado** | A chave não pode ser exfiltrada, mas pode ser usada enquanto a página estiver aberta. Limitado pelos escopos; `system.shell` exige habilitação no PC |
| Agente adulterado no disco | Fora do alcance | Se o atacante já executa código como o usuário no PC, o SLATE é irrelevante — ele já tem o que queria |

A linha do XSS é a mais fraca e está declarada como tal. As defesas são
Content-Security-Policy estrita, ausência de `dangerouslySetInnerHTML`, escopos
mínimos por padrão e confirmação para ações destrutivas — não a suposição de que
a chave é inviolável.

## Regras de implementação

- Segredos existem apenas em variáveis de ambiente da plataforma. Nunca em
  commit, nunca no frontend, nunca em log (§53).
- Log nunca registra chave, token, nonce ou conteúdo de comando de shell.
  Registra identificador do dispositivo, ação e resultado.
- Toda mensagem recebida é validada contra schema antes de qualquer uso.
- Limite de taxa por dispositivo na sinalização e no Agente.
- Origem verificada nos endpoints da nuvem; sem `Access-Control-Allow-Origin: *`
  em rota autenticada.
- Nenhuma porta de desenvolvimento fica ativa em build de produção.

## Consequências

**A favor**
- Nem a nuvem nem a rede conseguem ler ou forjar comandos.
- Uma conta comprometida não vira máquina comprometida.
- Revogação é imediata e não depende de conectividade.
- O poder de cada dispositivo é explícito e auditável.

**Custos aceitos**
- O pareamento tem um passo a mais (digitar 6 dígitos no PC). É deliberado: é
  exatamente esse passo que separa "invadiram minha conta" de "invadiram meu
  computador".
- Gerenciar chaves é mais trabalho que emitir um token.
- Trocar de celular exige parear de novo.

**Deliberadamente adiado**
- Attestation de dispositivo e vinculação a hardware: dependeria de recurso que a
  web não oferece de forma portátil.
- Assinatura por ação com confirmação no PC para *toda* ação de shell: hoje o
  escopo é concedido uma vez. Se a telemetria mostrar que `system.shell` está
  sendo habilitado sem critério, isso vira confirmação por execução.

## Validação realizada

- Persistência de `CryptoKey` não-extraível em IndexedDB e o limite real dessa
  propriedade — confirmado na orientação do W3C Web Crypto e em discussão
  pública de implementadores, que a descrevem explicitamente como resistência à
  extração e **não** como primitiva contra comprometimento da página.
- Presença do fingerprint DTLS no SDP como base para vinculação de identidade —
  propriedade padrão do WebRTC, já usada por este desenho no
  [ADR-0002](./ADR-0002-transporte.md).

## Referências

- <https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/11-Client-side_Testing/12-Testing_Browser_Storage>
- <https://learn.microsoft.com/windows/win32/api/dpapi/nf-dapi-cryptprotectdata>
