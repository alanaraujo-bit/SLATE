# Agente do SLATE

O programa que roda no computador. É ele que confirma o pareamento de um
celular ou tablet, e — quando o transporte estiver pronto — quem vai executar
os comandos.

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

```bash
cd apps/desktop/src-tauri
cargo tauri build
```

O resultado sai em `target/release/bundle/nsis/SLATE_<versão>_x64-setup.exe`.

> O instalador **não é assinado**. O Windows vai mostrar um aviso do SmartScreen
> na primeira execução até haver um certificado
> ([AÇÃO-002](../../docs/operator/OPERATOR_ACTIONS.md)).

## Como testar o pareamento de ponta a ponta

1. Abra <https://slate.aionixdev.com> no celular e crie uma conta.
2. Abra o Agente no computador e entre com **a mesma conta**.
3. No celular, toque em **Parear este aparelho** — aparece um código de seis
   dígitos, válido por dois minutos.
4. Digite esse código no Agente e confirme.
5. O aparelho passa a aparecer na lista dos dois lados.

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
- **Não há execução de ações ainda.** O Agente pareia, e é só. O canal de
  comunicação em tempo real é a próxima etapa.
