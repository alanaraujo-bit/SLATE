//! Programas e perfis de deck definidos localmente neste computador.
//!
//! O arquivo guarda caminhos, mas o transporte nunca serializa esta estrutura
//! diretamente: o celular recebe somente identificadores de acoes conhecidas.

use crate::icone;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

const VERSAO_ARQUIVO: u8 = 2;
const ARQUIVO: &str = "atalhos.json";
const MAXIMO: usize = 100;
const MAXIMO_PERFIS: usize = 12;
const MAXIMO_ITENS: usize = 200;

pub const CORES: [&str; 12] = [
    "red", "orange", "amber", "yellow", "lime", "green", "teal", "cyan", "blue", "indigo",
    "violet", "pink",
];

/// A mesma lista fechada resolvida por `acoes.rs`.
pub const ACOES_FIXAS: [&str; 13] = [
    "midia.anterior",
    "midia.reproduzir-pausar",
    "midia.proxima",
    "midia.parar",
    "volume.diminuir",
    "volume.mudo",
    "volume.aumentar",
    "atalho.youtube",
    "atalho.twitch",
    "atalho.netflix",
    "atalho.prime",
    "atalho.disney",
    "atalho.spotify",
];

#[derive(Debug, thiserror::Error)]
pub enum ErroAtalhos {
    #[error("nao foi possivel guardar os atalhos")]
    Arquivo(#[from] std::io::Error),
    #[error("a configuracao do deck esta corrompida")]
    Corrompida,
    #[error("nao foi possivel acessar a configuracao do deck")]
    Concorrencia,
    #[error("esse arquivo nao e um programa que de para abrir")]
    CaminhoInvalido,
    #[error("de um nome ao atalho")]
    NomeVazio,
    #[error("ja sao {MAXIMO} atalhos - remova algum antes de criar outro")]
    Cheio,
    #[error("atalho nao encontrado")]
    NaoEncontrado,
    #[error("perfil nao encontrado")]
    PerfilNaoEncontrado,
    #[error("ja sao {MAXIMO_PERFIS} perfis - remova algum antes de criar outro")]
    PerfisCheios,
    #[error("o perfil e invalido")]
    PerfilInvalido,
    #[error("o perfil padrao nao tem espaco para outro programa")]
    PerfilSemEspaco,
    #[error("o deck precisa ter ao menos um perfil")]
    UltimoPerfil,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Atalho {
    pub id: String,
    pub nome: String,
    /// Caminho absoluto do executavel. Nunca chega pelo canal.
    pub caminho: String,
    pub cor: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ItemDePerfilDeck {
    pub action_id: String,
    pub pagina: u8,
    pub ordem: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tamanho: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PerfilDeDeck {
    pub id: String,
    pub nome: String,
    pub cor: String,
    pub colunas_retrato: u8,
    pub colunas_paisagem: u8,
    pub itens: Vec<ItemDePerfilDeck>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguracaoDeck {
    pub perfis: Vec<PerfilDeDeck>,
    pub perfil_padrao_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArquivoAtalhos {
    versao: u8,
    atalhos: Vec<Atalho>,
    perfis: Vec<PerfilDeDeck>,
    perfil_padrao_id: String,
}

#[derive(Deserialize)]
struct ArquivoAtalhosV1 {
    versao: u8,
    atalhos: Vec<Atalho>,
}

pub struct AtalhosPersonalizados {
    caminho: PathBuf,
    estado: RwLock<ArquivoAtalhos>,
}

impl AtalhosPersonalizados {
    pub fn carregar(pasta: &Path) -> Result<Self, ErroAtalhos> {
        std::fs::create_dir_all(pasta)?;
        let caminho = pasta.join(ARQUIVO);
        let (estado, precisa_gravar) = if caminho.exists() {
            let bruto = std::fs::read(&caminho)?;
            let valor: serde_json::Value =
                serde_json::from_slice(&bruto).map_err(|_| ErroAtalhos::Corrompida)?;
            match valor.get("versao").and_then(|v| v.as_u64()) {
                Some(1) => {
                    let antigo: ArquivoAtalhosV1 = serde_json::from_value(valor)
                        .map_err(|_| ErroAtalhos::Corrompida)?;
                    if antigo.versao != 1 || antigo.atalhos.len() > MAXIMO {
                        return Err(ErroAtalhos::Corrompida);
                    }
                    (novo_estado(antigo.atalhos), true)
                }
                Some(2) => {
                    let atual: ArquivoAtalhos = serde_json::from_value(valor)
                        .map_err(|_| ErroAtalhos::Corrompida)?;
                    validar_estado(&atual)?;
                    (atual, false)
                }
                _ => return Err(ErroAtalhos::Corrompida),
            }
        } else {
            (novo_estado(Vec::new()), true)
        };

        if precisa_gravar {
            gravar(&caminho, &estado)?;
        }
        Ok(Self {
            caminho,
            estado: RwLock::new(estado),
        })
    }

    pub fn listar(&self) -> Vec<Atalho> {
        self.estado
            .read()
            .map(|e| e.atalhos.clone())
            .unwrap_or_default()
    }

    pub fn configuracao(&self) -> ConfiguracaoDeck {
        self.estado
            .read()
            .map(|e| ConfiguracaoDeck {
                perfis: e.perfis.clone(),
                perfil_padrao_id: e.perfil_padrao_id.clone(),
            })
            .unwrap_or_else(|_| ConfiguracaoDeck {
                perfis: Vec::new(),
                perfil_padrao_id: String::new(),
            })
    }

    pub fn buscar(&self, id: &str) -> Option<Atalho> {
        self.estado
            .read()
            .ok()?
            .atalhos
            .iter()
            .find(|a| a.id == id)
            .cloned()
    }

    pub fn criar(&self, caminho: &str, nome: &str, cor: &str) -> Result<Atalho, ErroAtalhos> {
        let nome = nome.trim();
        if nome.is_empty() {
            return Err(ErroAtalhos::NomeVazio);
        }
        validar_caminho(caminho)?;
        let cor = if CORES.contains(&cor) { cor } else { "violet" };

        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        if estado.atalhos.len() >= MAXIMO {
            return Err(ErroAtalhos::Cheio);
        }
        let atalho = Atalho {
            id: uuid::Uuid::new_v4().to_string(),
            nome: nome.chars().take(40).collect(),
            caminho: caminho.to_string(),
            cor: cor.to_string(),
            icone: icone::extrair(caminho),
        };
        let mut candidato = estado.clone();
        adicionar_programa_ao_padrao(&mut candidato, &atalho)?;
        candidato.atalhos.push(atalho.clone());
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(atalho)
    }

    pub fn remover(&self, id: &str) -> Result<(), ErroAtalhos> {
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        if !estado.atalhos.iter().any(|a| a.id == id) {
            return Err(ErroAtalhos::NaoEncontrado);
        }
        let mut candidato = estado.clone();
        candidato.atalhos.retain(|a| a.id != id);
        let action_id = format!("programa.{id}");
        for perfil in &mut candidato.perfis {
            perfil.itens.retain(|item| item.action_id != action_id);
        }
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(())
    }

    pub fn renomear(&self, id: &str, nome: &str, cor: &str) -> Result<(), ErroAtalhos> {
        let nome = nome.trim();
        if nome.is_empty() {
            return Err(ErroAtalhos::NomeVazio);
        }
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        let mut candidato = estado.clone();
        let alvo = candidato
            .atalhos
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or(ErroAtalhos::NaoEncontrado)?;
        alvo.nome = nome.chars().take(40).collect();
        if CORES.contains(&cor) {
            alvo.cor = cor.to_string();
        }
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(())
    }

    pub fn criar_perfil(&self, nome: &str, cor: &str) -> Result<PerfilDeDeck, ErroAtalhos> {
        let nome = nome.trim();
        if nome.is_empty() || nome.chars().count() > 28 || !CORES.contains(&cor) {
            return Err(ErroAtalhos::PerfilInvalido);
        }
        let perfil = PerfilDeDeck {
            id: uuid::Uuid::new_v4().to_string(),
            nome: nome.to_string(),
            cor: cor.to_string(),
            colunas_retrato: 3,
            colunas_paisagem: 6,
            itens: Vec::new(),
        };
        self.inserir_perfil(perfil)
    }

    pub fn duplicar_perfil(&self, id: &str) -> Result<PerfilDeDeck, ErroAtalhos> {
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        if estado.perfis.len() >= MAXIMO_PERFIS {
            return Err(ErroAtalhos::PerfisCheios);
        }
        let mut perfil = estado
            .perfis
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or(ErroAtalhos::PerfilNaoEncontrado)?;
        perfil.id = uuid::Uuid::new_v4().to_string();
        perfil.nome = nome_da_copia(&perfil.nome);
        let mut candidato = estado.clone();
        candidato.perfis.push(perfil.clone());
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(perfil)
    }

    pub fn salvar_perfil(&self, perfil: PerfilDeDeck) -> Result<PerfilDeDeck, ErroAtalhos> {
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        let mut perfil = perfil;
        normalizar_ordem(&mut perfil.itens);
        validar_perfil(&perfil, &estado.atalhos)?;
        let mut candidato = estado.clone();
        let alvo = candidato
            .perfis
            .iter_mut()
            .find(|p| p.id == perfil.id)
            .ok_or(ErroAtalhos::PerfilNaoEncontrado)?;
        *alvo = perfil.clone();
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(perfil)
    }

    pub fn remover_perfil(&self, id: &str) -> Result<(), ErroAtalhos> {
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        if estado.perfis.len() == 1 {
            return Err(ErroAtalhos::UltimoPerfil);
        }
        if !estado.perfis.iter().any(|p| p.id == id) {
            return Err(ErroAtalhos::PerfilNaoEncontrado);
        }
        let mut candidato = estado.clone();
        candidato.perfis.retain(|p| p.id != id);
        if candidato.perfil_padrao_id == id {
            candidato.perfil_padrao_id = candidato.perfis[0].id.clone();
        }
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(())
    }

    pub fn definir_perfil_padrao(&self, id: &str) -> Result<(), ErroAtalhos> {
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        if !estado.perfis.iter().any(|p| p.id == id) {
            return Err(ErroAtalhos::PerfilNaoEncontrado);
        }
        let mut candidato = estado.clone();
        candidato.perfil_padrao_id = id.to_string();
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(())
    }

    fn inserir_perfil(&self, perfil: PerfilDeDeck) -> Result<PerfilDeDeck, ErroAtalhos> {
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        if estado.perfis.len() >= MAXIMO_PERFIS {
            return Err(ErroAtalhos::PerfisCheios);
        }
        let mut candidato = estado.clone();
        candidato.perfis.push(perfil.clone());
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(perfil)
    }
}

fn novo_estado(atalhos: Vec<Atalho>) -> ArquivoAtalhos {
    let perfil = perfil_padrao(&atalhos);
    ArquivoAtalhos {
        versao: VERSAO_ARQUIVO,
        atalhos,
        perfil_padrao_id: perfil.id.clone(),
        perfis: vec![perfil],
    }
}

fn perfil_padrao(atalhos: &[Atalho]) -> PerfilDeDeck {
    let id = uuid::Uuid::new_v4().to_string();
    let mut itens = Vec::new();
    for (ordem, action_id) in ACOES_FIXAS[..7].iter().enumerate() {
        itens.push(item(action_id, 0, ordem as u16));
    }
    for (ordem, action_id) in ACOES_FIXAS[7..].iter().enumerate() {
        itens.push(item(action_id, 1, ordem as u16));
    }
    for (indice, atalho) in atalhos.iter().enumerate() {
        itens.push(item(
            &format!("programa.{}", atalho.id),
            2 + (indice / 24) as u8,
            (indice % 24) as u16,
        ));
    }
    PerfilDeDeck {
        id,
        nome: "Principal".to_string(),
        cor: "violet".to_string(),
        colunas_retrato: 3,
        colunas_paisagem: 6,
        itens,
    }
}

fn item(action_id: &str, pagina: u8, ordem: u16) -> ItemDePerfilDeck {
    ItemDePerfilDeck {
        action_id: action_id.to_string(),
        pagina,
        ordem,
        cor: None,
        tamanho: None,
    }
}

fn adicionar_programa_ao_padrao(
    estado: &mut ArquivoAtalhos,
    atalho: &Atalho,
) -> Result<(), ErroAtalhos> {
    let perfil = estado
        .perfis
        .iter_mut()
        .find(|p| p.id == estado.perfil_padrao_id)
        .ok_or(ErroAtalhos::Corrompida)?;
    if perfil.itens.len() >= MAXIMO_ITENS {
        return Err(ErroAtalhos::PerfilSemEspaco);
    }
    let ocupados: HashSet<(u8, u16)> = perfil.itens.iter().map(|i| (i.pagina, i.ordem)).collect();
    let posicao = (2..=9)
        .flat_map(|pagina| (0..24).map(move |ordem| (pagina, ordem)))
        .find(|posicao| !ocupados.contains(posicao))
        .or_else(|| {
            (0..=9)
                .flat_map(|pagina| (0..=199).map(move |ordem| (pagina, ordem)))
                .find(|posicao| !ocupados.contains(posicao))
        })
        .ok_or(ErroAtalhos::PerfilSemEspaco)?;
    perfil.itens.push(item(
        &format!("programa.{}", atalho.id),
        posicao.0,
        posicao.1,
    ));
    Ok(())
}

fn validar_estado(estado: &ArquivoAtalhos) -> Result<(), ErroAtalhos> {
    if estado.versao != VERSAO_ARQUIVO
        || estado.atalhos.len() > MAXIMO
        || estado.perfis.is_empty()
        || estado.perfis.len() > MAXIMO_PERFIS
        || !estado
            .perfis
            .iter()
            .any(|p| p.id == estado.perfil_padrao_id)
    {
        return Err(ErroAtalhos::Corrompida);
    }
    let mut ids = HashSet::new();
    for perfil in &estado.perfis {
        if !ids.insert(&perfil.id) || validar_perfil(perfil, &estado.atalhos).is_err() {
            return Err(ErroAtalhos::Corrompida);
        }
    }
    Ok(())
}

/// Renumera as posições de cada página em 0, 1, 2, … sem buracos nem empates.
///
/// **Recusar um perfil malformado seria pior do que consertá-lo.** A janela
/// reordena trocando o `ordem` entre vizinhos, e dois itens com o mesmo número
/// fazem a troca não trocar nada: as setas param de funcionar e nada explica
/// por quê. Empate é fácil de produzir sem ninguém errar — mover teclas entre
/// páginas, duplicar um perfil, editar o arquivo à mão — e devolver "o perfil
/// é inválido" para quem só arrastou uma tecla não ajudaria em nada.
///
/// A ordenação é estável, então itens empatados mantêm a sequência em que
/// chegaram, e não uma escolhida por sorteio.
fn normalizar_ordem(itens: &mut [ItemDePerfilDeck]) {
    itens.sort_by_key(|item| (item.pagina, item.ordem));
    let mut pagina_atual: Option<u8> = None;
    let mut proxima: u16 = 0;
    for item in itens.iter_mut() {
        if pagina_atual != Some(item.pagina) {
            pagina_atual = Some(item.pagina);
            proxima = 0;
        }
        item.ordem = proxima;
        proxima += 1;
    }
}

fn validar_perfil(perfil: &PerfilDeDeck, atalhos: &[Atalho]) -> Result<(), ErroAtalhos> {
    if perfil.id.is_empty()
        || perfil.id.len() > 64
        || perfil.nome.trim().is_empty()
        || perfil.nome.chars().count() > 28
        || !CORES.contains(&perfil.cor.as_str())
        || !(2..=3).contains(&perfil.colunas_retrato)
        || !(4..=6).contains(&perfil.colunas_paisagem)
        || perfil.itens.len() > MAXIMO_ITENS
    {
        return Err(ErroAtalhos::PerfilInvalido);
    }
    for item in &perfil.itens {
        let tamanho_valido = item
            .tamanho
            .as_deref()
            .is_none_or(|t| matches!(t, "normal" | "largo"));
        let cor_valida = item
            .cor
            .as_deref()
            .is_none_or(|cor| CORES.contains(&cor));
        if item.action_id.is_empty()
            || item.action_id.len() > 128
            || item.pagina > 9
            || item.ordem > 199
            || !tamanho_valido
            || !cor_valida
            || !acao_existe(&item.action_id, atalhos)
        {
            return Err(ErroAtalhos::PerfilInvalido);
        }
    }
    Ok(())
}

fn acao_existe(action_id: &str, atalhos: &[Atalho]) -> bool {
    ACOES_FIXAS.contains(&action_id)
        || action_id
            .strip_prefix("programa.")
            .is_some_and(|id| !id.is_empty() && atalhos.iter().any(|a| a.id == id))
}

fn nome_da_copia(nome: &str) -> String {
    let sufixo = " (copia)";
    let limite = 28usize.saturating_sub(sufixo.chars().count());
    format!("{}{}", nome.chars().take(limite).collect::<String>(), sufixo)
}

pub fn validar_caminho(caminho: &str) -> Result<(), ErroAtalhos> {
    let p = Path::new(caminho);
    if !p.is_absolute() || !p.is_file() {
        return Err(ErroAtalhos::CaminhoInvalido);
    }
    let extensao = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match extensao.as_deref() {
        Some("exe") | Some("lnk") | Some("bat") | Some("cmd") | Some("url") => Ok(()),
        _ => Err(ErroAtalhos::CaminhoInvalido),
    }
}

fn gravar(caminho: &Path, estado: &ArquivoAtalhos) -> Result<(), ErroAtalhos> {
    let bruto = serde_json::to_vec(estado).map_err(|_| ErroAtalhos::Corrompida)?;
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
        for ruim in ["nao-absoluto.exe", "", r"C:\Windows"] {
            assert!(validar_caminho(ruim).is_err(), "deixou passar: {ruim}");
        }
    }

    #[test]
    fn migra_v1_sem_perder_programas_e_monta_perfil_padrao() {
        let pasta = pasta("migracao");
        let atalho = Atalho {
            id: "programa-1".into(),
            nome: "Editor".into(),
            caminho: r"C:\Programas\editor.exe".into(),
            cor: "blue".into(),
            icone: None,
        };
        std::fs::write(
            pasta.join(ARQUIVO),
            serde_json::to_vec(&serde_json::json!({ "versao": 1, "atalhos": [atalho] })).unwrap(),
        )
        .unwrap();
        let carregado = AtalhosPersonalizados::carregar(&pasta).unwrap();
        assert_eq!(carregado.listar().len(), 1);
        let configuracao = carregado.configuracao();
        assert_eq!(configuracao.perfis.len(), 1);
        let itens = &configuracao.perfis[0].itens;
        for fixa in ACOES_FIXAS {
            assert!(itens.iter().any(|i| i.action_id == fixa));
        }
        assert!(itens.iter().any(|i| i.action_id == "programa.programa-1"));
        let salvo: serde_json::Value =
            serde_json::from_slice(&std::fs::read(pasta.join(ARQUIVO)).unwrap()).unwrap();
        assert_eq!(salvo["versao"], 2);
        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn cria_remove_e_limpa_referencias_do_programa() {
        let pasta = pasta("ciclo");
        let programa = programa_existente();
        if validar_caminho(&programa).is_err() {
            return;
        }
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        let criado = atalhos.criar(&programa, "  Meu Jogo  ", "green").unwrap();
        let action_id = format!("programa.{}", criado.id);
        assert!(atalhos.configuracao().perfis[0]
            .itens
            .iter()
            .any(|i| i.action_id == action_id));
        atalhos.remover(&criado.id).unwrap();
        assert!(atalhos
            .configuracao()
            .perfis
            .iter()
            .all(|p| p.itens.iter().all(|i| i.action_id != action_id)));
        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn perfis_aplicam_limites_e_lista_fechada() {
        let pasta = pasta("perfis");
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        let mut perfil = atalhos.criar_perfil("Trabalho", "cyan").unwrap();
        perfil.itens.push(item("comando.arbitrario", 0, 0));
        assert!(matches!(
            atalhos.salvar_perfil(perfil),
            Err(ErroAtalhos::PerfilInvalido)
        ));
        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn posicoes_empatadas_sao_renumeradas_em_vez_de_recusadas() {
        // O sintoma que isto evita não é um erro: é a seta de reordenar parar
        // de funcionar. A janela troca o `ordem` entre vizinhos, e trocar dois
        // números iguais não muda nada — a tecla fica presa e nada explica.
        let pasta = pasta("ordem");
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        let mut perfil = atalhos.configuracao().perfis[0].clone();
        perfil.itens = vec![
            item("midia.parar", 0, 7),
            item("volume.mudo", 0, 7),
            item("midia.proxima", 0, 3),
            item("atalho.netflix", 1, 99),
            item("atalho.prime", 1, 99),
        ];

        let salvo = atalhos.salvar_perfil(perfil).unwrap();

        let pagina_zero: Vec<_> = salvo.itens.iter().filter(|i| i.pagina == 0).collect();
        assert_eq!(
            pagina_zero
                .iter()
                .map(|i| (i.action_id.as_str(), i.ordem))
                .collect::<Vec<_>>(),
            // A menor posição vem primeiro; o empate preserva a sequência de
            // entrada, e não uma escolhida por sorteio.
            vec![("midia.proxima", 0), ("midia.parar", 1), ("volume.mudo", 2)],
        );
        let pagina_um: Vec<_> = salvo
            .itens
            .iter()
            .filter(|i| i.pagina == 1)
            .map(|i| i.ordem)
            .collect();
        assert_eq!(pagina_um, vec![0, 1], "cada página recomeça do zero");
        let _ = std::fs::remove_dir_all(pasta);
    }

    fn item(action_id: &str, pagina: u8, ordem: u16) -> ItemDePerfilDeck {
        ItemDePerfilDeck {
            action_id: action_id.to_string(),
            pagina,
            ordem,
            cor: None,
            tamanho: None,
        }
    }

    #[test]
    fn duplicar_remover_e_definir_padrao_persistem() {
        let pasta = pasta("crud");
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        let original = atalhos.configuracao().perfis[0].clone();
        let copia = atalhos.duplicar_perfil(&original.id).unwrap();
        atalhos.definir_perfil_padrao(&copia.id).unwrap();
        atalhos.remover_perfil(&original.id).unwrap();
        let reaberto = AtalhosPersonalizados::carregar(&pasta).unwrap();
        assert_eq!(reaberto.configuracao().perfil_padrao_id, copia.id);
        assert_eq!(reaberto.configuracao().perfis.len(), 1);
        let _ = std::fs::remove_dir_all(pasta);
    }
}
