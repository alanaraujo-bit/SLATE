use crate::acoes::{self, EstadoComandos, RecepcaoAcao};
use crate::atalhos::{Atalho, AtalhosPersonalizados, ConfiguracaoDeck, PerfilDeDeck};
use crate::api::ClienteApi;
use crate::energia;
use crate::identidade::{
    mensagem_desafio_sinalizacao, mensagem_fingerprint_dtls, normalizar_fingerprint_dtls,
    verificar_assinatura, Identidade,
};
use crate::pares::{ParConfiavel, ParesConfiaveis};
use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use local_ip_address::list_afinet_netifas;
use serde::{Deserialize, Serialize};
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

/// Anuncia o que este par pode fazer, e o deck que ele pode abrir.
///
/// Chamada na abertura do canal **e** de novo quando a permissão daquele
/// aparelho muda na janela. Reenviar o hello é o que faz a grade do celular
/// ganhar e perder os atalhos na hora: a PWA renegocia as capacidades a cada
/// hello que recebe, sem precisar reconectar.
///
/// Devolve `false` quando o canal já não aceita escrita — o chamador encerra.
async fn anunciar_sessao(
    canal: &Arc<dyn DataChannel>,
    pares: &ParesConfiaveis,
    atalhos: &AtalhosPersonalizados,
    destino: &str,
    dispositivo_id: &str,
    proxima_sequencia: &mut i64,
) -> bool {
    // As capacidades são montadas por par, e não uma vez para o Agente
    // inteiro: `action.atalhos` só é anunciada a quem recebeu a concessão
    // nesta máquina. Dois celulares no mesmo computador recebem helos
    // diferentes.
    let mut capacidades = vec![
        "action.execute",
        "action.media",
        "action.media.completo",
        "state.system",
        "state.media",
    ];
    let pode_abrir_programas = pares
        .buscar(destino)
        .is_some_and(|par| par.tem_escopo("system.process"));
    if pode_abrir_programas {
        capacidades.push("action.atalhos");
        capacidades.push("deck.sync");
    }

    // Energia, pelo mesmo desenho dos atalhos: anunciada por par, e só a quem
    // recebeu a concessão nesta máquina (ADR-0006 §6). Retirar a permissão na
    // janela reenvia o hello, a capacidade some e a grade do celular perde os
    // controles de energia na hora, sem reconectar.
    let pode_energia = pares
        .buscar(destino)
        .is_some_and(|par| par.tem_escopo("system.power"));
    if pode_energia {
        capacidades.push("energia.controle");
    }
    // Ser ponte é pergunta diferente de controlar a própria energia: uma é "o
    // que este computador faz consigo mesmo", a outra é "este computador serve
    // para ligar os outros".
    if pares
        .buscar(destino)
        .is_some_and(|par| par.tem_escopo("system.wake"))
    {
        capacidades.push("energia.ponte");
    }

    let sequencia_do_hello = *proxima_sequencia;
    *proxima_sequencia += 1;
    let hello = json!({
        "v": VERSAO_PROTOCOLO,
        "id": uuid::Uuid::new_v4().to_string(),
        "t": "evt",
        "k": "session.hello",
        "ts": agora_ms(),
        "seq": sequencia_do_hello,
        "p": {
            "protocolVersion": VERSAO_PROTOCOLO,
            "appVersion": VERSAO_APP,
            "role": "agent",
            "deviceId": dispositivo_id,
            "capabilities": capacidades
        }
    });
    if canal.send_text(&hello.to_string()).await.is_err() {
        return false;
    }

    // O deck vai atrás do hello, e só a quem pode abrir programas: para os
    // demais seria uma grade de teclas que respondem "escopo negado", pior do
    // que não ter as teclas.
    //
    // Quando a permissão é retirada, o hello sozinho já esvazia a grade do
    // outro lado — a capacidade some, e com ela o grupo inteiro.
    if pode_abrir_programas {
        for conteudo in mensagens_do_deck(&atalhos.listar(), &atalhos.configuracao()) {
            let mensagem = json!({
                "v": VERSAO_PROTOCOLO,
                "id": uuid::Uuid::new_v4().to_string(),
                "t": "evt",
                "k": "deck.estado",
                "ts": agora_ms(),
                "seq": *proxima_sequencia,
                "p": conteudo
            });
            *proxima_sequencia += 1;
            if canal.send_text(&mensagem.to_string()).await.is_err() {
                return false;
            }
        }
    }

    // O perfil de energia vai atrás do hello, e só a quem pode usá-lo. Sem ele
    // a PWA não tem como decidir o que mostrar: quais botões existem, se há
    // Pronto para Retorno, e o que dizer quando não há. Uma grade de energia
    // desenhada sem perfil seria otimismo — exatamente o que o ADR-0006 proíbe.
    if pode_energia {
        // `tem_ponte` é `false` enquanto a nuvem não souber responder quem está
        // online naquela rede (P3-M5-T6). É a resposta conservadora, e a certa:
        // ela produz PADRÃO em vez de COMPLETO, ou seja, promete de menos.
        let perfil = energia::montar_perfil(&energia::detectar_com_cache(), false, None);
        let mensagem = json!({
            "v": VERSAO_PROTOCOLO,
            "id": uuid::Uuid::new_v4().to_string(),
            "t": "evt",
            "k": "energia.estado",
            "ts": agora_ms(),
            "seq": *proxima_sequencia,
            "p": { "perfil": perfil, "podeSerPonte": false }
        });
        *proxima_sequencia += 1;
        if canal.send_text(&mensagem.to_string()).await.is_err() {
            return false;
        }
    }

    true
}

/// Teto por mensagem de deck, em bytes.
///
/// Um DataChannel não entrega mensagem de qualquer tamanho, e estourar o limite
/// do SCTP não devolve erro legível: derruba o canal. 48 KiB fica com folga
/// abaixo do que qualquer navegador aceita numa mensagem só.
const LIMITE_MENSAGEM_DECK: usize = 48 * 1024;

/// Um atalho como ele viaja até o celular.
///
/// **Struct separada de `Atalho` de propósito.** `Atalho` tem `caminho`, e
/// serializar aquele struct direto entregaria a cada aparelho pareado o mapa do
/// disco deste computador. A promessa do ADR-0004 é que o caminho nunca
/// atravessa o canal — em nenhuma das duas direções.
#[derive(Serialize)]
struct AtalhoNoCanal<'a> {
    id: &'a str,
    nome: &'a str,
    cor: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    icone: Option<&'a str>,
}

/// Avisa uma sessão aberta de que outro painel passou a valer.
///
/// `reason: "regra"` distingue esta troca de uma escolha da pessoa, e é o que
/// permite ao celular decidir se obedece — um toque deliberado não pode ser
/// arrancado da mão a cada segundo.
async fn anunciar_contexto(
    canal: &Arc<dyn DataChannel>,
    perfil: &str,
    proxima_sequencia: &mut i64,
) -> bool {
    let mensagem = json!({
        "v": VERSAO_PROTOCOLO,
        "id": uuid::Uuid::new_v4().to_string(),
        "t": "evt",
        "k": "context.changed",
        "ts": agora_ms(),
        "seq": *proxima_sequencia,
        "p": { "profileId": perfil, "reason": "regra" }
    });
    *proxima_sequencia += 1;
    canal.send_text(&mensagem.to_string()).await.is_ok()
}

/// De quanto em quanto tempo o primeiro plano é conferido.
///
/// Um segundo e meio é curto o bastante para a troca parecer imediata a quem
/// alt-tabou, e longo o bastante para o custo ser irrelevante — são três
/// chamadas baratas ao Windows, e só quando existe alguma regra configurada.
const INTERVALO_DE_FOCO: std::time::Duration = std::time::Duration::from_millis(1500);

/// Observa o programa em primeiro plano e anuncia o painel que ele pede.
///
/// **Fica calada enquanto ninguém configura uma regra.** É o que garante que
/// atualizar o Agente não liga comportamento nenhum: depois da migração todo
/// painel nasce sem regra, e esta função só chega a perguntar ao Windows
/// depois que alguém digitou um executável no editor.
///
/// Nada aqui trata ausência de leitura como erro. Processo elevado, área de
/// trabalho em foco, tela bloqueada — todos devolvem nada, e nada significa
/// "deixe o painel onde está".
pub async fn vigiar_primeiro_plano(atalhos: Arc<AtalhosPersonalizados>, avisos: AvisoDePermissao) {
    let mut ultimo_programa: Option<String> = None;
    let mut ultimo_perfil: Option<String> = None;

    loop {
        tokio::time::sleep(INTERVALO_DE_FOCO).await;

        let configuracao = atalhos.configuracao();
        if !crate::atalhos::alguem_quer_contexto(&configuracao.perfis) {
            // Esquece o que viu: se alguém apagar e recriar a mesma regra, a
            // troca precisa voltar a acontecer em vez de ser suprimida por uma
            // lembrança de outra configuração.
            ultimo_programa = None;
            ultimo_perfil = None;
            continue;
        }

        let Some(programa) = crate::foco::programa_em_primeiro_plano() else {
            continue;
        };
        if ultimo_programa.as_deref() == Some(programa.as_str()) {
            continue;
        }
        ultimo_programa = Some(programa.clone());

        let Some(perfil) = crate::atalhos::perfil_para_programa(&programa, &configuracao.perfis)
        else {
            // Programa sem regra não devolve ninguém ao painel inicial: quem
            // abriu o bloco de notas no meio de uma transmissão não quer perder
            // os controles que estava usando.
            continue;
        };
        if ultimo_perfil.as_deref() == Some(perfil.id.as_str()) {
            continue;
        }
        ultimo_perfil = Some(perfil.id.clone());
        let _ = avisos.send(Aviso::Contexto {
            perfil: perfil.id.clone(),
        });
    }
}

/// Um painel como ele viaja até o celular.
///
/// **Struct separada de `PerfilDeDeck` pelo mesmo motivo que `AtalhoNoCanal`.**
/// O perfil guarda `regras` — os executáveis que o fazem entrar sozinho —, e
/// serializar aquele struct direto contaria a cada aparelho pareado quais
/// programas existem neste computador. É a mesma classe de vazamento que o
/// `caminho`, com outro nome, e o ADR-0004 vale igual para os dois.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PerfilNoCanal<'a> {
    id: &'a str,
    nome: &'a str,
    cor: &'a str,
    colunas_retrato: u8,
    colunas_paisagem: u8,
    itens: &'a [crate::atalhos::ItemDePerfilDeck],
}

impl<'a> From<&'a PerfilDeDeck> for PerfilNoCanal<'a> {
    fn from(perfil: &'a PerfilDeDeck) -> Self {
        Self {
            id: &perfil.id,
            nome: &perfil.nome,
            cor: &perfil.cor,
            colunas_retrato: perfil.colunas_retrato,
            colunas_paisagem: perfil.colunas_paisagem,
            itens: &perfil.itens,
        }
    }
}

/// Monta os conteúdos de `deck.estado`, já fatiados para caberem no canal.
///
/// Sempre devolve ao menos uma mensagem: lista vazia precisa chegar do mesmo
/// jeito, senão o celular continuaria mostrando os atalhos de um cadastro que
/// já não existe.
fn mensagens_do_deck(atalhos: &[Atalho], configuracao: &ConfiguracaoDeck) -> Vec<Value> {
    let mut fatias: Vec<Vec<Value>> = vec![Vec::new()];
    let mut tamanho = 0usize;

    for atalho in atalhos {
        let item = serde_json::to_value(AtalhoNoCanal {
            id: &atalho.id,
            nome: &atalho.nome,
            cor: &atalho.cor,
            icone: atalho.icone.as_deref(),
        })
        .unwrap_or(Value::Null);
        let peso = item.to_string().len();

        // Um item sozinho maior que o teto ainda vai numa mensagem própria: é o
        // melhor possível, e recusá-lo tiraria o atalho da grade sem explicar.
        let atual = fatias.last_mut().expect("sempre há uma fatia");
        if !atual.is_empty() && tamanho + peso > LIMITE_MENSAGEM_DECK {
            fatias.push(vec![item]);
            tamanho = peso;
        } else {
            atual.push(item);
            tamanho += peso;
        }
    }

    let total = fatias.len();
    fatias
        .into_iter()
        .enumerate()
        .map(|(indice, itens)| {
            let mut conteudo = json!({ "atalhos": itens });
            // Os painéis viajam **só na primeira fatia**, e isso é combinado
            // com a remontagem do outro lado: a PWA zera os perfis ao ver
            // `parte == 1` e sobrescreve se uma fatia posterior trouxer o
            // campo. Repetir a lista em toda fatia gastaria banda do canal
            // sem mudar o resultado; omiti-la da primeira apagaria os painéis.
            //
            // São leves de propósito — um item de perfil é um identificador,
            // não um ícone —, então cabem junto do primeiro lote de PNGs.
            if indice == 0 {
                let perfis: Vec<PerfilNoCanal> =
                    configuracao.perfis.iter().map(PerfilNoCanal::from).collect();
                conteudo["perfis"] = json!(perfis);
                conteudo["perfilPadraoId"] = json!(configuracao.perfil_padrao_id);
            }
            // `parte`/`total` só aparecem quando há mais de uma: a lista comum
            // cabe inteira, e anunciar fatia de uma fatia só seria ruído.
            if total > 1 {
                conteudo["parte"] = json!(indice + 1);
                conteudo["total"] = json!(total);
            }
            conteudo
        })
        .collect()
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

/**
 * Avisa as sessões abertas que a permissão de um aparelho mudou.
 *
 * Sem isto, marcar a caixa na janela só valia na conexão seguinte: as
 * capacidades são anunciadas no hello, e o hello já tinha ido embora. Na
 * prática a pessoa marcava, nada acontecia, e a saída era fechar e abrir o
 * aplicativo no celular — que é a definição de um sistema que parece quebrado
 * mesmo funcionando.
 *
 * `broadcast` porque pode haver vários aparelhos ligados ao mesmo tempo, e
 * cada canal precisa ver o aviso para decidir se é sobre ele.
 */
/// O que a janela — ou a vigilância do primeiro plano — tem a dizer às sessões
/// que já estão abertas.
///
/// Um canal só, com duas mensagens, e não dois canais: os dois avisos precisam
/// chegar ao mesmo lugar, no mesmo `select!`, e cada canal novo teria de ser
/// costurado por quatro assinaturas até o `EventosPar`.
#[derive(Clone, Debug)]
pub enum Aviso {
    /// A permissão de um aparelho mudou. Carrega o destino, ou `AVISO_TODOS`.
    Permissao(String),
    /// O programa em primeiro plano pede outro painel. Carrega só o id do
    /// painel: **o nome do programa não sai desta máquina**. O celular não
    /// precisa dele para trocar de painel, e ele é a lista de programas deste
    /// computador contada de outro jeito.
    Contexto { perfil: String },
}

pub type AvisoDePermissao = tokio::sync::broadcast::Sender<Aviso>;

/// Aviso dirigido a **todos** os aparelhos ligados, e não a um só.
///
/// A permissão de abrir programas é por aparelho, então o aviso comum carrega
/// um identificador e só aquele canal reage. O deck não é: mexer num painel na
/// janela muda o que **todo** aparelho conectado deve estar mostrando, e mandar
/// um aviso por aparelho exigiria a janela saber quem está ligado agora.
///
/// `*` nunca colide com um destino real — eles são UUIDs.
pub const AVISO_TODOS: &str = "*";

pub fn canal_de_avisos() -> AvisoDePermissao {
    tokio::sync::broadcast::channel(16).0
}

#[derive(Clone)]
struct EventosPar {
    saida: mpsc::UnboundedSender<SaidaSinalizacao>,
    destino: String,
    sessao_id: String,
    dispositivo_id: String,
    pares: Arc<ParesConfiaveis>,
    atalhos: Arc<AtalhosPersonalizados>,
    avisos: AvisoDePermissao,
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
        let atalhos = self.atalhos.clone();
        let mut avisos = self.avisos.subscribe();
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
            loop {
                // O canal e os avisos da janela são ouvidos juntos: marcar a
                // permissão precisa alcançar uma sessão que já está aberta, e
                // não só a próxima.
                let evento = tokio::select! {
                    evento = canal.poll() => match evento {
                        Some(evento) => evento,
                        None => break,
                    },
                    aviso = avisos.recv() => {
                        use tokio::sync::broadcast::error::RecvError;
                        match aviso {
                            // Só reanuncia para o aparelho que mudou: os
                            // outros canais recebem o mesmo aviso e ignoram.
                            // `AVISO_TODOS` é a exceção — mudança de painel
                            // vale para todo mundo que está ligado.
                            Ok(Aviso::Permissao(id))
                                if aberto && (id == destino || id == AVISO_TODOS) =>
                            {
                                if !anunciar_sessao(
                                    &canal,
                                    &pares,
                                    &atalhos,
                                    &destino,
                                    &dispositivo_id,
                                    &mut proxima_sequencia_saida,
                                )
                                .await
                                {
                                    break;
                                }
                            }
                            // O painel automático segue a mesma concessão dos
                            // atalhos: para quem não pode abrir programas, os
                            // painéis nem chegaram, e mandar a troca seria
                            // apontar para algo que não existe do outro lado.
                            Ok(Aviso::Contexto { perfil })
                                if aberto
                                    && pares
                                        .buscar(&destino)
                                        .is_some_and(|par| par.tem_escopo("system.process")) =>
                            {
                                if !anunciar_contexto(
                                    &canal,
                                    &perfil,
                                    &mut proxima_sequencia_saida,
                                )
                                .await
                                {
                                    break;
                                }
                            }
                            // Avisos perdidos por lentidão não são perda real:
                            // o que importa é o estado atual, e o próximo
                            // anúncio já o carrega inteiro.
                            Ok(_) | Err(RecvError::Lagged(_)) => {}
                            Err(RecvError::Closed) => break,
                        }
                        continue;
                    }
                };

                match evento {
                    DataChannelEvent::OnOpen if !aberto => {
                        aberto = true;
                        if !anunciar_sessao(
                            &canal,
                            &pares,
                            &atalhos,
                            &destino,
                            &dispositivo_id,
                            &mut proxima_sequencia_saida,
                        )
                        .await
                        {
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
                                // Incrementa mesmo sendo recusa: duas recusas
                                // seguidas com a mesma sequência fariam a
                                // segunda ser descartada como repetida.
                                proxima_sequencia_saida += 1;
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
                                // Perfil de cache, e não detecção: este é o
                                // caminho de **toda** ação executada, inclusive
                                // cada toque no volume. Enumerar adaptadores e
                                // chamar `powercfg` aqui poria latência de volta
                                // no lugar de onde ela custou caro para sair.
                                let perfil = energia::montar_perfil(
                                    &energia::detectar_com_cache(),
                                    false,
                                    None,
                                );
                                let resultado = match acoes::executar(acao, &atalhos, &perfil) {
                                    acoes::Execucao::Concluida(resultado) => resultado,
                                    // Acordar precisa da nuvem para saber o alvo,
                                    // e a ponte ainda não está ligada aqui
                                    // (P3-M5-T7). Recusar dizendo o que é continua
                                    // sendo melhor que responder que deu certo
                                    // sem ter emitido pacote nenhum.
                                    acoes::Execucao::AcordarAlvo(_) => {
                                        Err("acordar outro computador ainda não está disponível")
                                    }
                                };
                                // A chave `error` é omitida quando deu certo, em
                                // vez de ir como `null`: ausente é o que o
                                // schema descreve, e `null` já custou toda
                                // resposta de sucesso ser descartada do outro
                                // lado.
                                let mut conteudo = json!({
                                    "executionId": id,
                                    "ok": resultado.is_ok(),
                                    "durationMs": inicio.elapsed().as_millis() as i64,
                                });
                                if let Err(motivo) = resultado {
                                    conteudo["error"] = json!(motivo);
                                }
                                let conclusao = json!({
                                    "v": VERSAO_PROTOCOLO,
                                    "id": uuid::Uuid::new_v4().to_string(),
                                    "t": "evt",
                                    "k": "action.result",
                                    "ts": agora_ms(),
                                    "seq": proxima_sequencia_saida,
                                    "p": conteudo
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

pub async fn executar(
    api: Arc<ClienteApi>,
    identidade: Identidade,
    pares: Arc<ParesConfiaveis>,
    atalhos: Arc<AtalhosPersonalizados>,
    avisos: AvisoDePermissao,
) {
    let mut espera = Duration::from_secs(1);
    loop {
        if let Err(erro) = executar_sessao(
            api.clone(),
            &identidade,
            pares.clone(),
            atalhos.clone(),
            avisos.clone(),
        )
        .await
        {
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
    atalhos: Arc<AtalhosPersonalizados>,
    avisos: AvisoDePermissao,
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
                                atalhos.clone(),
                                avisos.clone(),
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
    atalhos: Arc<AtalhosPersonalizados>,
    avisos: AvisoDePermissao,
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
            atalhos,
            avisos,
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

    fn atalho_de_teste(id: &str, icone: Option<String>) -> Atalho {
        Atalho {
            id: id.to_string(),
            nome: format!("Jogo {id}"),
            caminho: r"C:\Users\alguem\Games\segredo\jogo.exe".to_string(),
            cor: "violet".to_string(),
            icone,
        }
    }

    fn deck_de_teste() -> ConfiguracaoDeck {
        ConfiguracaoDeck {
            perfil_padrao_id: "p1".to_string(),
            perfis: vec![PerfilDeDeck {
                id: "p1".to_string(),
                nome: "Ao vivo".to_string(),
                cor: "violet".to_string(),
                colunas_retrato: 3,
                colunas_paisagem: 5,
                itens: vec![crate::atalhos::ItemDePerfilDeck {
                    action_id: "midia.reproduzir-pausar".to_string(),
                    pagina: 0,
                    ordem: 0,
                    cor: None,
                    tamanho: None,
                }],
                regras: vec!["obs64.exe".to_string(), "valorant.exe".to_string()],
            }],
        }
    }

    #[test]
    fn o_deck_enviado_nunca_carrega_as_regras_de_contexto() {
        // Irmão de `o_deck_enviado_nunca_carrega_o_caminho_do_executavel`, e
        // pelo mesmo motivo: `regras` é a lista de programas deste computador
        // com outro nome. `PerfilDeDeck` deriva `Serialize` com o campo
        // público, então mandar aquele struct direto contaria a cada aparelho
        // pareado o que está instalado aqui.
        //
        // Zod descarta chave desconhecida do outro lado, então nada quebraria
        // e ninguém perceberia — que é exatamente o que torna este teste
        // necessário em vez de opcional.
        let mensagens = mensagens_do_deck(&[atalho_de_teste("a", None)], &deck_de_teste());
        let bruto = mensagens[0].to_string();
        assert!(!bruto.contains("regras"), "o campo vazou: {bruto}");
        assert!(!bruto.contains("obs64"), "uma regra vazou: {bruto}");
        assert!(!bruto.contains("valorant"), "uma regra vazou: {bruto}");
        // E o resto do painel continua chegando inteiro.
        assert_eq!(mensagens[0]["perfis"][0]["nome"], "Ao vivo");
        assert_eq!(mensagens[0]["perfis"][0]["colunasPaisagem"], json!(5));
    }

    #[test]
    fn os_paineis_viajam_na_primeira_fatia_e_so_nela() {
        // Este teste existe porque o recurso inteiro já estava construído dos
        // dois lados — editor na janela, schema no protocolo, remontagem na
        // PWA — e mesmo assim nenhum painel chegava ao celular: `deck.estado`
        // saía daqui só com `atalhos`. Nada falhava, nada avisava; a grade
        // clássica aparecia como se nenhum painel existisse.
        //
        // A fatia é combinada com `transporte-webrtc.ts`, que zera os perfis
        // ao ver `parte == 1`. Mandar os painéis numa fatia posterior os faria
        // sumir; repetir em todas gastaria banda à toa.
        let icone = format!("data:image/png;base64,{}", "A".repeat(8_000));
        let atalhos: Vec<Atalho> = (0..40)
            .map(|n| atalho_de_teste(&n.to_string(), Some(icone.clone())))
            .collect();
        let mensagens = mensagens_do_deck(&atalhos, &deck_de_teste());
        assert!(mensagens.len() > 1, "o teste precisa de mais de uma fatia");

        assert_eq!(mensagens[0]["perfilPadraoId"], "p1");
        assert_eq!(mensagens[0]["perfis"][0]["nome"], "Ao vivo");
        assert_eq!(mensagens[0]["perfis"][0]["colunasRetrato"], json!(3));
        assert_eq!(
            mensagens[0]["perfis"][0]["itens"][0]["actionId"],
            "midia.reproduzir-pausar"
        );
        for fatia in &mensagens[1..] {
            assert!(fatia.get("perfis").is_none(), "painel repetido na fatia");
        }
    }

    #[test]
    fn o_deck_enviado_nunca_carrega_o_caminho_do_executavel() {
        // O par deste teste do lado da execução é
        // `atalho_de_programa_exige_a_mesma_concessao_e_nunca_carrega_caminho`,
        // que tranca a direção de entrada. Esta é a de saída, e ela não tinha
        // guarda nenhuma: `Atalho` deriva `Serialize` com o campo `caminho`
        // público, então serializar a lista direto entregaria a cada aparelho
        // pareado o mapa do disco deste computador.
        let mensagens = mensagens_do_deck(&[atalho_de_teste("a", None)], &deck_de_teste());
        let bruto = mensagens[0].to_string();
        assert!(!bruto.contains("caminho"), "o campo vazou: {bruto}");
        assert!(!bruto.contains("jogo.exe"), "o caminho vazou: {bruto}");
        assert!(!bruto.to_lowercase().contains("users"), "o caminho vazou: {bruto}");
        assert_eq!(mensagens[0]["atalhos"][0]["id"], "a");
        assert_eq!(mensagens[0]["atalhos"][0]["nome"], "Jogo a");
    }

    #[test]
    fn a_lista_vazia_ainda_vira_uma_mensagem() {
        // Sem ela, remover o último atalho deixaria a grade do celular exibindo
        // um cadastro que já não existe até alguém recarregar.
        let mensagens = mensagens_do_deck(&[], &deck_de_teste());
        assert_eq!(mensagens.len(), 1);
        assert_eq!(mensagens[0]["atalhos"].as_array().unwrap().len(), 0);
        assert!(mensagens[0].get("parte").is_none(), "fatia de uma só é ruído");
    }

    #[test]
    fn uma_lista_grande_e_partida_em_mensagens_que_cabem_no_canal() {
        // O limite do DataChannel não devolve erro: estourar mata o canal. Com
        // cem atalhos e um PNG em cada um, uma mensagem só passa do teto — e o
        // sintoma seria o painel inteiro parar de conectar, não os atalhos
        // faltarem.
        let icone = format!("data:image/png;base64,{}", "A".repeat(8_000));
        let atalhos: Vec<Atalho> = (0..40)
            .map(|n| atalho_de_teste(&n.to_string(), Some(icone.clone())))
            .collect();

        let mensagens = mensagens_do_deck(&atalhos, &deck_de_teste());
        assert!(mensagens.len() > 1, "não fatiou nada");

        let mut vistos = 0;
        for (indice, mensagem) in mensagens.iter().enumerate() {
            assert!(
                mensagem.to_string().len() <= LIMITE_MENSAGEM_DECK + 8_200,
                "fatia acima do teto"
            );
            assert_eq!(mensagem["parte"], json!(indice + 1));
            assert_eq!(mensagem["total"], json!(mensagens.len()));
            vistos += mensagem["atalhos"].as_array().unwrap().len();
        }
        assert_eq!(vistos, 40, "algum atalho se perdeu no fatiamento");
    }

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
