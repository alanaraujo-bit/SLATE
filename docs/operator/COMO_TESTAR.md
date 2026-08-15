# Como testar o SLATE hoje

O que já dá para experimentar, o que ainda não existe, e como rodar cada peça.

---

## O que funciona hoje

- Criar conta e entrar, pelo celular ou pelo computador.
- Instalar a PWA na tela inicial do aparelho.
- Abrir a aplicação sem internet — ela continua abrindo e diz que está sem rede.
- Pedir o pareamento e receber o código de seis dígitos.

## O que ainda não existe

- **Confirmar o pareamento.** Quem confirma é o SLATE rodando no computador, e
  o Agente Desktop ainda está sendo construído. O código aparece no celular,
  mas ainda não há onde digitá-lo.
- **Controles.** Não há grade de botões, porque não há canal de comunicação com
  o computador ainda. Uma tela de botões que não comandam nada seria promessa
  disfarçada de produto.

Nada disso está escondido atrás de "em breve": a aplicação diz o que é verdade
em cada tela.

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

## Testar na sua máquina

Os três processos são independentes e podem rodar ao mesmo tempo.

```bash
pnpm install

# Painel de acompanhamento do projeto — http://localhost:4300
pnpm roadmap:ui
```

Para a PWA e a API localmente, cada uma precisa saber onde está o banco e a
outra:

```bash
# API — http://localhost:4500
cd services/api
DATABASE_URL="<url do Postgres>" PORT=4500 pnpm exec tsx src/main.ts

# PWA — http://localhost:4400
cd apps/pwa
API_URL=http://localhost:4500 pnpm run build
pnpm exec next start -p 4400
```

> A PWA fala com a API por `/api`, na própria origem. Isso não é organização:
> um cookie de sessão apontando para outra origem não é enviado de volta pelo
> WebKit, que é o motor de todo navegador no iPhone e no iPad.

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
