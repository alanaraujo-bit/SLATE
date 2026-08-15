use crate::pares::ParConfiavel;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

const VERSAO_PROTOCOLO: i64 = 1;
const JANELA_TIMESTAMP_MS: i64 = 30_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Acao {
    ReproduzirPausar,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RecepcaoAcao {
    Ignorar,
    Recusada { id: String, motivo: &'static str },
    Aceita { id: String, acao: Acao },
}

#[derive(Default)]
pub struct EstadoComandos {
    ultima_sequencia: i64,
    iniciou: bool,
    ids_vistos: HashSet<String>,
}

impl EstadoComandos {
    pub fn depois_do_hello() -> Self {
        Self {
            ultima_sequencia: 0,
            iniciou: true,
            ids_vistos: HashSet::new(),
        }
    }
}

#[derive(Deserialize)]
struct Envelope {
    v: i64,
    id: String,
    t: String,
    k: String,
    ts: i64,
    seq: i64,
    p: Pedido,
}

#[derive(Deserialize)]
struct Pedido {
    #[serde(rename = "actionId")]
    action_id: String,
    #[serde(default)]
    vars: Option<HashMap<String, String>>,
}

pub fn receber(
    bruto: &str,
    par: &ParConfiavel,
    estado: &mut EstadoComandos,
    agora: i64,
) -> RecepcaoAcao {
    let Ok(envelope) = serde_json::from_str::<Envelope>(bruto) else {
        return RecepcaoAcao::Ignorar;
    };
    if !estado.iniciou
        || envelope.v != VERSAO_PROTOCOLO
        || envelope.id.is_empty()
        || envelope.id.len() > 64
        || envelope.t != "req"
        || envelope.k != "action.execute"
        || envelope.ts < 0
        || (agora - envelope.ts).abs() > JANELA_TIMESTAMP_MS
        || envelope.seq <= estado.ultima_sequencia
        || estado.ids_vistos.contains(&envelope.id)
        || envelope.p.action_id.is_empty()
        || envelope.p.action_id.len() > 128
        || envelope.p.vars.as_ref().is_some_and(|vars| {
            vars.iter()
                .any(|(chave, valor)| chave.len() > 64 || valor.len() > 2_048)
        })
    {
        return RecepcaoAcao::Ignorar;
    }

    estado.ultima_sequencia = envelope.seq;
    estado.ids_vistos.insert(envelope.id.clone());

    if !par.escopos.iter().any(|e| e == "action.execute")
        || !par.escopos.iter().any(|e| e == "system.media")
    {
        return RecepcaoAcao::Recusada {
            id: envelope.id,
            motivo: "escopo_negado",
        };
    }

    let acao = match envelope.p.action_id.as_str() {
        "midia.reproduzir-pausar" => Acao::ReproduzirPausar,
        _ => {
            return RecepcaoAcao::Recusada {
                id: envelope.id,
                motivo: "nao_encontrada",
            }
        }
    };
    RecepcaoAcao::Aceita {
        id: envelope.id,
        acao,
    }
}

pub fn executar(acao: Acao) -> Result<(), &'static str> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_MEDIA_PLAY_PAUSE,
        };
        let tecla = match acao {
            Acao::ReproduzirPausar => VK_MEDIA_PLAY_PAUSE.0 as u8,
        };
        // A ação é deliberadamente limitada a uma tecla de mídia registrada;
        // nenhum código, atalho ou conteúdo arbitrário chega ao Windows.
        unsafe {
            keybd_event(tecla, 0, KEYBD_EVENT_FLAGS(0), 0);
            keybd_event(tecla, 0, KEYEVENTF_KEYUP, 0);
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = acao;
        Err("ação disponível apenas no Windows")
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn par(escopos: &[&str]) -> ParConfiavel {
        ParConfiavel {
            id: "superficie-1".into(),
            nome: "Celular".into(),
            papel: "surface".into(),
            chave_publica: "chave-publica-com-tamanho-suficiente".into(),
            algoritmo: "Ed25519".into(),
            escopos: escopos.iter().map(|e| (*e).into()).collect(),
        }
    }

    fn pedido(id: &str, seq: i64, ts: i64, action_id: &str) -> String {
        serde_json::json!({
            "v": 1, "id": id, "t": "req", "k": "action.execute",
            "ts": ts, "seq": seq, "p": { "actionId": action_id }
        })
        .to_string()
    }

    #[test]
    fn aceita_somente_acao_registrada_com_os_dois_escopos() {
        let mut estado = EstadoComandos::depois_do_hello();
        assert_eq!(
            receber(
                &pedido("um", 1, 10_000, "midia.reproduzir-pausar"),
                &par(&["action.execute", "system.media"]),
                &mut estado,
                10_000,
            ),
            RecepcaoAcao::Aceita {
                id: "um".into(),
                acao: Acao::ReproduzirPausar,
            }
        );
    }

    #[test]
    fn recusa_sem_escopo_de_midia() {
        let mut estado = EstadoComandos::depois_do_hello();
        assert_eq!(
            receber(
                &pedido("um", 1, 10_000, "midia.reproduzir-pausar"),
                &par(&["action.execute"]),
                &mut estado,
                10_000,
            ),
            RecepcaoAcao::Recusada {
                id: "um".into(),
                motivo: "escopo_negado",
            }
        );
    }

    #[test]
    fn repeticao_timestamp_antigo_e_tipo_desconhecido_nao_executam() {
        let par = par(&["action.execute", "system.media"]);
        let mut estado = EstadoComandos::depois_do_hello();
        let valido = pedido("um", 1, 10_000, "midia.reproduzir-pausar");
        assert!(matches!(
            receber(&valido, &par, &mut estado, 10_000),
            RecepcaoAcao::Aceita { .. }
        ));
        assert_eq!(
            receber(&valido, &par, &mut estado, 10_000),
            RecepcaoAcao::Ignorar
        );
        assert_eq!(
            receber(
                &pedido("dois", 2, 1, "midia.reproduzir-pausar"),
                &par,
                &mut estado,
                40_002,
            ),
            RecepcaoAcao::Ignorar
        );
        assert_eq!(
            receber(
                &pedido("tres", 2, 10_000, "inventada"),
                &par,
                &mut estado,
                10_000
            ),
            RecepcaoAcao::Recusada {
                id: "tres".into(),
                motivo: "nao_encontrada",
            }
        );
    }
}
