# Como testar o SLATE hoje

O que já dá para experimentar, o que ainda não existe, e como rodar cada peça.

---

## O que funciona hoje

- Criar conta e entrar, pelo celular ou pelo computador.
- Instalar a PWA na tela inicial do aparelho.
- Abrir a aplicação sem internet — ela continua abrindo e diz que está sem rede.
- Parear o celular com o computador, das duas formas: código de seis dígitos
  digitado no Agente, ou QR Code exibido no Agente e lido pelo celular.
- Reproduzir/pausar a mídia do computador pelo celular, por WebRTC.
- Comandar a mídia inteira: faixa, parada, volume e mudo.
- Cadastrar programas do computador (`.exe`) e abri-los pelo celular, com o
  ícone do próprio programa aparecendo na tecla.
- Abrir YouTube, Twitch, Netflix, Prime Video, Disney+ e Spotify.
- **Montar painéis** — vários conjuntos de atalhos, cada um com nome, cor,
  número de colunas e páginas próprias, trocáveis com um toque no celular.

## O que ainda não existe

- **Sequências e condições.** Uma tecla executa uma ação. Encadear várias,
  com atraso ou condição, ainda não existe.
- **Troca automática de painel.** Hoje quem troca de painel é quem está com o
  celular na mão; o painel não muda sozinho conforme o programa em foco no
  computador.

Nada disso está escondido atrás de "em breve": a aplicação diz o que é verdade
em cada tela.

---

## Testar os painéis, de ponta a ponta

Este é o caminho novo, e o que mais vale conferir. Ele atravessa as duas
pontas: o painel é montado no computador e usado no celular.

**No computador, na janela do SLATE:**

1. Aba **Programas** → *Adicionar programa*. Escolha um `.exe` (um jogo, o
   navegador, o OBS). O ícone é extraído do próprio arquivo.
2. Aba **Aparelhos** → marque a permissão de abrir programas **para aquele
   celular**. Sem isso o painel não chega: a permissão é por aparelho, e é
   dada aqui de propósito — nunca pela conta.
3. Aba **Painéis** → *Novo painel*. Dê um nome ("Ao vivo", "Cinema"), escolha
   a cor, o número de colunas em pé e deitado, e vá acrescentando controles.
   A prévia mostra o telefone como ele vai ficar.

**No celular:**

4. As abas dos painéis aparecem no topo. Toque para trocar de painel.
5. Arraste para o lado para passar de página, ou use as setas embaixo.
6. Gire o aparelho: a grade passa a usar o número de colunas de deitado.

**O que conferir, e que já quebrou antes:**

- Mexer num painel na janela muda o celular **na hora**, sem reconectar e sem
  fechar o aplicativo. Se só mudar depois de reabrir, o reanúncio do deck
  parou de funcionar.
- Um painel com muitos programas continua chegando inteiro. A lista viaja
  fatiada porque cada ícone é um PNG embutido, e os painéis vão na primeira
  fatia — se sumirem justamente quando há muitos programas, é aí que olhar.
- Cada serviço aparece com a cor dele (Netflix vermelho, Prime ciano, Disney
  azul). Todos da mesma cor significa que a cor da tecla está vencendo a da
  marca.

---

## Testar pelo celular (recomendado)

É para isso que o produto existe, e é onde vale a pena olhar.

**Endereço:** <https://slate.aionixdev.com>

> Publicada na Vercel, sob o domínio da Aionixdev. A API fica no Railway, e a
> PWA fala com ela por `/api` na própria origem — o navegador enxerga um
> endereço só, que é o que mantém o cookie de sessão funcionando em qualquer
> navegador.
>
> **Ao trocar o domínio, a API precisa saber.** Ela valida a origem por
> comparação exata, então um domínio novo é recusado com 403 até entrar em
> `ORIGENS_PERMITIDAS`, no serviço `slate-api` do Railway. Isso é proposital:
> uma verificação tolerante aceitaria domínios que apenas se parecem com o
> certo.

1. Abra o endereço no celular.
2. Crie uma conta. Guarde a senha: a recuperação por e-mail ainda não está
   ativa ([AÇÃO-004](./OPERATOR_ACTIONS.md)), e a tela avisa isso no cadastro.
3. Instale na tela inicial:
   - **Android/Chrome:** menu ⋮ → *Adicionar à tela inicial*.
   - **iPhone/Safari:** botão de compartilhar → *Adicionar à Tela de Início*.
4. Abra pelo ícone. Deve abrir **sem a barra de endereço** — se aparecer barra
   do navegador, a instalação não pegou.
5. Toque em **Parear este aparelho**. O código de seis dígitos aparece com uma
   contagem regressiva de dois minutos.

### O que vale reparar

- Ligue o modo avião com a aplicação aberta: o indicador no topo passa a dizer
  **Sem internet**, e volta sozinho quando a rede retorna.
- Feche e reabra sem rede: a aplicação abre mesmo assim.
- Recarregue depois de entrar: você continua conectado.

---

## Testar na sua máquina, com a conta de verdade

Este é o ciclo curto: mudar o código, recarregar, ver no celular. Sem build,
sem deploy, sem release nova do Agente.

```bash
pnpm install
pnpm dev:local
```

**Uma vez, antes da primeira execução:**

1. Cole a URL pública do Postgres em `services/api/.env.local`, na linha
   `DATABASE_URL=`. Ela está no painel do Railway, no serviço do banco — use a
   pública, não a `*.railway.internal`, que só resolve dentro da rede deles. O
   arquivo é ignorado pelo git.
2. Instale o `cloudflared`: `winget install --id Cloudflare.cloudflared`.

O script confere as duas coisas antes de subir qualquer processo e imprime, no
fim, o endereço HTTPS para abrir no celular e no navegador.

### O Agente, sem gerar release

```bash
cd apps/desktop
SLATE_API_URL=http://localhost:4500 pnpm tauri dev
```

A interface recarrega ao salvar; mudança no Rust recompila sozinha. Usa a mesma
identidade e a mesma pasta de dados do SLATE instalado, então não aparece um
computador duplicado na conta — mas feche o instalado antes, para os dois não
disputarem a mesma sinalização.

### Por que túnel, e não o endereço da máquina na rede local

A câmera do leitor de QR e o service worker só existem em contexto seguro. Um
`http://` num IP da rede não é contexto seguro, e no iPhone não há atalho para
contornar isso — o Safari simplesmente não oferece a câmera.

São **dois** túneis, um para a PWA e outro para a sinalização, porque são dois
protocolos: a PWA fala HTTP na 4400 e repassa `/api` para a 4500 do lado do
servidor, enquanto a sinalização é um WebSocket que sobe direto do navegador.

> **O túnel é público enquanto o script roda.** O endereço é sorteado e
> impossível de adivinhar, e a API continua exigindo login — mas ela está
> ligada ao banco de **produção**. Feche com `Ctrl+C` quando terminar; os
> endereços morrem junto.

> A PWA fala com a API por `/api`, na própria origem. Isso não é organização:
> um cookie de sessão apontando para outra origem não é enviado de volta pelo
> WebKit, que é o motor de todo navegador no iPhone e no iPad.

> A API confere a origem por igualdade exata, então o endereço sorteado do
> túnel entra em `ORIGENS_PERMITIDAS` a cada execução — é o que o script faz
> antes de subir a API. Afrouxar a conferência para aceitar qualquer
> `trycloudflare.com` trocaria uma linha de script por um buraco permanente.

---

## Se algo parecer errado

| Sintoma | O que provavelmente é |
|---|---|
| "Servidor fora de alcance" | A API não está no ar, ou o aparelho está sem rede |
| Login funciona e some ao recarregar | O cookie não está sendo aceito — conferir HTTPS e origem |
| Não aparece a opção de instalar | O `manifest` ou o service worker não carregaram; conferir se é HTTPS |
| Código de pareamento expira | Ele vale dois minutos por decisão; peça outro |

---

## Acompanhar a construção

O painel mostra o progresso real, calculado a partir do que foi concluído — não
um número escrito à mão:

```bash
pnpm roadmap:ui     # http://localhost:4300
```
