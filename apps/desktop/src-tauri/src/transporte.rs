use crate::acoes::{self, EstadoComandos, RecepcaoAcao};
use crate::api::ClienteApi;
use crate::identidade::{
    mensagem_desafio_sinalizacao, mensagem_fingerprint_dtls, normalizar_fingerprint_dtls,
    verificar_assinatura, Identidade,
};
use crate::pares::{ParConfiavel, ParesConfiaveis};
use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use local_ip_address::list_afinet_netifas;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use webrtc::data_channel::{DataChannel, DataChannelEvent};
use webrtc::peer_connection::{
    register_default_interceptors, MediaEngine, PeerConnection, PeerConnectionBuilder,
    PeerConnectionEventHandler, RTCConfigurationBuilder, RTCIceCandidateInit, RTCIceServer,
    RTCPeerConnectionIceEvent, RTCPeerConnectionState, RTCSessionDescription, Registry,
    SettingEngine,
};
use webrtc::runtime::TokioRuntime;

const VERSAO_PROTOCOLO: i64 = 1;
const VERSAO_APP: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, thiserror::Error)]
pub enum ErroTransporte {
    #[error("não foi possível autenticar a sinalização")]
    Autenticacao,
    #[error("a sinalização respondeu de forma inválida")]
    RespostaInvalida,
    #[error("não foi possível estabelecer o canal em tempo real")]
    WebRtc,
    #[error("a conexão de sinalização foi encerrada")]
    Encerrada,
}

#[derive(Debug, Deserialize)]
struct FingerprintAssinado {
    algoritmo: String,
    valor: String,
    assinatura: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ServidorIce {
    urls: Vec<String>,
    #[serde(default)]
    username: String,
    #[serde(default)]
    credential: String,
}

impl From<ServidorIce> for RTCIceServer {
    fn from(valor: ServidorIce) -> Self {
        Self {
            urls: valor.urls,
            username: valor.username,
            credential: valor.credential,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "tipo")]
enum MensagemServidor {
    #[serde(rename = "pronto")]
    Pronto {
        #[serde(rename = "dispositivoId")]
        dispositivo_id: String,
        papel: String,
        #[serde(rename = "servidoresIce")]
        servidores_ice: Vec<ServidorIce>,
        #[serde(rename = "iceExpiraEm")]
        _ice_expira_em: Option<i64>,
    },
    #[serde(rename = "oferta")]
    Oferta {
        origem: String,
        #[serde(rename = "sessaoId")]
        sessao_id: String,
        sdp: String,
        fingerprint: FingerprintAssinado,
    },
    #[serde(rename = "candidato")]
    Candidato {
        origem: String,
        #[serde(rename = "sessaoId")]
        sessao_id: String,
        candidato: RTCIceCandidateInit,
    },
    #[serde(rename = "encerrar")]
    Encerrar {
        origem: String,
        #[serde(rename = "sessaoId")]
        sessao_id: String,
    },
    #[serde(rename = "revogacoes")]
    Revogacoes {
        #[serde(rename = "dispositivoIds")]
        dispositivo_ids: Vec<String>,
    },
    #[serde(rename = "configuracao-ice")]
    ConfiguracaoIce {
        #[serde(rename = "servidoresIce")]
        servidores_ice: Vec<ServidorIce>,
        #[serde(rename = "iceExpiraEm")]
        _ice_expira_em: Option<i64>,
    },
    #[serde(other)]
    Outro,
}

enum SaidaSinalizacao {
    Candidato {
        destino: String,
        sessao_id: String,
        candidato: RTCIceCandidateInit,
    },
    Encerrar {
        destino: String,
        sessao_id: String,
    },
}

#[derive(Clone)]
struct EventosPar {
    saida: mpsc::UnboundedSender<SaidaSinalizacao>,
    destino: String,
    sessao_id: String,
    dispositivo_id: String,
    pares: Arc<ParesConfiaveis>,
}

#[async_trait]
impl PeerConnectionEventHandler for EventosPar {
    async fn on_ice_candidate(&self, evento: RTCPeerConnectionIceEvent) {
        if let Ok(candidato) = evento.candidate.to_json() {
            let _ = self.saida.send(SaidaSinalizacao::Candidato {
                destino: self.destino.clone(),
                sessao_id: self.sessao_id.clone(),
                candidato,
            });
        }
    }

    async fn on_connection_state_change(&self, estado: RTCPeerConnectionState) {
        if matches!(
            estado,
            RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed
        ) {
            let _ = self.saida.send(SaidaSinalizacao::Encerrar {
                destino: self.destino.clone(),
                sessao_id: self.sessao_id.clone(),
            });
        }
    }

    async fn on_data_channel(&self, canal: Arc<dyn DataChannel>) {
        let destino = self.destino.clone();
        let dispositivo_id = self.dispositivo_id.clone();
        let pares = self.pares.clone();
        tokio::spawn(async move {
            let Ok(rotulo) = canal.label().await else {
                let _ = canal.close().await;
                return;
            };
            if rotulo != "slate" {
                let _ = canal.close().await;
                return;
            }

            let mut aberto = false;
            let mut hello_recebido = false;
            let mut comandos = EstadoComandos::depois_do_hello();
            let mut proxima_sequencia_saida = 1_i64;
            while let Some(evento) = canal.poll().await {
                match evento {
                    DataChannelEvent::OnOpen if !aberto => {
                        aberto = true;
                        let hello = json!({
                            "v": VERSAO_PROTOCOLO,
                            "id": uuid::Uuid::new_v4().to_string(),
                            "t": "evt",
                            "k": "session.hello",
                            "ts": agora_ms(),
                            "seq": 0,
                            "p": {
                                "protocolVersion": VERSAO_PROTOCOLO,
                                "appVersion": VERSAO_APP,
                                "role": "agent",
                                "deviceId": dispositivo_id,
                                "capabilities": ["action.execute", "action.media", "state.system", "state.media"]
                            }
                        });
                        if canal.send_text(&hello.to_string()).await.is_err() {
                            break;
                        }
                    }
                    DataChannelEvent::OnMessage(mensagem) if aberto => {
                        let Some(par) = pares.buscar(&destino) else {
                            let _ = canal.close().await;
                            break;
                        };
                        let Ok(texto) = String::from_utf8(mensagem.data.to_vec()) else {
                            continue;
                        };
                        if !hello_recebido && !hello_superficie_valido(&texto, &destino, agora_ms())
                        {
                            let _ = canal.close().await;
                            break;
                        }
                        if !hello_recebido {
                            hello_recebido = true;
                            comandos = EstadoComandos::depois_do_hello();
                            continue;
                        }

                        match acoes::receber(&texto, &par, &mut comandos, agora_ms()) {
                            RecepcaoAcao::Ignorar => {}
                            RecepcaoAcao::Recusada { id, motivo } => {
                                let resposta = json!({
                                    "v": VERSAO_PROTOCOLO,
                                    "id": id,
                                    "t": "res",
                                    "k": "action.execute.result",
                                    "ts": agora_ms(),
                                    "seq": proxima_sequencia_saida,
                                    "p": {
                                        "accepted": false,
                                        "executionId": id,
                                        "rejectedReason": motivo
                                    }
                                });
                                let _ = canal.send_text(&resposta.to_string()).await;
                            }
                            RecepcaoAcao::Aceita { id, acao } => {
                                let resposta = json!({
                                    "v": VERSAO_PROTOCOLO,
                                    "id": id,
                                    "t": "res",
                                    "k": "action.execute.result",
                                    "ts": agora_ms(),
                                    "seq": proxima_sequencia_saida,
                                    "p": { "accepted": true, "executionId": id }
                                });
                                if canal.send_text(&resposta.to_string()).await.is_err() {
                                    break;
                                }

                                proxima_sequencia_saida += 1;
                                let inicio = Instant::now();
                                let resultado = acoes::executar(acao);
                                let conclusao = json!({
                                    "v": VERSAO_PROTOCOLO,
                                    "id": uuid::Uuid::new_v4().to_string(),
                                    "t": "evt",
                                    "k": "action.result",
                                    "ts": agora_ms(),
                                    "seq": proxima_sequencia_saida,
                                    "p": {
                                        "executionId": id,
                                        "ok": resultado.is_ok(),
                                        "durationMs": inicio.elapsed().as_millis() as i64,
                                        "error": resultado.err()
                                    }
                                });
                                proxima_sequencia_saida += 1;
                                if canal.send_text(&conclusao.to_string()).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    DataChannelEvent::OnClose => break,
                    _ => {}
                }
            }
        });
    }
}

pub async fn executar(api: Arc<ClienteApi>, identidade: Identidade, pares: Arc<ParesConfiaveis>) {
    let mut espera = Duration::from_secs(1);
    loop {
        if let Err(erro) = executar_sessao(api.clone(), &identidade, pares.clone()).await {
            eprintln!("Transporte indisponível: {erro}");
        }
        tokio::time::sleep(espera).await;
        espera = (espera * 2).min(Duration::from_secs(15));
    }
}

async fn executar_sessao(
    api: Arc<ClienteApi>,
    identidade: &Identidade,
    pares: Arc<ParesConfiaveis>,
) -> Result<(), ErroTransporte> {
    let desafio = api
        .pedir_desafio_sinalizacao(&identidade.chave_publica())
        .await
        .map_err(|_| ErroTransporte::Autenticacao)?;
    let prova = mensagem_desafio_sinalizacao(
        &desafio.desafio_id,
        &desafio.dispositivo_id,
        &desafio.nonce,
        desafio.expira_em,
    );
    let token = api
        .trocar_desafio_sinalizacao(
            &desafio.desafio_id,
            &desafio.nonce,
            &identidade.assinar(prova.as_bytes()),
        )
        .await
        .map_err(|_| ErroTransporte::Autenticacao)?;
    if token.expira_em <= agora_ms() {
        return Err(ErroTransporte::Autenticacao);
    }

    let (websocket, _) = connect_async(&desafio.url_sinalizacao)
        .await
        .map_err(|_| ErroTransporte::Encerrada)?;
    let (mut escrita, mut leitura) = websocket.split();
    escrita
        .send(Message::Text(
            json!({ "tipo": "autenticar", "token": token.token })
                .to_string()
                .into(),
        ))
        .await
        .map_err(|_| ErroTransporte::Encerrada)?;

    let (saida_tx, mut saida_rx) = mpsc::unbounded_channel();
    let mut par: Option<Box<dyn PeerConnection>> = None;
    let mut sessao_atual: Option<String> = None;
    let mut superficie_atual: Option<String> = None;
    let mut autenticado = false;
    let mut servidores_ice = Vec::new();

    loop {
        tokio::select! {
            mensagem = leitura.next() => {
                let Some(Ok(Message::Text(texto))) = mensagem else {
                    return Err(ErroTransporte::Encerrada);
                };
                let mensagem: MensagemServidor = serde_json::from_str(texto.as_str())
                    .map_err(|_| ErroTransporte::RespostaInvalida)?;

                match mensagem {
                    MensagemServidor::Pronto {
                        dispositivo_id,
                        papel,
                        servidores_ice: recebidos,
                        _ice_expira_em: _,
                    } => {
                        if dispositivo_id != desafio.dispositivo_id || papel != "agent" {
                            return Err(ErroTransporte::Autenticacao);
                        }
                        servidores_ice = recebidos.into_iter().map(Into::into).collect();
                        autenticado = true;
                    }
                    MensagemServidor::Oferta { origem, sessao_id, sdp, fingerprint }
                        if autenticado => {
                        let Some(superficie) = pares.buscar(&origem) else {
                            let _ = saida_tx.send(SaidaSinalizacao::Encerrar {
                                destino: origem,
                                sessao_id,
                            });
                            continue;
                        };

                        verificar_fingerprint_remoto(
                            &superficie,
                            &sessao_id,
                            &sdp,
                            &fingerprint,
                        )?;

                        let mesma_sessao = superficie_atual.as_deref() == Some(origem.as_str())
                            && sessao_atual.as_deref() == Some(sessao_id.as_str())
                            && par.is_some();
                        if mesma_sessao {
                            aplicar_nova_oferta(par.as_ref().unwrap().as_ref(), sdp).await?;
                        } else {
                            if let Some(anterior) = par.take() {
                                let _ = anterior.close().await;
                            }
                            par = Some(criar_resposta(
                                identidade,
                                &desafio.dispositivo_id,
                                &superficie,
                                pares.clone(),
                                servidores_ice.clone(),
                                &sessao_id,
                                sdp,
                                saida_tx.clone(),
                            ).await?);
                        }

                        let atual = par.as_ref().ok_or(ErroTransporte::WebRtc)?;
                        let local = atual.local_description().await
                            .ok_or(ErroTransporte::WebRtc)?;
                        let fingerprint_local = extrair_fingerprint_dtls(&local.sdp)
                            .ok_or(ErroTransporte::WebRtc)?;
                        let assinatura = identidade.assinar(
                            mensagem_fingerprint_dtls(
                                &sessao_id,
                                &desafio.dispositivo_id,
                                &fingerprint_local,
                            ).as_bytes(),
                        );
                        escrita.send(Message::Text(json!({
                            "tipo": "resposta",
                            "destino": superficie.id,
                            "sessaoId": sessao_id,
                            "sdp": local.sdp,
                            "fingerprint": {
                                "algoritmo": "sha-256",
                                "valor": fingerprint_local,
                                "assinatura": assinatura,
                            }
                        }).to_string().into())).await
                            .map_err(|_| ErroTransporte::Encerrada)?;

                        sessao_atual = Some(sessao_id);
                        superficie_atual = Some(origem);
                    }
                    MensagemServidor::Candidato { origem, sessao_id, candidato }
                        if autenticado
                            && superficie_atual.as_deref() == Some(origem.as_str())
                            && sessao_atual.as_deref() == Some(sessao_id.as_str()) => {
                        if let Some(pc) = par.as_ref() {
                            pc.add_ice_candidate(candidato).await
                                .map_err(|_| ErroTransporte::WebRtc)?;
                        }
                    }
                    MensagemServidor::Encerrar { origem, sessao_id }
                        if superficie_atual.as_deref() == Some(origem.as_str())
                            && sessao_atual.as_deref() == Some(sessao_id.as_str()) => {
                        if let Some(pc) = par.take() {
                            let _ = pc.close().await;
                        }
                        sessao_atual = None;
                        superficie_atual = None;
                    }
                    MensagemServidor::Revogacoes { dispositivo_ids } if autenticado => {
                        pares.remover_revogados(&dispositivo_ids)
                            .map_err(|_| ErroTransporte::Autenticacao)?;
                        if superficie_atual.as_ref().is_some_and(|id|
                            dispositivo_ids.iter().any(|revogado| revogado == id)
                        ) {
                            if let Some(pc) = par.take() {
                                let _ = pc.close().await;
                            }
                            sessao_atual = None;
                            superficie_atual = None;
                        }
                    }
                    MensagemServidor::ConfiguracaoIce {
                        servidores_ice: recebidos,
                        _ice_expira_em: _,
                    } if autenticado => {
                        servidores_ice = recebidos.into_iter().map(Into::into).collect();
                        if let Some(pc) = par.as_ref() {
                            pc.set_configuration(
                                RTCConfigurationBuilder::new()
                                    .with_ice_servers(servidores_ice.clone())
                                    .build(),
                            ).await.map_err(|_| ErroTransporte::WebRtc)?;
                        }
                    }
                    _ => {}
                }
            }
            saida = saida_rx.recv() => {
                let Some(saida) = saida else { return Err(ErroTransporte::Encerrada); };
                let json = match saida {
                    SaidaSinalizacao::Candidato { destino, sessao_id, candidato } => json!({
                        "tipo": "candidato",
                        "destino": destino,
                        "sessaoId": sessao_id,
                        "candidato": candidato,
                    }),
                    SaidaSinalizacao::Encerrar { destino, sessao_id } => json!({
                        "tipo": "encerrar",
                        "destino": destino,
                        "sessaoId": sessao_id,
                    }),
                };
                escrita.send(Message::Text(json.to_string().into())).await
                    .map_err(|_| ErroTransporte::Encerrada)?;
            }
        }
    }
}

async fn criar_resposta(
    _identidade: &Identidade,
    dispositivo_id: &str,
    superficie: &ParConfiavel,
    pares: Arc<ParesConfiaveis>,
    servidores_ice: Vec<RTCIceServer>,
    sessao_id: &str,
    sdp: String,
    saida: mpsc::UnboundedSender<SaidaSinalizacao>,
) -> Result<Box<dyn PeerConnection>, ErroTransporte> {
    let mut media = MediaEngine::default();
    media
        .register_default_codecs()
        .map_err(|_| ErroTransporte::WebRtc)?;
    let registry = register_default_interceptors(Registry::new(), &mut media)
        .map_err(|_| ErroTransporte::WebRtc)?;
    let mut configuracao = SettingEngine::default();
    configuracao.set_multicast_dns_timeout(Some(Duration::from_secs(10)));

    let runtime = Arc::new(TokioRuntime);
    let par = PeerConnectionBuilder::new()
        .with_configuration(
            RTCConfigurationBuilder::new()
                .with_ice_servers(servidores_ice)
                .build(),
        )
        .with_media_engine(media)
        .with_interceptor_registry(registry)
        .with_setting_engine(configuracao)
        .with_handler(Arc::new(EventosPar {
            saida,
            destino: superficie.id.clone(),
            sessao_id: sessao_id.to_string(),
            dispositivo_id: dispositivo_id.to_string(),
            pares,
        }))
        .with_runtime(runtime)
        .with_udp_addrs(enderecos_udp())
        .build()
        .await
        .map_err(|_| ErroTransporte::WebRtc)?;

    par.set_remote_description(
        RTCSessionDescription::offer(sdp).map_err(|_| ErroTransporte::WebRtc)?,
    )
    .await
    .map_err(|_| ErroTransporte::WebRtc)?;
    let resposta = par
        .create_answer(None)
        .await
        .map_err(|_| ErroTransporte::WebRtc)?;
    par.set_local_description(resposta)
        .await
        .map_err(|_| ErroTransporte::WebRtc)?;

    Ok(Box::new(par))
}

/** Responde a uma oferta de ICE restart sem destruir o DataChannel existente. */
async fn aplicar_nova_oferta(par: &dyn PeerConnection, sdp: String) -> Result<(), ErroTransporte> {
    par.set_remote_description(
        RTCSessionDescription::offer(sdp).map_err(|_| ErroTransporte::WebRtc)?,
    )
    .await
    .map_err(|_| ErroTransporte::WebRtc)?;
    let resposta = par
        .create_answer(None)
        .await
        .map_err(|_| ErroTransporte::WebRtc)?;
    par.set_local_description(resposta)
        .await
        .map_err(|_| ErroTransporte::WebRtc)
}

fn verificar_fingerprint_remoto(
    superficie: &ParConfiavel,
    sessao_id: &str,
    sdp: &str,
    fingerprint: &FingerprintAssinado,
) -> Result<(), ErroTransporte> {
    if fingerprint.algoritmo != "sha-256" {
        return Err(ErroTransporte::Autenticacao);
    }
    let no_sdp = extrair_fingerprint_dtls(sdp).ok_or(ErroTransporte::Autenticacao)?;
    if no_sdp != normalizar_fingerprint_dtls(&fingerprint.valor) {
        return Err(ErroTransporte::Autenticacao);
    }
    let mensagem = mensagem_fingerprint_dtls(sessao_id, &superficie.id, &fingerprint.valor);
    if !verificar_assinatura(
        &superficie.chave_publica,
        &superficie.algoritmo,
        mensagem.as_bytes(),
        &fingerprint.assinatura,
    ) {
        return Err(ErroTransporte::Autenticacao);
    }
    Ok(())
}

fn enderecos_udp() -> Vec<String> {
    let mut enderecos = list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .map(|(_, ip)| ip)
        .filter(|ip| !ip.is_loopback() && !ip.is_unspecified())
        .map(|ip| match ip {
            std::net::IpAddr::V4(ip) => format!("{ip}:0"),
            std::net::IpAddr::V6(ip) => format!("[{ip}]:0"),
        })
        .collect::<Vec<_>>();
    if enderecos.is_empty() {
        enderecos.push("0.0.0.0:0".to_string());
    }
    enderecos
}

fn extrair_fingerprint_dtls(sdp: &str) -> Option<String> {
    sdp.lines().find_map(|linha| {
        let linha = linha.trim();
        linha
            .strip_prefix("a=fingerprint:sha-256 ")
            .map(normalizar_fingerprint_dtls)
    })
}

fn hello_superficie_valido(bruto: &str, dispositivo_id: &str, agora: i64) -> bool {
    let Ok(valor) = serde_json::from_str::<Value>(bruto) else {
        return false;
    };
    valor.get("v").and_then(Value::as_i64) == Some(VERSAO_PROTOCOLO)
        && valor.get("t").and_then(Value::as_str) == Some("evt")
        && valor.get("k").and_then(Value::as_str) == Some("session.hello")
        && valor
            .get("ts")
            .and_then(Value::as_i64)
            .is_some_and(|ts| (agora - ts).abs() <= 30_000)
        && valor.pointer("/p/protocolVersion").and_then(Value::as_i64) == Some(VERSAO_PROTOCOLO)
        && valor.pointer("/p/role").and_then(Value::as_str) == Some("surface")
        && valor.pointer("/p/deviceId").and_then(Value::as_str) == Some(dispositivo_id)
}

fn agora_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn extrai_e_normaliza_fingerprint_do_sdp() {
        let fp = (0..32).map(|_| "ab").collect::<Vec<_>>().join(":");
        let sdp = format!("v=0\r\na=fingerprint:sha-256 {fp}\r\n");
        assert_eq!(
            extrair_fingerprint_dtls(&sdp),
            Some(fp.to_ascii_uppercase())
        );
    }

    #[test]
    fn hello_so_e_aceito_para_a_superficie_esperada_e_dentro_da_janela() {
        let agora = 1_786_768_350_610_i64;
        let valido = json!({
            "v": 1,
            "id": "mensagem",
            "t": "evt",
            "k": "session.hello",
            "ts": agora,
            "seq": 0,
            "p": {
                "protocolVersion": 1,
                "appVersion": "0.1.0",
                "role": "surface",
                "deviceId": "surface-1",
                "capabilities": []
            }
        });
        assert!(hello_superficie_valido(
            &valido.to_string(),
            "surface-1",
            agora
        ));
        assert!(!hello_superficie_valido(
            &valido.to_string(),
            "outra",
            agora
        ));

        let mut obsoleto = valido.clone();
        obsoleto["ts"] = json!(agora - 30_001);
        assert!(!hello_superficie_valido(
            &obsoleto.to_string(),
            "surface-1",
            agora
        ));
    }
}
