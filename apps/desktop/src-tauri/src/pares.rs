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
    /// Escopos que vieram da conta, no pareamento.
    pub escopos: Vec<String>,
    /// Escopos concedidos **aqui**, na interface do Agente.
    ///
    /// Campo separado, e não somado a `escopos`, por dois motivos. O primeiro é
    /// que `guardar_confirmado` reconstrói o par a partir do `Dispositivo` da
    /// nuvem: somados, um grant local seria apagado na primeira reconfirmação,
    /// e o sintoma — permissão que funciona e some minutos depois — é dos que
    /// custam um dia para achar. O segundo é que separar deixa legível, no
    /// próprio arquivo, o que a conta concedeu e o que esta máquina concedeu.
    ///
    /// A direção nunca se inverte: a nuvem não escreve aqui.
    #[serde(default, rename = "escoposLocais")]
    pub escopos_locais: Vec<String>,
}

impl ParConfiavel {
    /// O que este par pode de fato, somando conta e concessão local.
    pub fn tem_escopo(&self, escopo: &str) -> bool {
        self.escopos.iter().any(|e| e == escopo)
            || self.escopos_locais.iter().any(|e| e == escopo)
    }
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

        let mut pares = self.pares.write().map_err(|_| ErroPares::Concorrencia)?;

        let novo = ParConfiavel {
            id: dispositivo.id.clone(),
            nome: dispositivo.nome.clone(),
            papel: dispositivo.papel.clone(),
            chave_publica: dispositivo.chave_publica.clone(),
            algoritmo: dispositivo.algoritmo.clone(),
            escopos: dispositivo.escopos.clone(),
            // Preserva o que foi concedido nesta máquina. Sem esta linha, uma
            // reconfirmação de pareamento apagaria a permissão de atalhos sem
            // ninguém ter pedido isso.
            escopos_locais: pares
                .get(&dispositivo.id)
                .map(|antigo| antigo.escopos_locais.clone())
                .unwrap_or_default(),
        };

        let mut candidato = pares.clone();
        candidato.insert(novo.id.clone(), novo);
        gravar_arquivo(&self.caminho, &candidato)?;
        *pares = candidato;
        Ok(())
    }

    pub fn buscar(&self, id: &str) -> Option<ParConfiavel> {
        self.pares.read().ok()?.get(id).cloned()
    }

    /// Concede ou retira um escopo **nesta máquina**, para um par já confiável.
    ///
    /// É o caminho que o ADR-0004 exige para poder que a conta não dá de saída:
    /// quem concede está na frente do computador, e um aparelho jamais amplia
    /// os próprios poderes. Não existe rota de API equivalente de propósito —
    /// a nuvem pode revogar, nunca conceder.
    pub fn definir_escopo_local(
        &self,
        id: &str,
        escopo: &str,
        conceder: bool,
    ) -> Result<(), ErroPares> {
        let mut pares = self.pares.write().map_err(|_| ErroPares::Concorrencia)?;
        let mut candidato = pares.clone();
        let Some(par) = candidato.get_mut(id) else {
            // Conceder poder a quem não é par confiável criaria a entrada pela
            // porta dos fundos, que é exatamente o que `remover_revogados`
            // existe para impedir.
            return Err(ErroPares::DispositivoInvalido);
        };

        let ja_tem = par.escopos_locais.iter().any(|e| e == escopo);
        if conceder == ja_tem {
            return Ok(());
        }
        if conceder {
            par.escopos_locais.push(escopo.to_string());
            par.escopos_locais.sort();
        } else {
            par.escopos_locais.retain(|e| e != escopo);
        }

        gravar_arquivo(&self.caminho, &candidato)?;
        *pares = candidato;
        Ok(())
    }

    pub fn listar(&self) -> Vec<ParConfiavel> {
        let Ok(pares) = self.pares.read() else {
            return Vec::new();
        };
        let mut lista = pares.values().cloned().collect::<Vec<_>>();
        lista.sort_by(|a, b| a.id.cmp(&b.id));
        lista
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

    #[test]
    fn a_concessao_local_sobrevive_a_reconfirmacao_do_pareamento() {
        // A armadilha que este teste tranca: `guardar_confirmado` reconstrói o
        // par a partir do `Dispositivo` da nuvem, e a nuvem não conhece
        // `system.process`. Sem a preservação explícita, autorizar os atalhos
        // funcionaria e a permissão sumiria na reconfirmação seguinte — um
        // defeito que aparece minutos depois da ação que o causou.
        let pasta = pasta("grant-sobrevive");
        let pares = ParesConfiaveis::carregar(&pasta).unwrap();
        pares.guardar_confirmado(&superficie("surface-1")).unwrap();
        pares
            .definir_escopo_local("surface-1", "system.process", true)
            .unwrap();

        // Chega de novo a lista da conta, que continua sem `system.process`.
        pares.guardar_confirmado(&superficie("surface-1")).unwrap();

        assert!(pares.buscar("surface-1").unwrap().tem_escopo("system.process"));

        // E sobrevive também ao fechamento do Agente.
        let reaberto = ParesConfiaveis::carregar(&pasta).unwrap();
        assert!(reaberto.buscar("surface-1").unwrap().tem_escopo("system.process"));
        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn a_concessao_local_pode_ser_retirada() {
        let pasta = pasta("grant-retirado");
        let pares = ParesConfiaveis::carregar(&pasta).unwrap();
        pares.guardar_confirmado(&superficie("surface-1")).unwrap();

        pares
            .definir_escopo_local("surface-1", "system.process", true)
            .unwrap();
        pares
            .definir_escopo_local("surface-1", "system.process", false)
            .unwrap();

        assert!(!pares.buscar("surface-1").unwrap().tem_escopo("system.process"));
        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn nao_concede_poder_a_quem_nao_e_par_confiavel() {
        // Conceder criando a entrada seria a porta dos fundos que
        // `remover_revogados` existe para fechar.
        let pasta = pasta("grant-desconhecido");
        let pares = ParesConfiaveis::carregar(&pasta).unwrap();

        assert!(pares
            .definir_escopo_local("inventado", "system.process", true)
            .is_err());
        assert!(pares.buscar("inventado").is_none());
        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn a_conta_nao_escreve_na_concessao_local() {
        // A nuvem manda `escopos`; `escoposLocais` é só desta máquina. Se um
        // dia a API passar a devolver `system.process`, isso entra como escopo
        // de conta — nunca como concessão local.
        let pasta = pasta("direcao");
        let pares = ParesConfiaveis::carregar(&pasta).unwrap();
        let mut dispositivo = superficie("surface-1");
        dispositivo.escopos = vec!["state.read".into(), "system.process".into()];
        pares.guardar_confirmado(&dispositivo).unwrap();

        assert!(pares.buscar("surface-1").unwrap().escopos_locais.is_empty());
        let _ = std::fs::remove_dir_all(pasta);
    }
}
