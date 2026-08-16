//! Atalhos que a pessoa cadastra neste computador.
//!
//! **A definição mora aqui, e não no celular.** `ESCOPOS_SOMENTE_NO_PC` já
//! colocava `action.define` fora do alcance de um aparelho, e é o que sustenta
//! a promessa do ADR-0004: o celular manda um identificador, nunca um caminho.
//! Escolher qual executável um atalho abre é ato de quem está na frente da
//! máquina, com o seletor de arquivo do próprio Windows.
//!
//! O celular arranja (`deck.read`/`deck.write`); o computador define.

use crate::icone;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

const VERSAO_ARQUIVO: u8 = 1;
const ARQUIVO: &str = "atalhos.json";

/// Teto de atalhos cadastrados.
///
/// Não é limite de banco: a lista inteira viaja no `deck.estado` a cada
/// conexão, com um ícone PNG embutido em cada item. Cem já são alguns
/// megabytes, e mais do que isso transformaria o handshake numa transferência.
const MAXIMO: usize = 100;

/// Cores disponíveis, espelhando `--s-control-*` do design system.
///
/// Lista fechada de propósito: o celular escolhe entre estas e nunca envia uma
/// cor livre, o que manteria conteúdo arbitrário fora do caminho de renderização.
pub const CORES: [&str; 12] = [
    "red", "orange", "amber", "yellow", "lime", "green", "teal", "cyan", "blue", "indigo",
    "violet", "pink",
];

#[derive(Debug, thiserror::Error)]
pub enum ErroAtalhos {
    #[error("não foi possível guardar os atalhos")]
    Arquivo(#[from] std::io::Error),
    #[error("a lista de atalhos está corrompida")]
    Corrompida,
    #[error("não foi possível acessar a lista de atalhos")]
    Concorrencia,
    #[error("esse arquivo não é um programa que dê para abrir")]
    CaminhoInvalido,
    #[error("dê um nome ao atalho")]
    NomeVazio,
    #[error("já são {MAXIMO} atalhos — remova algum antes de criar outro")]
    Cheio,
    #[error("atalho não encontrado")]
    NaoEncontrado,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Atalho {
    pub id: String,
    pub nome: String,
    /// Caminho absoluto do executável. **Nunca chega pelo canal.**
    pub caminho: String,
    /// Nome da cor em `CORES`.
    pub cor: String,
    /// PNG do ícone do próprio executável, como data URI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icone: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct ArquivoAtalhos {
    versao: u8,
    atalhos: Vec<Atalho>,
}

pub struct AtalhosPersonalizados {
    caminho: PathBuf,
    itens: RwLock<Vec<Atalho>>,
}

impl AtalhosPersonalizados {
    pub fn carregar(pasta: &Path) -> Result<Self, ErroAtalhos> {
        std::fs::create_dir_all(pasta)?;
        let caminho = pasta.join(ARQUIVO);

        let itens = if caminho.exists() {
            let bruto = std::fs::read(&caminho)?;
            let arquivo: ArquivoAtalhos =
                serde_json::from_slice(&bruto).map_err(|_| ErroAtalhos::Corrompida)?;
            if arquivo.versao != VERSAO_ARQUIVO {
                return Err(ErroAtalhos::Corrompida);
            }
            arquivo.atalhos
        } else {
            Vec::new()
        };

        Ok(Self {
            caminho,
            itens: RwLock::new(itens),
        })
    }

    pub fn listar(&self) -> Vec<Atalho> {
        self.itens.read().map(|i| i.clone()).unwrap_or_default()
    }

    /// Resolve o identificador que chegou do celular.
    ///
    /// É o único ponto em que um `atalho.<id>` vira um caminho, e a tradução
    /// acontece contra a lista local — o celular nunca influencia o alvo.
    pub fn buscar(&self, id: &str) -> Option<Atalho> {
        self.itens.read().ok()?.iter().find(|a| a.id == id).cloned()
    }

    /// Cadastra um executável escolhido no seletor de arquivo do Windows.
    pub fn criar(&self, caminho: &str, nome: &str, cor: &str) -> Result<Atalho, ErroAtalhos> {
        let nome = nome.trim();
        if nome.is_empty() {
            return Err(ErroAtalhos::NomeVazio);
        }
        validar_caminho(caminho)?;

        let cor = if CORES.contains(&cor) { cor } else { "violet" };

        let mut itens = self.itens.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        if itens.len() >= MAXIMO {
            return Err(ErroAtalhos::Cheio);
        }

        let atalho = Atalho {
            id: uuid::Uuid::new_v4().to_string(),
            nome: nome.chars().take(40).collect(),
            caminho: caminho.to_string(),
            cor: cor.to_string(),
            icone: icone::extrair(caminho),
        };

        let mut candidato = itens.clone();
        candidato.push(atalho.clone());
        gravar(&self.caminho, &candidato)?;
        *itens = candidato;
        Ok(atalho)
    }

    pub fn remover(&self, id: &str) -> Result<(), ErroAtalhos> {
        let mut itens = self.itens.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        let candidato: Vec<Atalho> = itens.iter().filter(|a| a.id != id).cloned().collect();
        if candidato.len() == itens.len() {
            return Err(ErroAtalhos::NaoEncontrado);
        }
        gravar(&self.caminho, &candidato)?;
        *itens = candidato;
        Ok(())
    }

    pub fn renomear(&self, id: &str, nome: &str, cor: &str) -> Result<(), ErroAtalhos> {
        let nome = nome.trim();
        if nome.is_empty() {
            return Err(ErroAtalhos::NomeVazio);
        }
        let mut itens = self.itens.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        let mut candidato = itens.clone();
        let alvo = candidato
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or(ErroAtalhos::NaoEncontrado)?;
        alvo.nome = nome.chars().take(40).collect();
        if CORES.contains(&cor) {
            alvo.cor = cor.to_string();
        }
        gravar(&self.caminho, &candidato)?;
        *itens = candidato;
        Ok(())
    }
}

/// Confere o que será executado, no momento do cadastro.
///
/// A verificação se repete na execução, em `acoes.rs`: um programa apagado ou
/// movido depois do cadastro precisa falhar dizendo isso, e não tentar abrir um
/// caminho que já não existe.
pub fn validar_caminho(caminho: &str) -> Result<(), ErroAtalhos> {
    let p = Path::new(caminho);
    if !p.is_absolute() || !p.is_file() {
        return Err(ErroAtalhos::CaminhoInvalido);
    }
    // Extensão conferida para que o atalho abra um programa, e não um
    // documento qualquer que o Shell resolveria com o aplicativo associado.
    let extensao = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match extensao.as_deref() {
        Some("exe") | Some("lnk") | Some("bat") | Some("cmd") | Some("url") => Ok(()),
        _ => Err(ErroAtalhos::CaminhoInvalido),
    }
}

fn gravar(caminho: &Path, atalhos: &[Atalho]) -> Result<(), ErroAtalhos> {
    let bruto = serde_json::to_vec(&ArquivoAtalhos {
        versao: VERSAO_ARQUIVO,
        atalhos: atalhos.to_vec(),
    })
    .map_err(|_| ErroAtalhos::Corrompida)?;

    // Grava em arquivo temporário e renomeia: uma queda de energia no meio da
    // escrita deixaria o arquivo pela metade, e a lista inteira de atalhos se
    // perderia por causa de um cadastro.
    let temporario = caminho.with_extension("json.novo");
    {
        use std::io::Write;
        let mut arquivo = std::fs::File::create(&temporario)?;
        arquivo.write_all(&bruto)?;
        arquivo.sync_all()?;
    }
    std::fs::rename(&temporario, caminho)?;
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;

    fn pasta(nome: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "slate-atalhos-{nome}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// Um executável de verdade, para os testes não dependerem de instalação.
    fn programa_existente() -> String {
        let candidatos = [
            r"C:\Windows\System32\notepad.exe",
            r"C:\Windows\notepad.exe",
            "/bin/sh",
        ];
        candidatos
            .iter()
            .find(|c| Path::new(c).is_file())
            .unwrap_or(&candidatos[0])
            .to_string()
    }

    #[test]
    fn recusa_caminho_que_nao_e_programa() {
        // O que este teste tranca: qualquer coisa que não seja programa vira
        // "abrir com o aplicativo associado", e aí um `.html` cadastrado por
        // engano viraria execução de conteúdo pelo Shell.
        for ruim in [
            "nao-absoluto.exe",
            r"C:\Windows\System32\drivers\etc\hosts",
            "",
            r"C:\Windows",
        ] {
            assert!(validar_caminho(ruim).is_err(), "deixou passar: {ruim}");
        }
    }

    #[test]
    #[cfg(windows)]
    fn aceita_um_executavel_de_verdade() {
        assert!(validar_caminho(&programa_existente()).is_ok());
    }

    #[test]
    fn cria_lista_e_remove_sobrevivendo_ao_fechamento() {
        let pasta = pasta("ciclo");
        let programa = programa_existente();
        if validar_caminho(&programa).is_err() {
            return; // sem executável conhecido nesta plataforma
        }

        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        let criado = atalhos.criar(&programa, "  Meu Jogo  ", "green").unwrap();
        assert_eq!(criado.nome, "Meu Jogo", "o nome é aparado");
        assert_eq!(criado.cor, "green");

        // Reabre como se o Agente tivesse sido fechado.
        let reaberto = AtalhosPersonalizados::carregar(&pasta).unwrap();
        assert_eq!(reaberto.listar().len(), 1);
        assert_eq!(reaberto.buscar(&criado.id).unwrap().caminho, programa);

        reaberto.remover(&criado.id).unwrap();
        assert!(reaberto.buscar(&criado.id).is_none());
        assert!(AtalhosPersonalizados::carregar(&pasta).unwrap().listar().is_empty());

        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn cor_desconhecida_vira_padrao_em_vez_de_erro() {
        // A cor é enfeite: recusar o cadastro inteiro por causa dela trocaria
        // um atalho funcionando por uma mensagem de erro.
        let pasta = pasta("cor");
        let programa = programa_existente();
        if validar_caminho(&programa).is_err() {
            return;
        }
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        let criado = atalhos.criar(&programa, "Jogo", "cor-inventada").unwrap();
        assert_eq!(criado.cor, "violet");
        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    #[cfg(windows)]
    fn o_atalho_nasce_com_o_icone_do_proprio_programa() {
        // A parte mais arriscada do recurso: o Windows entrega o ícone como
        // handle, e virar PNG passa por Shell, GDI, inversão de linhas e troca
        // de BGRA para RGBA. Errar qualquer etapa dá imagem em branco, de
        // cabeça para baixo ou com as cores trocadas — e nada disso apareceria
        // num teste que só conferisse "o atalho foi criado".
        let pasta = pasta("icone");
        let programa = programa_existente();
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        let criado = atalhos.criar(&programa, "Bloco de Notas", "cyan").unwrap();

        let icone = criado.icone.expect("o programa do Windows tem ícone");
        assert!(icone.starts_with("data:image/png;base64,"));

        // Confere a assinatura do PNG nos bytes decodificados, e não só o
        // prefixo do data URI: um base64 de lixo passaria pelo prefixo.
        use base64::{engine::general_purpose::STANDARD, Engine};
        let bytes = STANDARD
            .decode(icone.trim_start_matches("data:image/png;base64,"))
            .expect("base64 válido");
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "não é um PNG");
        assert!(bytes.len() > 100, "PNG pequeno demais para ter imagem");

        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn nome_vazio_e_recusado() {
        let pasta = pasta("nome");
        let programa = programa_existente();
        if validar_caminho(&programa).is_err() {
            return;
        }
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        assert!(atalhos.criar(&programa, "   ", "blue").is_err());
        let _ = std::fs::remove_dir_all(pasta);
    }
}
