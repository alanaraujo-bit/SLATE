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
    #[error("este computador já está registrado em outra conta")]
    ChaveJaRegistrada,
    #[error("nenhum pareamento em andamento")]
    NenhumPedido,
    #[error("código incorreto — restam {restantes} tentativa(s)")]
    CodigoIncorreto { restantes: u32 },
    #[error("tentativas esgotadas: peça um código novo no celular")]
    Bloqueado,
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
}

#[derive(Debug, Deserialize)]
struct RespostaDispositivos {
    dispositivos: Vec<Dispositivo>,
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
        let corpo: RespostaErro = resposta
            .json()
            .await
            .unwrap_or(RespostaErro { erro: None, tentativas_restantes: None });

        match corpo.erro.as_deref() {
            Some("credenciais_invalidas") => ErroApi::CredenciaisInvalidas,
            Some("nao_autenticado") => ErroApi::NaoAutenticado,
            Some("chave_ja_registrada") => ErroApi::ChaveJaRegistrada,
            Some("nenhum_pedido_ativo") => ErroApi::NenhumPedido,
            Some("bloqueado") => ErroApi::Bloqueado,
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
    pub async fn confirmar_pareamento(&self, codigo: &str) -> Result<Dispositivo, ErroApi> {
        let resposta = self
            .http
            .post(self.url("/pareamento/confirmar"))
            .json(&serde_json::json!({ "codigo": codigo.trim() }))
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
        ];

        for erro in casos {
            let texto = erro.to_string();
            assert!(!texto.is_empty());
            assert!(!texto.contains("HTTP"), "mensagem com jargão: {texto}");
            assert!(!texto.contains("status"), "mensagem com jargão: {texto}");
        }
    }

    #[test]
    fn o_erro_de_codigo_informa_quantas_tentativas_restam() {
        let erro = ErroApi::CodigoIncorreto { restantes: 2 };
        assert!(erro.to_string().contains('2'));
    }
}
