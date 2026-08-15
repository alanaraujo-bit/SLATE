//! Sonda de interoperabilidade usada pelo Playwright.
//!
//! Ela conversa por stdin/stdout com o teste do navegador e nunca abre HTTP ou
//! WebSocket local. Assim, exercitamos a pilha WebRTC real do Agente sem
//! reintroduzir no produto o transporte local descartado pelo ADR-0002.

use async_trait::async_trait;
use local_ip_address::list_afinet_netifas;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::error::Error;
use std::io::{self, Write};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use webrtc::data_channel::{DataChannel, DataChannelEvent};
use webrtc::peer_connection::{
    register_default_interceptors, MediaEngine, PeerConnection, PeerConnectionBuilder,
    PeerConnectionEventHandler, RTCConfigurationBuilder, RTCIceGatheringState, RTCIceServer,
    RTCSessionDescription, Registry, SettingEngine,
};
use webrtc::runtime::TokioRuntime;

#[derive(Deserialize)]
struct Entrada {
    sdp: String,
    #[serde(default, rename = "servidoresIce")]
    servidores_ice: Vec<ServidorIce>,
}

#[derive(Deserialize)]
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

#[derive(Serialize)]
struct Saida<'a> {
    sdp: &'a str,
}

struct Eventos {
    resultado: mpsc::UnboundedSender<Result<(), String>>,
    coleta_concluida: mpsc::UnboundedSender<()>,
}

#[async_trait]
impl PeerConnectionEventHandler for Eventos {
    async fn on_ice_gathering_state_change(&self, estado: RTCIceGatheringState) {
        if estado == RTCIceGatheringState::Complete {
            let _ = self.coleta_concluida.send(());
        }
    }

    async fn on_data_channel(&self, canal: Arc<dyn DataChannel>) {
        let resultado = self.resultado.clone();
        tokio::spawn(async move {
            let mut hello_recebido = false;
            let mut resultado_enviado = false;
            if canal.label().await.as_deref() != Ok("slate") {
                let _ = resultado.send(Err("rótulo do DataChannel inesperado".into()));
                let _ = canal.close().await;
                return;
            }

            while let Some(evento) = canal.poll().await {
                match evento {
                    DataChannelEvent::OnOpen => {
                        let hello = json!({
                            "v": 1,
                            "id": "hello-agente-rust",
                            "t": "evt",
                            "k": "session.hello",
                            "ts": agora_ms(),
                            "seq": 0,
                            "p": {
                                "protocolVersion": 1,
                                "appVersion": env!("CARGO_PKG_VERSION"),
                                "role": "agent",
                                "deviceId": "agente-rust-teste",
                                "capabilities": ["action.execute", "action.media", "state.system", "state.media"]
                            }
                        });
                        if canal.send_text(&hello.to_string()).await.is_err() {
                            let _ = resultado.send(Err("não enviou hello do Agente".into()));
                            return;
                        }
                    }
                    DataChannelEvent::OnMessage(mensagem) => {
                        let Ok(texto) = String::from_utf8(mensagem.data.to_vec()) else {
                            let _ = resultado.send(Err("hello do navegador não era UTF-8".into()));
                            return;
                        };

                        if resultado_enviado {
                            if confirmacao_resultado_valida(&texto) {
                                let _ = resultado.send(Ok(()));
                            } else {
                                let _ = resultado
                                    .send(Err("confirmação do navegador era inválida".into()));
                            }
                            return;
                        }

                        if !hello_recebido {
                            if hello_superficie_valido(&texto) {
                                hello_recebido = true;
                                continue;
                            }
                            let _ = resultado.send(Err("hello do navegador era inválido".into()));
                            return;
                        }

                        let Some(id) = pedido_acao_valido(&texto) else {
                            let _ = resultado
                                .send(Err("pedido de ação do navegador era inválido".into()));
                            return;
                        };
                        let resposta = json!({
                            "v": 1, "id": "resposta-acao-rust", "t": "res",
                            "k": "action.execute.result", "ts": agora_ms(), "seq": 1,
                            "p": { "accepted": true, "executionId": id }
                        });
                        let conclusao = json!({
                            "v": 1, "id": "resultado-acao-rust", "t": "evt",
                            "k": "action.result", "ts": agora_ms(), "seq": 2,
                            "p": { "executionId": id, "ok": true, "durationMs": 1 }
                        });
                        if canal.send_text(&resposta.to_string()).await.is_err()
                            || canal.send_text(&conclusao.to_string()).await.is_err()
                        {
                            let _ = resultado.send(Err("não enviou o resultado da ação".into()));
                            return;
                        }
                        resultado_enviado = true;
                    }
                    DataChannelEvent::OnClose => {
                        let _ = resultado.send(Err("canal fechou antes do hello".into()));
                        return;
                    }
                    _ => {}
                }
            }
        });
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let mut linha = String::new();
    io::stdin().read_line(&mut linha)?;
    let entrada: Entrada = serde_json::from_str(&linha)?;

    let mut media = MediaEngine::default();
    media.register_default_codecs()?;
    let registry = register_default_interceptors(Registry::new(), &mut media)?;
    let mut configuracao = SettingEngine::default();
    configuracao.set_multicast_dns_timeout(Some(Duration::from_secs(10)));
    let (resultado_tx, mut resultado_rx) = mpsc::unbounded_channel();
    let (coleta_tx, mut coleta_rx) = mpsc::unbounded_channel();

    let par = PeerConnectionBuilder::new()
        .with_configuration(
            RTCConfigurationBuilder::new()
                .with_ice_servers(entrada.servidores_ice.into_iter().map(Into::into).collect())
                .build(),
        )
        .with_media_engine(media)
        .with_interceptor_registry(registry)
        .with_setting_engine(configuracao)
        .with_handler(Arc::new(Eventos {
            resultado: resultado_tx,
            coleta_concluida: coleta_tx,
        }))
        .with_runtime(Arc::new(TokioRuntime))
        .with_udp_addrs(enderecos_udp())
        .build()
        .await?;

    par.set_remote_description(RTCSessionDescription::offer(entrada.sdp)?)
        .await?;
    let resposta = par.create_answer(None).await?;
    par.set_local_description(resposta).await?;
    tokio::time::timeout(Duration::from_secs(15), coleta_rx.recv())
        .await?
        .ok_or("coleta ICE encerrou sem concluir")?;
    let local = par
        .local_description()
        .await
        .ok_or("resposta local ausente")?;

    println!("{}", serde_json::to_string(&Saida { sdp: &local.sdp })?);
    io::stdout().flush()?;

    match tokio::time::timeout(Duration::from_secs(20), resultado_rx.recv()).await {
        Ok(Some(Ok(()))) => {
            par.close().await?;
            Ok(())
        }
        Ok(Some(Err(erro))) => Err(erro.into()),
        Ok(None) => Err("sonda encerrou sem resultado".into()),
        Err(_) => Err("tempo esgotado aguardando o DataChannel".into()),
    }
}

fn hello_superficie_valido(bruto: &str) -> bool {
    let Ok(valor) = serde_json::from_str::<Value>(bruto) else {
        return false;
    };
    valor.get("v").and_then(Value::as_i64) == Some(1)
        && valor.get("t").and_then(Value::as_str) == Some("evt")
        && valor.get("k").and_then(Value::as_str) == Some("session.hello")
        && valor.pointer("/p/protocolVersion").and_then(Value::as_i64) == Some(1)
        && valor.pointer("/p/role").and_then(Value::as_str) == Some("surface")
        && valor.pointer("/p/deviceId").and_then(Value::as_str) == Some("superficie-browser-teste")
}

fn pedido_acao_valido(bruto: &str) -> Option<String> {
    let valor = serde_json::from_str::<Value>(bruto).ok()?;
    (valor.get("v").and_then(Value::as_i64) == Some(1)
        && valor.get("t").and_then(Value::as_str) == Some("req")
        && valor.get("k").and_then(Value::as_str) == Some("action.execute")
        && valor.pointer("/p/actionId").and_then(Value::as_str) == Some("midia.reproduzir-pausar"))
    .then(|| {
        valor
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    })
    .filter(|id| !id.is_empty())
}

fn confirmacao_resultado_valida(bruto: &str) -> bool {
    let Ok(valor) = serde_json::from_str::<Value>(bruto) else {
        return false;
    };
    valor.get("k").and_then(Value::as_str) == Some("teste.resultado-recebido")
        && valor.pointer("/p/executionId").and_then(Value::as_str) == Some("acao-browser-1")
}

fn enderecos_udp() -> Vec<String> {
    // Navegador e sonda rodam na mesma máquina. Manter loopback como caminho
    // determinístico evita que VPNs e adaptadores virtuais tornem o teste
    // intermitente; os endereços reais continuam presentes para cobrir ICE.
    let mut enderecos = vec!["127.0.0.1:0".to_string()];
    enderecos.extend(
        list_afinet_netifas()
            .unwrap_or_default()
            .into_iter()
            .map(|(_, ip)| ip)
            .filter(|ip| !ip.is_loopback() && !ip.is_unspecified())
            .map(|ip| match ip {
                std::net::IpAddr::V4(ip) => format!("{ip}:0"),
                std::net::IpAddr::V6(ip) => format!("[{ip}]:0"),
            })
            .collect::<Vec<_>>(),
    );
    enderecos
}

fn agora_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
