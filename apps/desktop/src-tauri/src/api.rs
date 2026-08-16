use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Cliente da API do SLATE.
///
/// O cookie de sessão vive neste processo, num armazenamento próprio do
/// cliente HTTP — fora do alcance da interface. Isso é o que dispensa toda a
/// discussão de origem e `SameSite` que existe do lado da PWA: o Agente não é
/// um navegador e não carrega as restrições de um.

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

#[derive(Debug, Deserialize)]
struct RespostaErro {
    erro: Option<String>,
    #[serde(rename = "tentativasRestantes")]
    tentativas_restantes: Option<u32>,
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
}

impl ClienteApi {
    pub fn novo(base: impl Into<String>) -> Arc<Self> {
        let http = reqwest::Client::builder()
            // Guarda os cookies entre requisições: é assim que a sessão
            // sobrevive de uma chamada para a próxima.
            .cookie_store(true)
            .user_agent(concat!("SLATE-Agente/", env!("CARGO_PKG_VERSION")))
            // Um agente residente não pode ficar preso numa requisição que não
            // volta — ele congelaria sem dizer por quê.
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("cliente HTTP");

        Arc::new(Self {
            http,
            base: base.into().trim_end_matches('/').to_string(),
        })
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
        });

        match corpo.erro.as_deref() {
            Some("credenciais_invalidas") => ErroApi::CredenciaisInvalidas,
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
        Ok(corpo.usuario)
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
        self.http
            .post(self.url("/contas/saida"))
            .send()
            .await
            .map_err(|_| ErroApi::SemConexao)?;
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

#[cfg(test)]
mod testes {
    use super::*;

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
