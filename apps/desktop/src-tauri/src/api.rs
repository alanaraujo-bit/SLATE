use crate::identidade::{desproteger, proteger};
use reqwest_cookie_store::CookieStoreMutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Cliente da API do SLATE.
///
/// O cookie de sessão vive neste processo, num armazenamento próprio do
/// cliente HTTP — fora do alcance da interface. Isso é o que dispensa toda a
/// discussão de origem e `SameSite` que existe do lado da PWA: o Agente não é
/// um navegador e não carrega as restrições de um.
///
/// Esse armazenamento também é gravado em disco. Sem isso a sessão morria com o
/// processo, e um Agente que abre com o Windows pedia e-mail e senha a cada
/// reinício — o cookie tem trinta dias de validade e nenhum deles sobrevivia ao
/// primeiro fechamento. O arquivo é protegido pelo mesmo DPAPI da chave
/// privada: o cookie é uma credencial ao portador, tão útil a quem o roube
/// quanto a própria senha.

/// Nome do arquivo de sessão dentro da pasta de dados do aplicativo.
const ARQUIVO_SESSAO: &str = "sessao.bin";

#[derive(Debug, thiserror::Error)]
pub enum ErroApi {
    #[error("não foi possível falar com o servidor")]
    SemConexao,
    #[error("credenciais inválidas")]
    CredenciaisInvalidas,
    #[error("é preciso entrar na conta primeiro")]
    NaoAutenticado,
    // Estes três erros falam do aparelho que está sendo pareado, nunca deste
    // computador — dizer "este computador" mandava procurar o problema no
    // lugar errado.
    #[error("este aparelho já está registrado em outra conta")]
    ChaveDeOutraConta,
    #[error("este aparelho foi removido da conta: peça um código novo no celular")]
    DispositivoRevogado,
    // Dizer só "esta chave já está registrada com outra função" descrevia o
    // banco de dados e não dava saída nenhuma a quem está na frente da tela. A
    // saída existe e é no celular: pedir o pareamento de novo faz o aparelho
    // chegar com uma identidade nova, que ninguém tem.
    #[error("este aparelho tem um cadastro preso na conta: peça o pareamento de novo no celular")]
    ChaveJaRegistrada,
    #[error("nenhum pareamento em andamento")]
    NenhumPedido,
    /// A conta não reconhece a identidade deste computador — acontece quando a
    /// chave daqui ficou registrada em outra conta. Sem esta linha o caso saía
    /// como "resposta inesperada (401)", que não diz nada a quem lê.
    #[error("este computador não está registrado nesta conta")]
    AgenteInvalido,
    #[error("código incorreto — restam {restantes} tentativa(s)")]
    CodigoIncorreto { restantes: u32 },
    #[error("tentativas esgotadas: peça um código novo no celular")]
    Bloqueado,
    /// Falha do lado do servidor, já registrada lá. Separado de `Inesperado`
    /// porque a reação é diferente: aqui vale tentar de novo.
    #[error("algo deu errado no servidor — tente de novo em instantes")]
    ErroInterno,
    #[error("esse e-mail não parece válido")]
    EmailInvalido,
    /// A senha não passou nas regras do servidor. As mensagens vêm de lá —
    /// repeti-las aqui faria duas listas que divergem no dia em que uma mudar.
    #[error("{0}")]
    SenhaFraca(String),
    /// Cadastro de um e-mail que já tem conta.
    ///
    /// A API responde **sucesso sem sessão** nesse caso, de propósito: dizer
    /// "e-mail já cadastrado" entregaria quais endereços têm conta. Este erro é
    /// construído aqui, a partir da ausência de sessão, e existe só para virar
    /// uma orientação útil na tela em vez de um formulário que não sai do lugar.
    #[error("se você já tem conta com esse e-mail, entre com sua senha")]
    TalvezJaTenhaConta,
    #[error("o servidor respondeu de forma inesperada ({0})")]
    Inesperado(u16),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usuario {
    pub id: String,
    pub email: String,
    pub nome: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RespostaUsuario {
    usuario: Usuario,
}

/// A resposta do cadastro.
///
/// `usuario` é opcional, e a opcionalidade **é** o contrato: um cadastro com
/// e-mail já existente responde 201 sem ele e sem sessão, para não revelar
/// quais endereços têm conta. Torná-lo obrigatório faria esse caso virar erro
/// de leitura de JSON, e a pessoa veria "resposta inesperada" em vez da
/// orientação de entrar com a senha.
#[derive(Debug, Deserialize)]
struct RespostaCadastro {
    #[serde(default)]
    usuario: Option<Usuario>,
}

#[derive(Debug, Deserialize)]
struct RespostaErro {
    erro: Option<String>,
    #[serde(rename = "tentativasRestantes")]
    tentativas_restantes: Option<u32>,
    /// As regras de senha reprovadas, quando o cadastro falha por senha fraca.
    /// A mensagem de cada uma vem pronta do servidor.
    #[serde(default)]
    problemas: Option<Vec<ProblemaSenha>>,
}

#[derive(Debug, Clone, Deserialize)]
struct ProblemaSenha {
    mensagem: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dispositivo {
    pub id: String,
    pub nome: String,
    pub papel: String,
    pub situacao: String,
    #[serde(rename = "chavePublica")]
    pub chave_publica: String,
    pub algoritmo: String,
    pub escopos: Vec<String>,
    /// Presença no servidor de sinalização. Ausente nos pares confiáveis já
    /// gravados em disco, que foram escritos antes deste campo existir — daí o
    /// padrão, em vez de recusar o arquivo inteiro.
    #[serde(default)]
    pub online: bool,
}

#[derive(Debug, Deserialize)]
struct RespostaDispositivos {
    dispositivos: Vec<Dispositivo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesafioSinalizacao {
    pub desafio_id: String,
    pub dispositivo_id: String,
    pub nonce: String,
    pub expira_em: i64,
    pub url_sinalizacao: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenSinalizacao {
    pub token: String,
    pub expira_em: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvitePareamentoQr {
    pub convite_id: String,
    pub expira_em: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SituacaoConviteQr {
    pub situacao: String,
    pub dispositivo: Option<Dispositivo>,
}

pub struct ClienteApi {
    http: reqwest::Client,
    base: String,
    cookies: Arc<CookieStoreMutex>,
    /// `None` quando não há pasta de dados utilizável — nos testes, por
    /// exemplo. A sessão continua funcionando, só não sobrevive ao fechamento.
    arquivo_sessao: Option<PathBuf>,
}

impl ClienteApi {
    /// Cria o cliente sem persistir a sessão em disco.
    ///
    /// Existe só para os testes: no Agente de verdade, um cliente que não
    /// grava a sessão é exatamente o defeito que `com_sessao` corrige, e
    /// deixá-lo disponível convidaria a reintroduzi-lo sem querer.
    #[cfg(test)]
    pub fn novo(base: impl Into<String>) -> Arc<Self> {
        Self::montar(base, None)
    }

    /// Cria o cliente restaurando a sessão gravada na pasta de dados.
    ///
    /// Uma sessão ilegível — arquivo corrompido, ou protegido por outra conta
    /// do Windows — não é falha fatal: vale exatamente o mesmo que não ter
    /// sessão nenhuma, e a pessoa entra de novo. Derrubar o Agente por causa
    /// disso trocaria um login por um programa que não abre.
    pub fn com_sessao(base: impl Into<String>, pasta: &Path) -> Arc<Self> {
        Self::montar(base, Some(pasta.join(ARQUIVO_SESSAO)))
    }

    fn montar(base: impl Into<String>, arquivo_sessao: Option<PathBuf>) -> Arc<Self> {
        let cookies = Arc::new(CookieStoreMutex::new(
            arquivo_sessao
                .as_deref()
                .and_then(ler_sessao_do_disco)
                .unwrap_or_default(),
        ));

        let http = reqwest::Client::builder()
            // Guarda os cookies entre requisições: é assim que a sessão
            // sobrevive de uma chamada para a próxima. O provedor explícito
            // substitui `cookie_store(true)`, que usaria um armazenamento
            // interno inacessível — e portanto impossível de gravar.
            .cookie_provider(cookies.clone())
            .user_agent(concat!("SLATE-Agente/", env!("CARGO_PKG_VERSION")))
            // Um agente residente não pode ficar preso numa requisição que não
            // volta — ele congelaria sem dizer por quê.
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("cliente HTTP");

        Arc::new(Self {
            http,
            base: base.into().trim_end_matches('/').to_string(),
            cookies,
            arquivo_sessao,
        })
    }

    /// Grava a sessão atual em disco.
    ///
    /// Chamado depois da entrada, que é o único momento em que a API emite um
    /// `Set-Cookie` de sessão nova — `exigirSessao` renova a validade no banco
    /// sem reenviar o cookie. Falhar aqui não desfaz a entrada: a pessoa está
    /// logada agora, e o preço do erro é ter de entrar de novo depois.
    fn guardar_sessao(&self) {
        let Some(caminho) = self.arquivo_sessao.as_ref() else {
            return;
        };

        let mut serializado = Vec::new();
        {
            let Ok(loja) = self.cookies.lock() else { return };
            // `save_incl_expired_and_nonpersistent` gravaria lixo; a variante
            // simples guarda só o que tem validade futura, que é justamente o
            // `slate_sessao` de trinta dias.
            if cookie_store::serde::json::save(&loja, &mut serializado).is_err() {
                return;
            }
        }

        let Ok(protegido) = proteger(&serializado) else {
            return;
        };
        if let Some(pasta) = caminho.parent() {
            let _ = std::fs::create_dir_all(pasta);
        }
        let _ = std::fs::write(caminho, protegido);
    }

    /// Apaga a sessão gravada.
    ///
    /// Sair precisa apagar o arquivo, e não só limpar a memória: um logout que
    /// deixa a credencial em disco não é um logout.
    fn descartar_sessao(&self) {
        if let Ok(mut loja) = self.cookies.lock() {
            loja.clear();
        }
        if let Some(caminho) = self.arquivo_sessao.as_ref() {
            let _ = std::fs::remove_file(caminho);
        }
    }

    fn url(&self, caminho: &str) -> String {
        format!("{}{}", self.base, caminho)
    }

    /// Traduz a resposta de erro da API para um erro com significado local.
    async fn erro_de(&self, resposta: reqwest::Response) -> ErroApi {
        let status = resposta.status().as_u16();
        let corpo: RespostaErro = resposta.json().await.unwrap_or(RespostaErro {
            erro: None,
            tentativas_restantes: None,
            problemas: None,
        });

        match corpo.erro.as_deref() {
            Some("credenciais_invalidas") => ErroApi::CredenciaisInvalidas,
            Some("email_invalido") => ErroApi::EmailInvalido,
            Some("senha_invalida") => ErroApi::SenhaFraca("A senha não é válida.".into()),
            Some("senha_fraca") => {
                // As mensagens vêm do servidor, e são juntadas com espaço em vez
                // de virarem lista: a caixa de erro da entrada é uma linha só, e
                // na prática quase sempre chega um problema apenas.
                let texto = corpo
                    .problemas
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|p| p.mensagem)
                    .collect::<Vec<_>>()
                    .join(" ");
                ErroApi::SenhaFraca(if texto.is_empty() {
                    "A senha precisa ter pelo menos 8 caracteres.".into()
                } else {
                    texto
                })
            }
            Some("nao_autenticado") => ErroApi::NaoAutenticado,
            Some("chave_ja_registrada") => ErroApi::ChaveJaRegistrada,
            Some("chave_de_outra_conta") => ErroApi::ChaveDeOutraConta,
            Some("dispositivo_revogado") => ErroApi::DispositivoRevogado,
            Some("agente_invalido") => ErroApi::AgenteInvalido,
            Some("nenhum_pedido_ativo") => ErroApi::NenhumPedido,
            Some("bloqueado") => ErroApi::Bloqueado,
            Some("erro_interno") => ErroApi::ErroInterno,
            Some("codigo_incorreto") => ErroApi::CodigoIncorreto {
                restantes: corpo.tentativas_restantes.unwrap_or(0),
            },
            _ => ErroApi::Inesperado(status),
        }
    }

    pub async fn entrar(&self, email: &str, senha: &str) -> Result<Usuario, ErroApi> {
        let resposta = self
            .http
            .post(self.url("/contas/entrada"))
            .json(&serde_json::json!({ "email": email, "senha": senha }))
            .send()
            .await
            .map_err(|_| ErroApi::SemConexao)?;

        if !resposta.status().is_success() {
            return Err(self.erro_de(resposta).await);
        }

        let corpo: RespostaUsuario = resposta.json().await.map_err(|_| ErroApi::Inesperado(0))?;
        self.guardar_sessao();
        Ok(corpo.usuario)
    }

    /// Cria a conta e já entra nela.
    ///
    /// Existe no Agente, e não só na PWA, porque instalar o Agente primeiro é um
    /// caminho de primeira execução perfeitamente normal — e sem isto ele era um
    /// beco: a janela pedia uma conta que não havia como criar dali, e respondia
    /// "credenciais inválidas" a quem tentasse o próprio e-mail.
    ///
    /// **Cadastrar um e-mail que já tem conta responde 201 sem `usuario`.** É a
    /// defesa da API contra descobrir quais endereços têm conta, e o cliente
    /// precisa tratar: sem isso o botão parece funcionar, nenhuma sessão é
    /// criada, e a tela volta ao começo sem explicar nada.
    pub async fn cadastrar(
        &self,
        email: &str,
        senha: &str,
        nome: Option<&str>,
    ) -> Result<Usuario, ErroApi> {
        let mut corpo = serde_json::json!({ "email": email, "senha": senha });
        if let Some(nome) = nome.map(str::trim).filter(|n| !n.is_empty()) {
            corpo["nome"] = serde_json::json!(nome);
        }

        let resposta = self
            .http
            .post(self.url("/contas/cadastro"))
            .json(&corpo)
            .send()
            .await
            .map_err(|_| ErroApi::SemConexao)?;

        if !resposta.status().is_success() {
            return Err(self.erro_de(resposta).await);
        }

        let corpo: RespostaCadastro = resposta.json().await.map_err(|_| ErroApi::Inesperado(0))?;
        let Some(usuario) = corpo.usuario else {
            return Err(ErroApi::TalvezJaTenhaConta);
        };

        self.guardar_sessao();
        Ok(usuario)
    }

    pub async fn sessao_atual(&self) -> Result<Usuario, ErroApi> {
        let resposta = self
            .http
            .get(self.url("/contas/eu"))
            .send()
            .await
            .map_err(|_| ErroApi::SemConexao)?;

        if !resposta.status().is_success() {
            return Err(self.erro_de(resposta).await);
        }

        let corpo: RespostaUsuario = resposta.json().await.map_err(|_| ErroApi::Inesperado(0))?;
        Ok(corpo.usuario)
    }

    pub async fn sair(&self) -> Result<(), ErroApi> {
        let resultado = self.http.post(self.url("/contas/saida")).send().await;

        // A sessão local é descartada mesmo quando o servidor não respondeu.
        // Quem pediu para sair saiu; insistir em manter a credencial porque a
        // rede caiu deixaria o Agente logado contra a vontade de quem usa.
        self.descartar_sessao();

        resultado.map_err(|_| ErroApi::SemConexao)?;
        Ok(())
    }

    /// Registra este computador como Agente da conta.
    ///
    /// Não exige código: estar rodando neste computador já é a prova de posse
    /// da máquina. É o caminho inverso do pareamento de um celular, onde o
    /// código existe justamente para provar essa presença.
    pub async fn registrar_agente(
        &self,
        chave_publica: &str,
        algoritmo: &str,
        nome: &str,
    ) -> Result<(), ErroApi> {
        let resposta = self
            .http
            .post(self.url("/dispositivos/agente"))
            .json(&serde_json::json!({
                "chavePublica": chave_publica,
                "algoritmo": algoritmo,
                "nome": nome,
            }))
            .send()
            .await
            .map_err(|_| ErroApi::SemConexao)?;

        // Já registrado é situação normal a partir da segunda execução, e não
        // um erro a ser mostrado para quem está usando.
        if resposta.status() == reqwest::StatusCode::CONFLICT {
            return Ok(());
        }

        if !resposta.status().is_success() {
            return Err(self.erro_de(resposta).await);
        }

        Ok(())
    }

    /// Confirma o pareamento com o código exibido no celular.
    pub async fn confirmar_pareamento_com_prova(
        &self,
        codigo: &str,
        chave_publica_agente: &str,
        assinatura: &str,
    ) -> Result<Dispositivo, ErroApi> {
        let resposta = self
            .http
            .post(self.url("/pareamento/confirmar"))
            .json(&serde_json::json!({
                "codigo": codigo.trim(),
                "chavePublicaAgente": chave_publica_agente,
                "assinatura": assinatura,
            }))
            .send()
            .await
            .map_err(|_| ErroApi::SemConexao)?;

        if !resposta.status().is_success() {
            return Err(self.erro_de(resposta).await);
        }

        #[derive(Deserialize)]
        struct RespostaPareamento {
            dispositivo: Dispositivo,
        }

        let corpo: RespostaPareamento =
            resposta.json().await.map_err(|_| ErroApi::Inesperado(0))?;
        Ok(corpo.dispositivo)
    }

    pub async fn dispositivos(&self) -> Result<Vec<Dispositivo>, ErroApi> {
        let resposta = self
            .http
            .get(self.url("/dispositivos"))
            .send()
            .await
            .map_err(|_| ErroApi::SemConexao)?;

        if !resposta.status().is_success() {
            return Err(self.erro_de(resposta).await);
        }

        let corpo: RespostaDispositivos =
            resposta.json().await.map_err(|_| ErroApi::Inesperado(0))?;
        Ok(corpo.dispositivos)
    }

    /// Remove um aparelho da conta.
    ///
    /// O servidor revoga; a raiz de confiança local é atualizada por quem
    /// chama, porque uma remoção que some da nuvem e continua confiável aqui
    /// seria pior do que não ter removido.
    pub async fn remover_dispositivo(&self, id: &str) -> Result<(), ErroApi> {
        let resposta = self
            .http
            .delete(self.url(&format!("/dispositivos/{id}")))
            .send()
            .await
            .map_err(|_| ErroApi::SemConexao)?;

        // Já não existir é o mesmo resultado que remover: o aparelho não está
        // mais na conta, que é o que a pessoa pediu.
        if resposta.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(());
        }

        if !resposta.status().is_success() {
            return Err(self.erro_de(resposta).await);
        }

        Ok(())
    }

    pub async fn criar_convite_qr(
        &self,
        nonce: &str,
        chave_publica_agente: &str,
        assinatura: &str,
    ) -> Result<ConvitePareamentoQr, ErroApi> {
        let resposta = self
            .http
            .post(self.url("/pareamento/convites"))
            .json(&serde_json::json!({
                "nonce": nonce,
                "chavePublicaAgente": chave_publica_agente,
                "assinatura": assinatura,
            }))
            .send()
            .await
            .map_err(|_| ErroApi::SemConexao)?;
        if !resposta.status().is_success() {
            return Err(self.erro_de(resposta).await);
        }
        resposta.json().await.map_err(|_| ErroApi::Inesperado(0))
    }

    pub async fn consultar_convite_qr(
        &self,
        convite_id: &str,
    ) -> Result<SituacaoConviteQr, ErroApi> {
        let resposta = self
            .http
            .get(self.url(&format!("/pareamento/convites/{convite_id}")))
            .send()
            .await
            .map_err(|_| ErroApi::SemConexao)?;
        if !resposta.status().is_success() {
            return Err(self.erro_de(resposta).await);
        }
        resposta.json().await.map_err(|_| ErroApi::Inesperado(0))
    }

    pub async fn pedir_desafio_sinalizacao(
        &self,
        chave_publica: &str,
    ) -> Result<DesafioSinalizacao, ErroApi> {
        let resposta = self
            .http
            .post(self.url("/sinalizacao/desafios"))
            .json(&serde_json::json!({ "chavePublica": chave_publica }))
            .send()
            .await
            .map_err(|_| ErroApi::SemConexao)?;

        if !resposta.status().is_success() {
            return Err(self.erro_de(resposta).await);
        }
        resposta.json().await.map_err(|_| ErroApi::Inesperado(0))
    }

    pub async fn trocar_desafio_sinalizacao(
        &self,
        desafio_id: &str,
        nonce: &str,
        assinatura: &str,
    ) -> Result<TokenSinalizacao, ErroApi> {
        let resposta = self
            .http
            .post(self.url("/sinalizacao/tokens"))
            .json(&serde_json::json!({
                "desafioId": desafio_id,
                "nonce": nonce,
                "assinatura": assinatura,
            }))
            .send()
            .await
            .map_err(|_| ErroApi::SemConexao)?;

        if !resposta.status().is_success() {
            return Err(self.erro_de(resposta).await);
        }
        resposta.json().await.map_err(|_| ErroApi::Inesperado(0))
    }
}

/// Lê a sessão gravada, devolvendo `None` para qualquer arquivo que não sirva.
///
/// Ausente, corrompido, protegido por outra conta do Windows ou escrito por uma
/// versão que serializava diferente — em todos os casos o resultado útil é o
/// mesmo: começar sem sessão. Propagar o erro só transformaria "entre de novo"
/// em "o Agente não abre".
fn ler_sessao_do_disco(caminho: &Path) -> Option<cookie_store::CookieStore> {
    let protegido = std::fs::read(caminho).ok()?;
    let bruto = desproteger(&protegido).ok()?;
    cookie_store::serde::json::load(bruto.as_slice()).ok()
}

#[cfg(test)]
mod testes {
    use super::*;

    /// Grava um cookie de sessão no cliente como se tivesse vindo da API.
    fn semear_sessao(cliente: &ClienteApi, valor: &str) {
        let url = reqwest::Url::parse("https://slate.aionixdev.com/api/contas/entrada").unwrap();
        cliente
            .cookies
            .lock()
            .unwrap()
            .parse(
                &format!("slate_sessao={valor}; Path=/; Max-Age=2592000; HttpOnly"),
                &url,
            )
            .unwrap();
    }

    fn pasta_temporaria(nome: &str) -> PathBuf {
        let pasta = std::env::temp_dir().join(format!("slate-teste-{nome}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&pasta);
        std::fs::create_dir_all(&pasta).unwrap();
        pasta
    }

    #[test]
    fn a_sessao_sobrevive_ao_fechamento_do_agente() {
        // O defeito que este teste tranca: o armazenamento de cookies do
        // reqwest só existe em memória, e o Agente pedia e-mail e senha a cada
        // abertura mesmo com um cookie de trinta dias.
        let pasta = pasta_temporaria("sessao-persiste");

        let primeiro = ClienteApi::com_sessao("https://slate.aionixdev.com/api", &pasta);
        semear_sessao(&primeiro, "token-de-teste");
        primeiro.guardar_sessao();
        drop(primeiro);

        let segundo = ClienteApi::com_sessao("https://slate.aionixdev.com/api", &pasta);
        let loja = segundo.cookies.lock().unwrap();
        let guardado = loja
            .get("slate.aionixdev.com", "/", "slate_sessao")
            .map(|c| c.value().to_string());
        assert_eq!(guardado.as_deref(), Some("token-de-teste"));
    }

    #[test]
    fn sair_apaga_a_credencial_do_disco() {
        // Um logout que deixa o cookie gravado devolve a conta a quem abrir o
        // arquivo depois.
        let pasta = pasta_temporaria("sessao-apagada");
        let caminho = pasta.join(ARQUIVO_SESSAO);

        let cliente = ClienteApi::com_sessao("https://slate.aionixdev.com/api", &pasta);
        semear_sessao(&cliente, "token-de-teste");
        cliente.guardar_sessao();
        assert!(caminho.exists(), "o teste precisa começar com sessão gravada");

        cliente.descartar_sessao();

        assert!(!caminho.exists());
        assert!(cliente
            .cookies
            .lock()
            .unwrap()
            .get("slate.aionixdev.com", "/", "slate_sessao")
            .is_none());
    }

    #[test]
    fn uma_sessao_ilegivel_vale_o_mesmo_que_nenhuma() {
        // Arquivo de outra conta do Windows, ou truncado por um desligamento:
        // o Agente precisa abrir e pedir login, não recusar-se a iniciar.
        let pasta = pasta_temporaria("sessao-corrompida");
        std::fs::write(pasta.join(ARQUIVO_SESSAO), b"nao sou uma sessao").unwrap();

        let cliente = ClienteApi::com_sessao("https://slate.aionixdev.com/api", &pasta);
        assert_eq!(cliente.cookies.lock().unwrap().iter_any().count(), 0);
    }

    // -----------------------------------------------------------------
    // A prova que importa
    // -----------------------------------------------------------------
    //
    // Os testes acima mostram que o cookie vai e volta do disco. Isso não é a
    // mesma coisa que a sessão funcionar: entre o arquivo e a conta ainda
    // estão o `cookie_provider` do reqwest, o casamento de domínio e caminho e
    // o cabeçalho `Cookie` da requisição seguinte. Um arquivo gravado
    // corretamente que nunca chega ao servidor deixaria o defeito de pé com o
    // teste verde.
    //
    // Por isso aqui sobe um servidor que se comporta como a API: emite
    // `Set-Cookie` na entrada e só reconhece `/contas/eu` quando o cookie
    // volta. O segundo cliente nasce do zero, como numa reabertura do Agente.

    const TOKEN_FALSO: &str = "sessao-de-teste-abc123";
    const CORPO_USUARIO: &str = r#"{"usuario":{"id":"u1","email":"a@b.com","nome":"Alan"}}"#;

    async fn subir_api_falsa() -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let ouvinte = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("porta livre");
        let endereco = ouvinte.local_addr().expect("endereço");

        tokio::spawn(async move {
            while let Ok((mut conexao, _)) = ouvinte.accept().await {
                tokio::spawn(async move {
                    let mut buffer = vec![0u8; 4096];
                    let Ok(lidos) = conexao.read(&mut buffer).await else {
                        return;
                    };
                    let pedido = String::from_utf8_lossy(&buffer[..lidos]).to_string();

                    let resposta = if pedido.starts_with("POST /contas/entrada") {
                        // Mesmo formato que `sessao.ts` produz: é o `Max-Age`
                        // que faz o armazenamento tratar o cookie como
                        // persistente e, portanto, gravável.
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                             Set-Cookie: slate_sessao={TOKEN_FALSO}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000\r\n\
                             Content-Length: {}\r\n\r\n{CORPO_USUARIO}",
                            CORPO_USUARIO.len()
                        )
                    } else if pedido.contains(&format!("slate_sessao={TOKEN_FALSO}")) {
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                             Content-Length: {}\r\n\r\n{CORPO_USUARIO}",
                            CORPO_USUARIO.len()
                        )
                    } else {
                        let corpo = r#"{"erro":"nao_autenticado"}"#;
                        format!(
                            "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\
                             Content-Length: {}\r\n\r\n{corpo}",
                            corpo.len()
                        )
                    };

                    let _ = conexao.write_all(resposta.as_bytes()).await;
                    let _ = conexao.flush().await;
                });
            }
        });

        format!("http://{endereco}")
    }

    #[tokio::test]
    async fn reabrir_o_agente_nao_pede_login_de_novo() {
        let base = subir_api_falsa().await;
        let pasta = pasta_temporaria("reabertura");

        // Primeira execução: a pessoa entra na conta.
        let primeira = ClienteApi::com_sessao(&base, &pasta);
        primeira
            .entrar("a@b.com", "senha-correta")
            .await
            .expect("a entrada precisa funcionar");
        drop(primeira);

        // Segunda execução: processo novo, memória zerada, só o disco em comum.
        let segunda = ClienteApi::com_sessao(&base, &pasta);
        let usuario = segunda
            .sessao_atual()
            .await
            .expect("a sessão precisa continuar valendo depois de reabrir");

        assert_eq!(usuario.email, "a@b.com");
    }

    #[tokio::test]
    async fn sem_sessao_gravada_a_conta_continua_pedindo_login() {
        // O contrapeso do teste acima: se a API de mentira respondesse com
        // sucesso sem cookie nenhum, aquele teste passaria sem provar nada.
        let base = subir_api_falsa().await;
        let pasta = pasta_temporaria("sem-sessao");

        let cliente = ClienteApi::com_sessao(&base, &pasta);
        assert!(cliente.sessao_atual().await.is_err());
    }

    #[tokio::test]
    async fn depois_de_sair_reabrir_pede_login() {
        let base = subir_api_falsa().await;
        let pasta = pasta_temporaria("saida");

        let primeira = ClienteApi::com_sessao(&base, &pasta);
        primeira.entrar("a@b.com", "senha").await.expect("entrada");
        primeira.sair().await.expect("saída");
        drop(primeira);

        let segunda = ClienteApi::com_sessao(&base, &pasta);
        assert!(
            segunda.sessao_atual().await.is_err(),
            "sair precisa apagar a credencial do disco, não só da memória"
        );
    }

    #[test]
    fn remove_a_barra_final_da_base() {
        // Sem isso as URLs sairiam com barra dupla, que alguns servidores
        // tratam como caminho diferente.
        let cliente = ClienteApi::novo("https://slate.aionixdev.com/api/");
        assert_eq!(
            cliente.url("/contas/eu"),
            "https://slate.aionixdev.com/api/contas/eu"
        );
    }

    #[test]
    fn as_mensagens_de_erro_sao_em_portugues_e_sem_jargao() {
        // Quem usa o Agente quer controlar o computador, não depurar HTTP.
        let casos = vec![
            ErroApi::SemConexao,
            ErroApi::CredenciaisInvalidas,
            ErroApi::NaoAutenticado,
            ErroApi::Bloqueado,
            ErroApi::CodigoIncorreto { restantes: 2 },
            ErroApi::ChaveJaRegistrada,
            ErroApi::ChaveDeOutraConta,
            ErroApi::DispositivoRevogado,
            ErroApi::ErroInterno,
        ];

        for erro in casos {
            let texto = erro.to_string();
            assert!(!texto.is_empty());
            assert!(!texto.contains("HTTP"), "mensagem com jargão: {texto}");
            assert!(!texto.contains("status"), "mensagem com jargão: {texto}");
        }
    }

    #[test]
    fn os_erros_de_chave_falam_do_aparelho_e_nao_do_computador() {
        // Quem confirma está na frente do computador: culpar a máquina manda
        // procurar o problema no lugar errado, e foi assim que um celular
        // revogado virou "este computador está em outra conta".
        for erro in [
            ErroApi::ChaveJaRegistrada,
            ErroApi::ChaveDeOutraConta,
            ErroApi::DispositivoRevogado,
        ] {
            let texto = erro.to_string();
            assert!(
                !texto.contains("computador"),
                "erro do aparelho culpando o computador: {texto}"
            );
        }
    }

    #[test]
    fn o_erro_de_codigo_informa_quantas_tentativas_restam() {
        let erro = ErroApi::CodigoIncorreto { restantes: 2 };
        assert!(erro.to_string().contains('2'));
    }
}
