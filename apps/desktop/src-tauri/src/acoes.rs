use crate::pares::ParConfiavel;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

const VERSAO_PROTOCOLO: i64 = 1;
const JANELA_TIMESTAMP_MS: i64 = 30_000;

/// Ações que o Agente sabe executar.
///
/// A lista é fechada de propósito, e é o que sustenta a promessa do ADR-0004: o
/// celular manda um identificador, nunca uma tecla, um comando ou um caminho.
/// Nada que chegue pelo canal vira conteúdo executável deste lado.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Acao {
    ReproduzirPausar,
    ProximaFaixa,
    FaixaAnterior,
    Parar,
    AumentarVolume,
    DiminuirVolume,
    Mudo,
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
        "midia.proxima" => Acao::ProximaFaixa,
        "midia.anterior" => Acao::FaixaAnterior,
        "midia.parar" => Acao::Parar,
        // Volume entra sob `system.media` e não sob um escopo próprio: mexer no
        // volume do que já está tocando é a mesma autoridade que pausar, e
        // pedir um escopo novo obrigaria a reparear todo aparelho existente
        // para ganhar um botão de volume.
        "volume.aumentar" => Acao::AumentarVolume,
        "volume.diminuir" => Acao::DiminuirVolume,
        "volume.mudo" => Acao::Mudo,
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
            keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_MEDIA_NEXT_TRACK,
            VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK, VK_MEDIA_STOP, VK_VOLUME_DOWN,
            VK_VOLUME_MUTE, VK_VOLUME_UP,
        };
        let tecla = match acao {
            Acao::ReproduzirPausar => VK_MEDIA_PLAY_PAUSE.0 as u8,
            Acao::ProximaFaixa => VK_MEDIA_NEXT_TRACK.0 as u8,
            Acao::FaixaAnterior => VK_MEDIA_PREV_TRACK.0 as u8,
            Acao::Parar => VK_MEDIA_STOP.0 as u8,
            Acao::AumentarVolume => VK_VOLUME_UP.0 as u8,
            Acao::DiminuirVolume => VK_VOLUME_DOWN.0 as u8,
            Acao::Mudo => VK_VOLUME_MUTE.0 as u8,
        };
        // A ação é deliberadamente limitada a teclas de mídia registradas;
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
    fn toda_a_grade_de_midia_e_reconhecida() {
        // A grade da PWA e a lista daqui precisam falar dos mesmos
        // identificadores. Um botão que existe na tela e não existe aqui é um
        // botão que responde "ação não encontrada" — pior do que não existir.
        let esperadas = [
            ("midia.reproduzir-pausar", Acao::ReproduzirPausar),
            ("midia.proxima", Acao::ProximaFaixa),
            ("midia.anterior", Acao::FaixaAnterior),
            ("midia.parar", Acao::Parar),
            ("volume.aumentar", Acao::AumentarVolume),
            ("volume.diminuir", Acao::DiminuirVolume),
            ("volume.mudo", Acao::Mudo),
        ];

        let par = par(&["action.execute", "system.media"]);
        let mut estado = EstadoComandos::depois_do_hello();

        for (indice, (identificador, esperada)) in esperadas.iter().enumerate() {
            let seq = indice as i64 + 1;
            assert_eq!(
                receber(
                    &pedido(&format!("id-{seq}"), seq, 10_000, identificador),
                    &par,
                    &mut estado,
                    10_000,
                ),
                RecepcaoAcao::Aceita {
                    id: format!("id-{seq}"),
                    acao: *esperada,
                },
                "identificador não reconhecido: {identificador}"
            );
        }
    }

    #[test]
    fn a_grade_inteira_exige_escopo_de_midia() {
        // Vale para as ações novas o mesmo que já valia para o pausar: sem
        // `system.media` nenhuma delas passa. Um botão novo que escapasse da
        // verificação seria uma ampliação silenciosa de poder.
        for identificador in [
            "midia.proxima",
            "midia.anterior",
            "midia.parar",
            "volume.aumentar",
            "volume.diminuir",
            "volume.mudo",
        ] {
            let mut estado = EstadoComandos::depois_do_hello();
            assert_eq!(
                receber(
                    &pedido("um", 1, 10_000, identificador),
                    &par(&["action.execute"]),
                    &mut estado,
                    10_000,
                ),
                RecepcaoAcao::Recusada {
                    id: "um".into(),
                    motivo: "escopo_negado",
                },
                "escapou da verificação de escopo: {identificador}"
            );
        }
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
