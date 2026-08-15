# ADR-0005 — Contas, sessões e onde o servidor roda

**Situação:** ACEITO
**Referências do mandato:** §43 (autenticação), §14 (nuvem), §19 (custo), §33 (sem microsserviço prematuro)
**Depende de:** [ADR-0004 Segurança](./ADR-0004-seguranca.md)

## Contexto

O SLATE tem **dois clientes, e só um é navegador**:

- a **PWA**, que precisa de sessão de navegador com cookie;
- o **Agente Desktop**, um processo Rust que se autentica por desafio-resposta
  com a chave do dispositivo, conforme o [ADR-0004 §5](./ADR-0004-seguranca.md).

Os dois precisam concordar sobre *qual conta* é qual, porque é a conta que
agrupa os dispositivos que podem parear entre si.

## Decisão 1 — Sessões próprias, não uma biblioteca de autenticação para web

Bibliotecas como Auth.js resolvem muito bem o caso de um site com login. O que
pesa aqui é outro: **elas só atendem metade dos clientes**.

O Agente Rust não roda Auth.js. O caminho de autenticação dele — nonce assinado
com a chave do dispositivo — precisa existir de qualquer forma. Adotar uma
biblioteca para o navegador significaria manter **dois sistemas de sessão sem
relação entre si**, cada um com seu formato, sua expiração e sua revogação, e
depois fazê-los concordar sobre a mesma conta. A superfície de erro dessa
costura é maior que a de uma sessão opaca em banco.

Há também um detalhe documentado que empurra na mesma direção: no Auth.js, o
provedor de credenciais "não persiste dados no banco" por padrão — a
combinação de login por senha com sessão em banco exige lógica adicional
escrita à mão. Ou seja, mesmo adotando a biblioteca, parte deste trabalho
continuaria sendo nosso.

**O que fica explícito, porque é o risco real desta escolha:** implementar
autenticação é mais arriscado do que usá-la pronta. A mitigação não é confiança
— é escopo estreito e verificação:

- **Nenhuma primitiva criptográfica é inventada.** Senha usa `scrypt` do
  `node:crypto`, comparação usa `timingSafeEqual`, token de sessão vem de
  `randomBytes`. Não há hash caseiro, não há JWT assinado à mão.
- **A sessão é opaca**: um valor aleatório de 256 bits cujo *hash* fica no
  banco. Não carrega dados, não é decodificável, e não precisa de rotação de
  chave de assinatura.
- Cada propriedade abaixo vira teste, e não comentário.

Se o custo de manutenção disto crescer, a saída é adotar uma biblioteca para o
lado web mantendo o caminho do Agente — o modelo de conta não muda.

## Decisão 2 — Um serviço de servidor, no Railway

Todo o lado servidor vai para um único serviço em `services/api`, no Railway,
com o mesmo Dockerfile já comprovado no projeto.

Duas razões concretas:

1. **A Vercel está bloqueada** para esta conta ([AÇÃO-003](../operator/OPERATOR_ACTIONS.md)).
   Colocar as rotas dentro da PWA faria a autenticação herdar um bloqueio que
   não tem nada a ver com ela.
2. **O Agente não deve depender da PWA estar no ar.** São ciclos de vida
   diferentes; acoplar os dois é criar uma falha que não precisa existir.

Não é microsserviço prematuro (§33): é **um** serviço para todo o servidor. A
sinalização WebRTC ([ADR-0002](./ADR-0002-transporte.md)) mora nele quando
chegar, em vez de virar um segundo serviço.

## Decisão 3 — Recuperação de conta é declarada agora, não descoberta depois

Sem recuperação, esquecer a senha custa **todos os dispositivos pareados e todos
os painéis** da pessoa. Isso é grave demais para virar surpresa.

Enviar e-mail exige credencial de um provedor, que só o operador pode fornecer.
Então:

- o fluxo é implementado **inteiro** — token de uso único, expiração curta,
  invalidação das sessões ao trocar a senha;
- o envio fica atrás de uma interface com uma implementação que **registra em
  log em vez de enviar**, e que se recusa a rodar em produção;
- registrado como [AÇÃO-004](../operator/OPERATOR_ACTIONS.md);
- **a tela de cadastro diz, no momento do cadastro**, que a recuperação por
  e-mail ainda não está ativa. Deixar isso implícito seria enganar sobre uma
  consequência séria (§29, §59).

## Especificação

| Item | Valor | Motivo |
|---|---|---|
| Hash de senha | `scrypt`, N=2^15, r=8, p=1, 64 bytes | Padrão da plataforma, custo de memória alto contra hardware dedicado |
| Sal | 16 bytes por senha | Impede tabela pré-computada compartilhada |
| Formato guardado | `scrypt$N$r$p$sal$hash` | Os parâmetros viajam com o hash, então aumentá-los depois não invalida senhas antigas |
| Token de sessão | 32 bytes aleatórios, base64url | Opaco; nada a decodificar |
| Guardado como | SHA-256 do token | Vazamento do banco não entrega sessões utilizáveis |
| Validade | 30 dias, deslizante | Superfície de controle é ferramenta de uso diário |
| Cookie | `HttpOnly`, `SameSite=Lax`, `Secure`, `Path=/` | `Lax` permite voltar de um link externo; `Strict` quebraria isso sem ganho real |
| Rotação | Token novo a cada login | Fecha fixação de sessão |
| Comparação | `timingSafeEqual` | Comparação que sai cedo vaza o valor pelo tempo |
| Tentativas | Limitadas por conta e por origem | Senha fraca é comum; força bruta não pode ser barata |

## Consequências

**A favor**
- Um modelo de conta, dois caminhos de autenticação que concordam entre si.
- Sem dependência de serviço externo para funcionar hoje.
- Sem bloqueio herdado da Vercel.

**Contra, e assumido**
- Autenticação escrita por nós é responsabilidade nossa para sempre.
- Sem OAuth no início: entrar com Google ou GitHub exige credenciais do
  operador e entra depois, sem mudar o modelo de conta.

**Armadilha conhecida**
- `Secure` em cookie não tem efeito em `http://localhost`, então um teste local
  passa mesmo com a configuração errada. A verificação de cookie precisa rodar
  ao menos uma vez contra HTTPS de verdade antes deste marco fechar.

## Decisão 4 — PWA e API compartilham o domínio registrável

Consequência direta de `SameSite=Lax`, e ela restringe a implantação:

Um cookie `Lax` **não acompanha requisições entre sites diferentes** — nem POST,
nem `fetch` disparado por script. E "site" é calculado pelo domínio registrável
(eTLD+1); **a porta não entra na conta**.

Na prática:

| PWA | API | Mesmo site? | Sessão funciona? |
|---|---|---|---|
| `localhost:4400` | `localhost:4500` | sim | sim |
| `slate.aionixdev.com` | `api.aionixdev.com` | sim | sim |
| `slate.vercel.app` | `slate.up.railway.app` | **não** | **não** |

A última linha é exatamente o que aconteceria com os domínios que as
plataformas dão de graça. Descobrir isso em produção significaria um login que
aparenta funcionar e uma sessão que some na requisição seguinte.

Então a implantação exige subdomínios do mesmo domínio — registrado como
[AÇÃO-005](../operator/OPERATOR_ACTIONS.md). Em desenvolvimento nada disso
aparece, porque duas portas de `localhost` já são o mesmo site: é precisamente o
tipo de diferença que só apareceria depois.

As alternativas foram consideradas e descartadas:

- **`SameSite=None`** funcionaria entre sites, mas devolve a exposição a CSRF
  que o `Lax` remove de graça.
- **Token em cabeçalho `Authorization`** dispensaria cookie, mas obrigaria a
  guardar o token onde o JavaScript alcança — perdendo o `HttpOnly`, que é a
  única barreira real contra uma injeção de script na PWA.

Manter `Lax` com `HttpOnly` e pagar com uma exigência de DNS é o melhor
resultado dos três. Como defesa adicional, o servidor confere o cabeçalho
`Origin` em toda requisição que altera estado, o que não depende do
comportamento do cookie.
