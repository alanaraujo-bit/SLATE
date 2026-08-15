# Agente do SLATE

O programa que roda no computador. Ele confirma o pareamento de um celular ou
tablet, mantém o canal WebRTC e executa somente comandos registrados e
autorizados. A versão 0.1.1 inclui o primeiro: reproduzir/pausar mídia no
Windows.

## Como rodar durante o desenvolvimento

```bash
pnpm install

cd apps/desktop/src-tauri
cargo tauri dev
```

Por padrão o Agente fala com a API publicada. Para apontar para uma API local:

```bash
SLATE_API_URL=http://localhost:4500 cargo tauri dev
```

## Como gerar o instalador

```powershell
pnpm --filter @slate/desktop instalador
```

O resultado sai em
`apps/desktop/src-tauri/target/release/bundle/nsis/SLATE_<versão>_x64-setup.exe`.
O mesmo build assina o instalador e gera `SLATE_<versão>_x64-setup.exe.sig`,
usado pelo atualizador automático. O script se recusa a gerar uma release sem a chave
guardada fora do repositório em `%LOCALAPPDATA%\Aionixdev\SLATE\release`.

> O pacote de atualização já recebe assinatura criptográfica própria e o Agente
> recusa qualquer alteração. O instalador `.exe` ainda **não tem Authenticode**;
> o Windows vai mostrar um aviso do SmartScreen
> na primeira execução até haver um certificado
> ([AÇÃO-002](../../docs/operator/OPERATOR_ACTIONS.md)).

## Como publicar uma atualização

1. Atualize a mesma versão em `package.json`, `src-tauri/Cargo.toml` e
   `src-tauri/tauri.conf.json`.
2. Registre as mudanças da versão em português.
3. Crie e envie uma tag exatamente no formato `slate-vX.Y.Z`.
4. O workflow **Publicar Agente Desktop** testa, gera o NSIS, assina o pacote,
   publica a release e produz o `latest.json`.

O Agente consulta atualizações oito segundos depois de abrir e novamente a cada
seis horas. A busca não interrompe o uso e falhas de internet silenciosas não
viram alarme. Quando há versão nova, a pessoa escolhe baixar ou adiar, acompanha
o progresso real e é avisada antes de o programa reiniciar.

Como este repositório é privado, a API faz a leitura servidor-servidor da release
e entrega apenas um redirecionamento temporário ao pacote. A configuração
operacional está na [AÇÃO-008](../../docs/operator/OPERATOR_ACTIONS.md).

## Como testar o pareamento de ponta a ponta

1. Abra <https://slate.aionixdev.com> no celular e entre na mesma conta do
   Agente.
2. No Agente, mantenha **QR Code** selecionado. Na PWA, toque em **Ler QR Code**,
   aponte a câmera para o computador e confirme o nome exibido.
3. Se preferir, selecione **Código** no Agente e **Usar código de 6 dígitos**
   na PWA. Digite no computador o código temporário mostrado pelo celular.
4. O aparelho passa a aparecer na lista dos dois lados. O convite QR e o código
   expiram em dois minutos e só podem ser usados uma vez.

## Como testar o primeiro controle real

1. Instale `SLATE_0.1.2_x64-setup.exe` por cima da versão atual.
2. Abra um aplicativo de música ou vídeo no Windows e inicie a reprodução.
3. Mantenha o Agente aberto e espere o PWA indicar **Conectado**.
4. No celular, toque em **Reproduzir / pausar**.
5. A mídia deve mudar de estado e o celular deve confirmar **Comando executado
   no computador.**

Versões anteriores não anunciam a capacidade `action.media`; por isso a PWA
pede para atualizar o Agente em vez de mostrar um botão que terminaria em erro.

## Por que o código é digitado no computador, e não o contrário

Essa direção não é detalhe de interface: é o que separa "invadiram minha conta"
de "invadiram meu computador".

Entrar na conta prova que alguém sabe a senha. Digitar o código **neste
computador** prova que a pessoa está fisicamente na frente dele. Sem esse
segundo passo, uma senha vazada bastaria para controlar a máquina de outra
pessoa — e o SLATE executa comandos reais.

O Agente é a exceção justamente por isso: ele se registra sem código, porque
estar rodando aqui já é a prova que o código existiria para suprir.

## Onde ficam os segredos

A chave privada deste computador é gerada uma vez e guardada protegida por
**DPAPI**, o que a atrela à conta de usuário do Windows: copiar o arquivo para
outra máquina não devolve a chave.

A chave e o cookie de sessão vivem no processo em Rust. A janela é só
apresentação e não alcança nenhum dos dois, então uma falha no conteúdo exibido
não expõe a identidade do computador.

## Testes

```bash
cd apps/desktop/src-tauri
cargo test
```

Entre eles há um que lê o arquivo de identidade em disco e **falha se encontrar
a chave em texto claro**.

## Pendências conhecidas

- **Fora do Windows** a chave fica sem proteção adicional. Existe só para o
  projeto compilar em outros sistemas durante o desenvolvimento; antes de haver
  Agente para macOS ou Linux, isso precisa virar o cofre de credenciais de cada
  sistema.
- O Motor de Ações ainda não compõe fluxos e só tem a ação registrada de
  reproduzir/pausar mídia. Teclas arbitrárias nunca são aceitas do canal.
- A publicação da primeira atualização depende da configuração operacional das
  [AÇÕES-008 e 009](../../docs/operator/OPERATOR_ACTIONS.md). O código não trata
  a ausência dessas credenciais como se a distribuição estivesse pronta.
