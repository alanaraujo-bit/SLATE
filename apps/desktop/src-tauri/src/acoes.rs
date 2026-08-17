use crate::atalhos::{validar_caminho, AtalhosPersonalizados};
use crate::energia::{AcaoEnergia, PerfilEnergia};
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Acao {
    ReproduzirPausar,
    ProximaFaixa,
    FaixaAnterior,
    Parar,
    AumentarVolume,
    DiminuirVolume,
    Mudo,
    /// Abre um endereço da lista fixa abaixo. Nunca um endereço recebido.
    AbrirAtalho(Atalho),
    /// Abre um programa cadastrado neste computador, identificado por id.
    ///
    /// O id é só uma chave de busca: o caminho vem da lista local, escrita pelo
    /// seletor de arquivo do Windows. Nada do que chega pelo canal vira alvo de
    /// execução — é a mesma promessa dos atalhos fixos, com a lista em disco.
    AbrirPrograma(String),
    /// Mexe no estado de energia **deste** computador (ADR-0006).
    Energia(AcaoEnergia),
    /// Leva este computador ao estado de Pronto para Retorno que o perfil
    /// escolheu. É `Energia` com o alvo decidido na execução, e não no pedido:
    /// qual estado é o certo depende do que a máquina comprovadamente suporta,
    /// e essa decisão não pode vir do celular.
    ProntoParaRetorno,
    /// Pede a **este** Agente que emita o pacote que acorda outra máquina.
    ///
    /// O alvo está desligado, então quem recebe o pedido é sempre uma ponte —
    /// um Agente vivo na mesma rede (ADR-0006 §2). O conteúdo é o identificador
    /// do dispositivo alvo e **nunca** um endereço físico: o endereço vem da
    /// nuvem, autenticado pela identidade da própria ponte e restrito à própria
    /// conta. Se ele viajasse no pedido, qualquer aparelho pareado poderia
    /// mandar um Agente emitir quadros para endereços arbitrários da rede.
    Acordar(String),
}

/// Atalhos de abertura.
///
/// O endereço é constante de compilação e o celular manda só o identificador.
/// Aceitar uma URL pelo canal transformaria o painel num executor remoto de
/// qualquer coisa — `slate://` viraria `file://`, e daí para um caminho local é
/// um passo. Por isso `vars` do envelope **não** é lido neste caminho: acrescentar
/// um atalho é editar esta lista e publicar uma versão, de propósito.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Atalho {
    YouTube,
    Twitch,
    Netflix,
    Spotify,
    Disney,
    Prime,
}

impl Atalho {
    pub fn url(self) -> &'static str {
        match self {
            Atalho::YouTube => "https://www.youtube.com/",
            Atalho::Twitch => "https://www.twitch.tv/",
            Atalho::Netflix => "https://www.netflix.com/",
            Atalho::Spotify => "https://open.spotify.com/",
            Atalho::Disney => "https://www.disneyplus.com/",
            Atalho::Prime => "https://www.primevideo.com/",
        }
    }
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

    // `action.execute` é comum a tudo e é verificado antes de resolver o
    // identificador: sem ele, nem a existência de uma ação precisa ser
    // confirmada a quem perguntou.
    if !par.tem_escopo("action.execute") {
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
        "atalho.youtube" => Acao::AbrirAtalho(Atalho::YouTube),
        "atalho.twitch" => Acao::AbrirAtalho(Atalho::Twitch),
        "atalho.netflix" => Acao::AbrirAtalho(Atalho::Netflix),
        "atalho.spotify" => Acao::AbrirAtalho(Atalho::Spotify),
        "atalho.disney" => Acao::AbrirAtalho(Atalho::Disney),
        "atalho.prime" => Acao::AbrirAtalho(Atalho::Prime),
        // Energia (ADR-0006). Entram no mesmo registro fechado, e não por uma
        // porta própria: é o que faz cada uma herdar a janela de timestamp, a
        // sequência, os ids já vistos e a verificação de escopo sem código novo.
        "sistema.bloquear" => Acao::Energia(AcaoEnergia::Bloquear),
        "sistema.suspender" => Acao::Energia(AcaoEnergia::Suspender),
        "sistema.hibernar" => Acao::Energia(AcaoEnergia::Hibernar),
        "sistema.reiniciar" => Acao::Energia(AcaoEnergia::Reiniciar),
        "sistema.desligar" => Acao::Energia(AcaoEnergia::Desligar),
        "sistema.cancelar-desligamento" => Acao::Energia(AcaoEnergia::CancelarDesligamento),
        "sistema.pronto-para-retorno" => Acao::ProntoParaRetorno,
        // `programa.<id>` é atalho cadastrado neste computador. O id só é
        // aceito como chave de busca — quem existe de fato é decidido em
        // `executar`, contra a lista em disco.
        outro => {
            // `sistema.acordar.<id>` segue a mesma forma, e pelo mesmo motivo:
            // o identificador é chave de busca na nuvem, nunca um alvo. Um
            // endereço físico disfarçado de identificador continua sendo
            // identificador — ele não é usado para montar pacote nenhum.
            if let Some(id) = outro.strip_prefix("sistema.acordar.") {
                if !id.is_empty() && id.len() <= 128 {
                    Acao::Acordar(id.to_string())
                } else {
                    return RecepcaoAcao::Recusada {
                        id: envelope.id,
                        motivo: "nao_encontrada",
                    };
                }
            } else {
                match outro.strip_prefix("programa.") {
                    Some(id) if !id.is_empty() && id.len() <= 64 => {
                        Acao::AbrirPrograma(id.to_string())
                    }
                    _ => {
                        return RecepcaoAcao::Recusada {
                            id: envelope.id,
                            motivo: "nao_encontrada",
                        }
                    }
                }
            }
        }
    };

    if !par.tem_escopo(escopo_exigido(&acao)) {
        return RecepcaoAcao::Recusada {
            id: envelope.id,
            motivo: "escopo_negado",
        };
    }

    RecepcaoAcao::Aceita {
        id: envelope.id,
        acao,
    }
}

/// O escopo que cada ação exige, além de `action.execute`.
///
/// Abrir um programa é uma autoridade diferente de mexer no que já está
/// tocando, e por isso mora num escopo que o pareamento **não** concede: ele só
/// existe se alguém marcou na interface do Agente, no próprio computador.
pub fn escopo_exigido(acao: &Acao) -> &'static str {
    match acao {
        Acao::ReproduzirPausar
        | Acao::ProximaFaixa
        | Acao::FaixaAnterior
        | Acao::Parar
        | Acao::AumentarVolume
        | Acao::DiminuirVolume
        | Acao::Mudo => "system.media",
        // Abrir site e abrir programa são a mesma autoridade: os dois criam
        // processo. Separar em dois escopos daria duas caixas para marcar sem
        // nenhum ganho de segurança.
        Acao::AbrirAtalho(_) | Acao::AbrirPrograma(_) => "system.process",
        // Energia é autoridade própria, e nenhuma delas vem no pareamento
        // (ADR-0006 §6).
        Acao::Energia(_) | Acao::ProntoParaRetorno => "system.power",
        // Acordar é separado de desligar de propósito: não é o mesmo risco.
        // Acordar, no pior caso, liga uma máquina à toa; desligar pode custar
        // trabalho não salvo. Um escopo só obrigaria quem quer o botão de ligar
        // a conceder também o de desligar.
        Acao::Acordar(_) => "system.wake",
    }
}

/// O que sair de `executar`.
///
/// Existe porque acordar não cabe no mesmo formato das outras: todas as demais
/// ações terminam neste processo, em microssegundos, e acordar precisa
/// perguntar à nuvem qual o alvo antes de emitir qualquer coisa — o que é
/// assíncrono e pode falhar por rede.
///
/// Devolver um pedido em vez de um resultado obriga o chamador, pelo
/// compilador, a tratar esse caminho. A alternativa — um braço que devolve erro
/// e alguém lembrar de interceptar antes — é exatamente a classe de defeito que
/// este projeto já pagou caro: recurso pronto dos dois lados e nenhum comando
/// registrado no meio, sem erro em lugar nenhum.
#[derive(Debug, PartialEq, Eq)]
pub enum Execucao {
    Concluida(Result<(), &'static str>),
    /// Emitir o pacote que acorda o dispositivo de id informado. Quem resolve o
    /// endereço é a nuvem, nunca o pedido que chegou pelo canal.
    AcordarAlvo(String),
}

pub fn executar(
    acao: Acao,
    cadastrados: &AtalhosPersonalizados,
    perfil: &PerfilEnergia,
) -> Execucao {
    if let Acao::Acordar(alvo) = acao {
        return Execucao::AcordarAlvo(alvo);
    }
    Execucao::Concluida(executar_local(acao, cadastrados, perfil))
}

fn executar_local(
    acao: Acao,
    cadastrados: &AtalhosPersonalizados,
    perfil: &PerfilEnergia,
) -> Result<(), &'static str> {
    // Três famílias com mecanismos diferentes: tecla de mídia é sinal ao
    // aplicativo em foco, atalho de site abre o navegador, atalho cadastrado
    // executa um programa. Separar aqui, e não dentro de um `match` só, é o que
    // faz o compilador cobrar um mecanismo explícito de quem acrescentar uma
    // ação — em vez de deixá-la cair num braço genérico.
    match acao {
        Acao::AbrirPrograma(id) => {
            let atalho = cadastrados.buscar(&id).ok_or("esse atalho não existe mais")?;
            // Confere de novo na hora de executar. O programa pode ter sido
            // desinstalado ou movido desde o cadastro, e tentar abrir um
            // caminho que sumiu daria um erro do Windows sem explicação.
            validar_caminho(&atalho.caminho).map_err(|_| "o programa deste atalho não está mais no lugar")?;
            abrir_programa(&atalho.caminho)
        }
        Acao::AbrirAtalho(atalho) => abrir_endereco(atalho.url()),
        Acao::Energia(acao_energia) => crate::energia::executar(acao_energia, perfil),
        // Qual estado é o certo depende do que esta máquina comprovadamente
        // suporta, e essa decisão não vem do celular: ela sai do perfil, aqui.
        Acao::ProntoParaRetorno => match perfil.pronto_para_retorno {
            crate::energia::EstadoProntoParaRetorno::Desligado => {
                crate::energia::executar(AcaoEnergia::Desligar, perfil)
            }
            crate::energia::EstadoProntoParaRetorno::Hibernado => {
                crate::energia::executar(AcaoEnergia::Hibernar, perfil)
            }
            // Sem retorno confiável não existe Pronto para Retorno, e desligar
            // assim mesmo deixaria a máquina inalcançável. Recusar é o certo.
            crate::energia::EstadoProntoParaRetorno::Nenhum => {
                Err("este computador não consegue voltar sozinho depois de desligar")
            }
        },
        // Tratado em `executar`, antes de chegar aqui: acordar precisa da
        // nuvem. O braço existe para o compilador cobrar quem acrescentar uma
        // ação, e nunca é alcançado.
        Acao::Acordar(_) => Err("acordar é resolvido pela ponte"),
        Acao::ReproduzirPausar
        | Acao::ProximaFaixa
        | Acao::FaixaAnterior
        | Acao::Parar
        | Acao::AumentarVolume
        | Acao::DiminuirVolume
        | Acao::Mudo => apertar_tecla_de_midia(acao),
    }
}

fn apertar_tecla_de_midia(acao: Acao) -> Result<(), &'static str> {
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
            Acao::AbrirAtalho(_)
            | Acao::AbrirPrograma(_)
            | Acao::Energia(_)
            | Acao::ProntoParaRetorno
            | Acao::Acordar(_) => return Err("essa ação não é tecla de mídia"),
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

/// Executa um programa cadastrado.
///
/// O caminho vem sempre da lista em disco, escrita pelo seletor de arquivo do
/// Windows — nunca de uma mensagem. `Command::new` recebe o executável como
/// argumento próprio, e não uma linha de comando montada por concatenação: sem
/// isso, um nome de arquivo com aspas ou `&` viraria injeção de comando.
///
/// A pasta do próprio programa vira diretório de trabalho porque muitos jogos e
/// aplicativos procuram os arquivos deles em caminho relativo e falham ao abrir
/// de outro lugar.
fn abrir_programa(caminho: &str) -> Result<(), &'static str> {
    let mut comando = std::process::Command::new(caminho);
    if let Some(pasta) = std::path::Path::new(caminho).parent() {
        comando.current_dir(pasta);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        comando.creation_flags(CREATE_NO_WINDOW);
    }

    comando
        .spawn()
        .map(|_| ())
        .map_err(|_| "não foi possível abrir esse programa")
}

/// Abre um endereço no navegador padrão do Windows.
///
/// Usa `cmd /c start` com o título vazio antes da URL. O argumento vazio existe
/// porque `start` trata o primeiro argumento entre aspas como título da janela:
/// sem ele, um endereço entre aspas seria engolido como título e nada abriria.
///
/// O endereço vem de `Atalho::url`, que é constante de compilação — nada que
/// tenha chegado pelo canal passa por aqui. A verificação abaixo é redundante
/// hoje e existe para o dia em que alguém acrescentar um atalho: uma constante
/// errada falha aqui em vez de virar um `file://` aberto por comando remoto.
fn abrir_endereco(url: &str) -> Result<(), &'static str> {
    if !url.starts_with("https://") {
        return Err("endereço de atalho inválido");
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: sem isto, uma janela preta de console pisca na tela
        // a cada atalho, num programa que se propõe a ficar fora do caminho.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/c", "start", "", url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|_| "não foi possível abrir o endereço")
    }

    #[cfg(not(windows))]
    {
        Err("ação disponível apenas no Windows")
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn par(escopos: &[&str]) -> ParConfiavel {
        par_com_local(escopos, &[])
    }

    fn atalhos_vazios() -> AtalhosPersonalizados {
        let pasta = std::env::temp_dir().join(format!(
            "slate-acoes-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        AtalhosPersonalizados::carregar(&pasta).unwrap()
    }

    fn perfil_de_teste() -> PerfilEnergia {
        use crate::energia::{EstadoProntoParaRetorno, NivelEnergia, Suporte};
        PerfilEnergia {
            bloquear: Suporte::Sim,
            suspender: Suporte::Sim,
            hibernar: Suporte::Sim,
            reiniciar: Suporte::Sim,
            desligar: Suporte::Sim,
            cancelar_desligamento: Suporte::Sim,
            acordar_pela_rede: Suporte::Sim,
            acordar_de_suspenso: Suporte::Sim,
            acordar_de_hibernado: Suporte::Sim,
            acordar_de_desligado: Suporte::Desconhecido,
            pronto_para_retorno: EstadoProntoParaRetorno::Hibernado,
            nivel: NivelEnergia::Padrao,
            adaptador: None,
            tipo_de_adaptador: None,
            impedimentos: Vec::new(),
            testado_em: None,
        }
    }

    fn par_com_local(escopos: &[&str], locais: &[&str]) -> ParConfiavel {
        ParConfiavel {
            id: "superficie-1".into(),
            nome: "Celular".into(),
            papel: "surface".into(),
            chave_publica: "chave-publica-com-tamanho-suficiente".into(),
            algoritmo: "Ed25519".into(),
            escopos: escopos.iter().map(|e| (*e).into()).collect(),
            escopos_locais: locais.iter().map(|e| (*e).into()).collect(),
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
                    acao: esperada.clone(),
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
    fn atalho_nao_passa_com_os_escopos_do_pareamento() {
        // O ponto inteiro do desenho: `ESCOPOS_PADRAO` não traz
        // `system.process`, então um celular recém-pareado — que já controla
        // mídia — não abre programa nenhum enquanto ninguém autorizar no PC.
        let mut estado = EstadoComandos::depois_do_hello();
        assert_eq!(
            receber(
                &pedido("um", 1, 10_000, "atalho.youtube"),
                &par(&["action.execute", "system.media", "state.read", "deck.read"]),
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
    fn atalho_passa_com_a_concessao_feita_no_computador() {
        // E o contrapeso: concedido na interface do Agente, o mesmo pedido
        // passa. Sem este teste, o de cima poderia estar recusando por engano.
        let mut estado = EstadoComandos::depois_do_hello();
        assert_eq!(
            receber(
                &pedido("um", 1, 10_000, "atalho.youtube"),
                &par_com_local(&["action.execute", "system.media"], &["system.process"]),
                &mut estado,
                10_000,
            ),
            RecepcaoAcao::Aceita {
                id: "um".into(),
                acao: Acao::AbrirAtalho(Atalho::YouTube),
            }
        );
    }

    #[test]
    fn toda_a_grade_de_atalhos_e_reconhecida() {
        let esperados = [
            ("atalho.youtube", Atalho::YouTube),
            ("atalho.twitch", Atalho::Twitch),
            ("atalho.netflix", Atalho::Netflix),
            ("atalho.spotify", Atalho::Spotify),
            ("atalho.disney", Atalho::Disney),
            ("atalho.prime", Atalho::Prime),
        ];

        let par = par_com_local(&["action.execute"], &["system.process"]);
        let mut estado = EstadoComandos::depois_do_hello();

        for (indice, (identificador, esperado)) in esperados.iter().enumerate() {
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
                    acao: Acao::AbrirAtalho(*esperado),
                },
                "identificador não reconhecido: {identificador}"
            );
        }
    }

    #[test]
    fn atalho_de_programa_exige_a_mesma_concessao_e_nunca_carrega_caminho() {
        // O identificador é chave de busca, e só. Se algum dia alguém trocar
        // isto por "o celular manda o caminho", este teste cai — e é para cair.
        let mut estado = EstadoComandos::depois_do_hello();
        assert_eq!(
            receber(
                &pedido("um", 1, 10_000, "programa.abc-123"),
                &par_com_local(&["action.execute"], &["system.process"]),
                &mut estado,
                10_000,
            ),
            RecepcaoAcao::Aceita {
                id: "um".into(),
                acao: Acao::AbrirPrograma("abc-123".into()),
            }
        );

        // Sem a concessão feita no computador, não passa.
        let mut estado = EstadoComandos::depois_do_hello();
        assert_eq!(
            receber(
                &pedido("um", 1, 10_000, "programa.abc-123"),
                &par(&["action.execute", "system.media"]),
                &mut estado,
                10_000,
            ),
            RecepcaoAcao::Recusada {
                id: "um".into(),
                motivo: "escopo_negado",
            }
        );

        // Um caminho disfarçado de identificador continua sendo identificador:
        // ele nunca vira alvo, porque o alvo sai da lista em disco.
        let mut estado = EstadoComandos::depois_do_hello();
        assert!(matches!(
            receber(
                &pedido("dois", 1, 10_000, "programa."),
                &par_com_local(&["action.execute"], &["system.process"]),
                &mut estado,
                10_000,
            ),
            RecepcaoAcao::Recusada { motivo: "nao_encontrada", .. }
        ));
    }

    #[test]
    fn todo_atalho_aponta_para_https() {
        // A promessa do ADR-0004 depende de a lista ser confiável. Uma
        // constante trocada por `file://` num descuido viraria leitura de disco
        // acionada pelo celular.
        for atalho in [
            Atalho::YouTube,
            Atalho::Twitch,
            Atalho::Netflix,
            Atalho::Spotify,
            Atalho::Disney,
            Atalho::Prime,
        ] {
            assert!(
                atalho.url().starts_with("https://"),
                "atalho fora de https: {}",
                atalho.url()
            );
        }
    }

    #[test]
    fn abrir_endereco_recusa_o_que_nao_for_https() {
        // A rede de segurança de `abrir_endereco`, exercitada sem abrir nada:
        // chamar com uma URL válida abriria seis abas a cada `cargo test`.
        for endereco in [
            "file:///C:/Windows/System32",
            "http://exemplo.com/",
            "cmd.exe",
            "",
        ] {
            assert!(
                abrir_endereco(endereco).is_err(),
                "deixou passar: {endereco}"
            );
        }
    }

    #[test]
    fn nenhuma_acao_de_energia_passa_com_os_escopos_do_pareamento() {
        // O ponto do ADR-0006 §6: um celular recém-pareado controla mídia e não
        // desliga nem acorda computador nenhum. Se alguém acrescentar
        // `system.power` a `ESCOPOS_PADRAO`, este teste cai — e é para cair.
        let pareado = par(&["action.execute", "system.media", "state.read", "deck.read"]);
        for identificador in [
            "sistema.bloquear",
            "sistema.suspender",
            "sistema.hibernar",
            "sistema.reiniciar",
            "sistema.desligar",
            "sistema.cancelar-desligamento",
            "sistema.pronto-para-retorno",
            "sistema.acordar.abc-123",
        ] {
            let mut estado = EstadoComandos::depois_do_hello();
            assert_eq!(
                receber(&pedido("um", 1, 10_000, identificador), &pareado, &mut estado, 10_000),
                RecepcaoAcao::Recusada {
                    id: "um".into(),
                    motivo: "escopo_negado",
                },
                "escapou da verificação de escopo: {identificador}"
            );
        }
    }

    #[test]
    fn toda_a_grade_de_energia_e_reconhecida() {
        // A grade da PWA e a lista daqui precisam falar dos mesmos
        // identificadores. Um botão que existe na tela e não existe aqui
        // responde "ação não encontrada", que é pior do que não existir.
        let esperadas = [
            ("sistema.bloquear", Acao::Energia(AcaoEnergia::Bloquear)),
            ("sistema.suspender", Acao::Energia(AcaoEnergia::Suspender)),
            ("sistema.hibernar", Acao::Energia(AcaoEnergia::Hibernar)),
            ("sistema.reiniciar", Acao::Energia(AcaoEnergia::Reiniciar)),
            ("sistema.desligar", Acao::Energia(AcaoEnergia::Desligar)),
            (
                "sistema.cancelar-desligamento",
                Acao::Energia(AcaoEnergia::CancelarDesligamento),
            ),
            ("sistema.pronto-para-retorno", Acao::ProntoParaRetorno),
        ];

        let autorizado = par_com_local(&["action.execute"], &["system.power"]);
        let mut estado = EstadoComandos::depois_do_hello();

        for (indice, (identificador, esperada)) in esperadas.iter().enumerate() {
            let seq = indice as i64 + 1;
            assert_eq!(
                receber(
                    &pedido(&format!("id-{seq}"), seq, 10_000, identificador),
                    &autorizado,
                    &mut estado,
                    10_000,
                ),
                RecepcaoAcao::Aceita {
                    id: format!("id-{seq}"),
                    acao: esperada.clone(),
                },
                "identificador não reconhecido: {identificador}"
            );
        }
    }

    #[test]
    fn acordar_e_desligar_sao_autorizacoes_separadas() {
        // Quem quer só o botão de ligar não é obrigado a conceder o de
        // desligar. Se alguém fundir os dois escopos, este teste cai.
        let so_acordar = par_com_local(&["action.execute"], &["system.wake"]);
        let mut estado = EstadoComandos::depois_do_hello();
        assert_eq!(
            receber(
                &pedido("um", 1, 10_000, "sistema.acordar.alvo-1"),
                &so_acordar,
                &mut estado,
                10_000,
            ),
            RecepcaoAcao::Aceita {
                id: "um".into(),
                acao: Acao::Acordar("alvo-1".into()),
            }
        );

        // E o mesmo aparelho não desliga nada.
        let mut estado = EstadoComandos::depois_do_hello();
        assert_eq!(
            receber(
                &pedido("dois", 1, 10_000, "sistema.desligar"),
                &so_acordar,
                &mut estado,
                10_000,
            ),
            RecepcaoAcao::Recusada {
                id: "dois".into(),
                motivo: "escopo_negado",
            }
        );

        // E a recíproca: quem pode desligar não acorda os outros por tabela.
        let so_desligar = par_com_local(&["action.execute"], &["system.power"]);
        let mut estado = EstadoComandos::depois_do_hello();
        assert_eq!(
            receber(
                &pedido("tres", 1, 10_000, "sistema.acordar.alvo-1"),
                &so_desligar,
                &mut estado,
                10_000,
            ),
            RecepcaoAcao::Recusada {
                id: "tres".into(),
                motivo: "escopo_negado",
            }
        );
    }

    #[test]
    fn acordar_nunca_carrega_endereco_fisico() {
        // Mesma promessa de `atalho_de_programa_exige_a_mesma_concessao_e_nunca_carrega_caminho`,
        // e pelo mesmo motivo: o identificador é chave de busca na nuvem. Se
        // algum dia alguém trocar isto por "o celular manda o endereço", este
        // teste cai. Um endereço disfarçado de identificador continua sendo
        // identificador — ele não vira alvo de pacote nenhum, porque quem
        // resolve o alvo é a nuvem contra a própria conta.
        let autorizado = par_com_local(&["action.execute"], &["system.wake"]);

        let mut estado = EstadoComandos::depois_do_hello();
        assert_eq!(
            receber(
                &pedido("um", 1, 10_000, "sistema.acordar.AA:BB:CC:DD:EE:FF"),
                &autorizado,
                &mut estado,
                10_000,
            ),
            RecepcaoAcao::Aceita {
                id: "um".into(),
                // Continua sendo um id opaco. Não há caminho daqui até um
                // pacote sem a nuvem confirmar que este id é da conta.
                acao: Acao::Acordar("AA:BB:CC:DD:EE:FF".into()),
            }
        );

        // Sem identificador não há ação.
        let mut estado = EstadoComandos::depois_do_hello();
        assert!(matches!(
            receber(
                &pedido("dois", 1, 10_000, "sistema.acordar."),
                &autorizado,
                &mut estado,
                10_000,
            ),
            RecepcaoAcao::Recusada { motivo: "nao_encontrada", .. }
        ));
    }

    #[test]
    fn acordar_sai_de_executar_como_pedido_e_nao_como_resultado() {
        // O compilador cobra o tratamento do caminho assíncrono. Se alguém
        // colapsar isto num `Result`, acordar vira uma ação que "deu certo"
        // sem nunca ter emitido pacote nenhum.
        let atalhos = atalhos_vazios();
        let perfil = perfil_de_teste();
        assert_eq!(
            executar(Acao::Acordar("alvo-1".into()), &atalhos, &perfil),
            Execucao::AcordarAlvo("alvo-1".into())
        );
    }

    #[test]
    fn pronto_para_retorno_recusa_quando_nao_ha_volta() {
        // Desligar uma máquina que não sabe voltar a deixaria inalcançável — o
        // pior resultado possível desta funcionalidade.
        let atalhos = atalhos_vazios();
        let mut perfil = perfil_de_teste();
        perfil.pronto_para_retorno = crate::energia::EstadoProntoParaRetorno::Nenhum;
        assert_eq!(
            executar(Acao::ProntoParaRetorno, &atalhos, &perfil),
            Execucao::Concluida(Err(
                "este computador não consegue voltar sozinho depois de desligar"
            ))
        );
    }

    #[test]
    fn midia_e_atalho_exigem_escopos_diferentes() {
        assert_eq!(escopo_exigido(&Acao::ReproduzirPausar), "system.media");
        assert_eq!(
            escopo_exigido(&Acao::AbrirAtalho(Atalho::YouTube)),
            "system.process"
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
