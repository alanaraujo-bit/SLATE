use crate::api::Dispositivo;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

const VERSAO_ARQUIVO: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParConfiavel {
    pub id: String,
    pub nome: String,
    pub papel: String,
    #[serde(rename = "chavePublica")]
    pub chave_publica: String,
    pub algoritmo: String,
    pub escopos: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct ArquivoPares {
    versao: u8,
    pares: Vec<ParConfiavel>,
}

#[derive(Debug, thiserror::Error)]
pub enum ErroPares {
    #[error("não foi possível guardar os dispositivos confiáveis")]
    Arquivo(#[from] std::io::Error),
    #[error("a lista local de dispositivos confiáveis está corrompida")]
    Corrompida,
    #[error("não foi possível acessar a lista de dispositivos confiáveis")]
    Concorrencia,
    #[error("o dispositivo confirmado não é uma superfície ativa válida")]
    DispositivoInvalido,
}

/// Raiz de confiança local do Agente.
///
/// Entradas só nascem da confirmação física do pareamento. Sincronizações da
/// nuvem podem remover IDs revogados, mas nunca inserir nem trocar chaves; com
/// isso, comprometer a sinalização continua causando no máximo indisponibilidade.
pub struct ParesConfiaveis {
    caminho: PathBuf,
    pares: RwLock<HashMap<String, ParConfiavel>>,
}

impl ParesConfiaveis {
    pub fn carregar(pasta: &Path) -> Result<Self, ErroPares> {
        std::fs::create_dir_all(pasta)?;
        let caminho = pasta.join("pares-confiaveis.json");
        let reserva = pasta.join("pares-confiaveis.json.reserva");

        let pares = if caminho.exists() {
            ler_arquivo(&caminho).or_else(|_| ler_arquivo(&reserva))?
        } else if reserva.exists() {
            ler_arquivo(&reserva)?
        } else {
            HashMap::new()
        };

        Ok(Self {
            caminho,
            pares: RwLock::new(pares),
        })
    }

    pub fn guardar_confirmado(&self, dispositivo: &Dispositivo) -> Result<(), ErroPares> {
        if dispositivo.papel != "surface"
            || dispositivo.situacao != "ativo"
            || dispositivo.chave_publica.len() < 20
            || !matches!(dispositivo.algoritmo.as_str(), "Ed25519" | "ECDSA-P256")
        {
            return Err(ErroPares::DispositivoInvalido);
        }

        let novo = ParConfiavel {
            id: dispositivo.id.clone(),
            nome: dispositivo.nome.clone(),
            papel: dispositivo.papel.clone(),
            chave_publica: dispositivo.chave_publica.clone(),
            algoritmo: dispositivo.algoritmo.clone(),
            escopos: dispositivo.escopos.clone(),
        };

        let mut pares = self.pares.write().map_err(|_| ErroPares::Concorrencia)?;
        let mut candidato = pares.clone();
        candidato.insert(novo.id.clone(), novo);
        gravar_arquivo(&self.caminho, &candidato)?;
        *pares = candidato;
        Ok(())
    }

    pub fn buscar(&self, id: &str) -> Option<ParConfiavel> {
        self.pares.read().ok()?.get(id).cloned()
    }

    /// Aplica somente remoções. A nuvem não pode criar uma raiz de confiança.
    pub fn remover_revogados(&self, ids: &[String]) -> Result<usize, ErroPares> {
        let ids = ids.iter().collect::<HashSet<_>>();
        let mut pares = self.pares.write().map_err(|_| ErroPares::Concorrencia)?;
        let mut candidato = pares.clone();
        candidato.retain(|id, _| !ids.contains(id));
        let removidos = pares.len().saturating_sub(candidato.len());
        if removidos > 0 {
            gravar_arquivo(&self.caminho, &candidato)?;
            *pares = candidato;
        }
        Ok(removidos)
    }
}

fn ler_arquivo(caminho: &Path) -> Result<HashMap<String, ParConfiavel>, ErroPares> {
    let bruto = std::fs::read(caminho)?;
    let arquivo: ArquivoPares =
        serde_json::from_slice(&bruto).map_err(|_| ErroPares::Corrompida)?;
    if arquivo.versao != VERSAO_ARQUIVO {
        return Err(ErroPares::Corrompida);
    }

    let mut pares = HashMap::new();
    for par in arquivo.pares {
        if par.papel != "surface"
            || par.chave_publica.len() < 20
            || !matches!(par.algoritmo.as_str(), "Ed25519" | "ECDSA-P256")
            || pares.insert(par.id.clone(), par).is_some()
        {
            return Err(ErroPares::Corrompida);
        }
    }
    Ok(pares)
}

fn gravar_arquivo(caminho: &Path, pares: &HashMap<String, ParConfiavel>) -> Result<(), ErroPares> {
    let mut ordenados = pares.values().cloned().collect::<Vec<_>>();
    ordenados.sort_by(|a, b| a.id.cmp(&b.id));
    let bruto = serde_json::to_vec(&ArquivoPares {
        versao: VERSAO_ARQUIVO,
        pares: ordenados,
    })
    .map_err(|_| ErroPares::Corrompida)?;

    let temporario = caminho.with_extension("json.novo");
    let reserva = caminho.with_extension("json.reserva");
    {
        use std::io::Write;
        let mut arquivo = std::fs::File::create(&temporario)?;
        arquivo.write_all(&bruto)?;
        arquivo.sync_all()?;
    }

    // A reserva torna recuperável até uma interrupção entre as duas renomeações.
    if caminho.exists() {
        if reserva.exists() {
            std::fs::remove_file(&reserva)?;
        }
        std::fs::rename(caminho, &reserva)?;
    }
    if let Err(erro) = std::fs::rename(&temporario, caminho) {
        if reserva.exists() && !caminho.exists() {
            let _ = std::fs::rename(&reserva, caminho);
        }
        return Err(erro.into());
    }
    if reserva.exists() {
        std::fs::remove_file(reserva)?;
    }
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;

    fn pasta(nome: &str) -> PathBuf {
        let caminho = std::env::temp_dir().join(format!(
            "slate-pares-{nome}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&caminho).unwrap();
        caminho
    }

    fn superficie(id: &str) -> Dispositivo {
        Dispositivo {
            id: id.into(),
            nome: "Celular".into(),
            papel: "surface".into(),
            situacao: "ativo".into(),
            chave_publica: "a".repeat(43),
            algoritmo: "Ed25519".into(),
            escopos: vec!["state.read".into()],
            online: false,
        }
    }

    #[test]
    fn persiste_a_chave_confirmada_e_reabre() {
        let pasta = pasta("persiste");
        let pares = ParesConfiaveis::carregar(&pasta).unwrap();
        pares.guardar_confirmado(&superficie("surface-1")).unwrap();

        let reaberto = ParesConfiaveis::carregar(&pasta).unwrap();
        assert_eq!(reaberto.buscar("surface-1").unwrap().nome, "Celular");
        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn sincronizacao_remove_mas_nunca_adiciona() {
        let pasta = pasta("revoga");
        let pares = ParesConfiaveis::carregar(&pasta).unwrap();
        pares.guardar_confirmado(&superficie("surface-1")).unwrap();

        assert_eq!(
            pares
                .remover_revogados(&["surface-1".into(), "inventado".into()])
                .unwrap(),
            1
        );
        assert!(pares.buscar("surface-1").is_none());
        assert!(pares.buscar("inventado").is_none());
        let _ = std::fs::remove_dir_all(pasta);
    }
}
