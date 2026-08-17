mod acoes;
mod atalhos;
mod energia;
mod foco;
mod icone;
mod api;
mod identidade;
mod pares;
mod transporte;

use api::{ClienteApi, ConvitePareamentoQr, Dispositivo, SituacaoConviteQr, Usuario};
use identidade::{mensagem_confirmacao_pareamento, mensagem_criacao_convite_qr, Identidade};
use atalhos::{Atalho, AtalhosPersonalizados, PerfilDeDeck};
use pares::ParesConfiaveis;
use serde::Serialize;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

/// Estado do Agente.
///
/// A identidade e o cliente HTTP vivem aqui, no processo, e não na interface.
/// A janela é só apresentação: ela não tem acesso à chave privada nem ao cookie
/// de sessão, então uma falha no conteúdo exibido não expõe nenhum dos dois.
struct Estado {
    identidade: Identidade,
    api: Arc<ClienteApi>,
    nome_computador: String,
    /// Guarda o último erro de inicialização para a interface poder explicá-lo.
    falha_inicial: Mutex<Option<String>>,
    pares: Arc<ParesConfiaveis>,
    /// Atalhos de programa cadastrados neste computador.
    atalhos: Arc<AtalhosPersonalizados>,
    /// Avisa as sessões abertas que a permissão de um aparelho mudou.
    ///
    /// Sem ele, marcar a caixa só valia na conexão seguinte — as capacidades
    /// são anunciadas no hello, e o hello já tinha ido embora. Quem marcava
    /// via a tela do celular não mudar e concluía, com razão, que não tinha
    /// funcionado.
    avisos_de_permissao: transporte::AvisoDePermissao,
    /// Mantém a tarefa residente viva durante todo o processo. Sair da conta
    /// não revoga este computador; a identidade do dispositivo continua sendo
    /// suficiente para ele voltar à sinalização após reiniciar o Windows.
    _transporte: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

#[derive(Serialize)]
struct Situacao {
    conectado: bool,
    usuario: Option<Usuario>,
    #[serde(rename = "nomeComputador")]
    nome_computador: String,
    #[serde(rename = "chavePublica")]
    chave_publica: String,
    dispositivos: Vec<Dispositivo>,
    /// IDs dos aparelhos autorizados a abrir programas neste computador.
    ///
    /// Vem da raiz de confiança local, e não da conta: é a única fonte, porque
    /// é aqui que a permissão é concedida e é aqui que ela é verificada.
    #[serde(rename = "atalhosPermitidos")]
    atalhos_permitidos: Vec<String>,
}

#[tauri::command]
async fn situacao(estado: tauri::State<'_, Estado>) -> Result<Situacao, String> {
    let usuario = estado.api.sessao_atual().await.ok();

    let dispositivos = if usuario.is_some() {
        estado.api.dispositivos().await.unwrap_or_default()
    } else {
        Vec::new()
    };

    Ok(Situacao {
        conectado: usuario.is_some(),
        usuario,
        nome_computador: estado.nome_computador.clone(),
        chave_publica: estado.identidade.chave_publica(),
        dispositivos,
        atalhos_permitidos: estado
            .pares
            .listar()
            .into_iter()
            .filter(|par| par.tem_escopo("system.process"))
            .map(|par| par.id)
            .collect(),
    })
}

/// Autoriza — ou desautoriza — um aparelho a abrir programas neste computador.
///
/// Não existe rota equivalente na API, e isso é a decisão, não uma lacuna. O
/// ADR-0004 diz que um dispositivo jamais amplia os próprios poderes: quem
/// concede está fisicamente na frente deste computador. A conta pode revogar um
/// aparelho; conceder poder novo, nunca.
///
/// O efeito é imediato: `action.atalhos` é anunciada por par no handshake, então
/// o painel do celular ganha ou perde os atalhos na reconexão seguinte.
#[tauri::command]
async fn definir_atalhos_permitidos(
    estado: tauri::State<'_, Estado>,
    id: String,
    permitido: bool,
) -> Result<(), String> {
    estado
        .pares
        .definir_escopo_local(&id, "system.process", permitido)
        .map_err(|e| e.to_string())?;

    // Reanuncia para o aparelho que mudou, se ele estiver conectado agora. Um
    // erro aqui significa apenas que ninguém está ouvindo — nenhuma sessão
    // aberta —, e a permissão já está gravada de qualquer forma.
    let _ = estado
        .avisos_de_permissao
        .send(transporte::Aviso::Permissao(id));
    Ok(())
}

#[tauri::command]
async fn entrar(
    estado: tauri::State<'_, Estado>,
    email: String,
    senha: String,
) -> Result<Usuario, String> {
    let usuario = estado
        .api
        .entrar(&email, &senha)
        .await
        .map_err(|e| e.to_string())?;

    // Registra este computador logo após entrar. Falhar aqui não desfaz a
    // entrada: a sessão é válida, e o registro pode ser tentado de novo.
    estado
        .api
        .registrar_agente(
            &estado.identidade.chave_publica(),
            estado.identidade.algoritmo(),
            &estado.nome_computador,
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(usuario)
}

#[tauri::command]
async fn sair(estado: tauri::State<'_, Estado>) -> Result<(), String> {
    estado.api.sair().await.map_err(|e| e.to_string())
}

/// Confirma o pareamento de um celular ou tablet.
///
/// Este é o passo que só pode acontecer aqui: digitar o código neste
/// computador é o que prova posse da máquina (ADR-0004 §2). Sem ele, uma senha
/// vazada bastaria para alguém controlar o PC de outra pessoa.
#[tauri::command]
async fn confirmar_pareamento(
    estado: tauri::State<'_, Estado>,
    codigo: String,
) -> Result<Dispositivo, String> {
    let codigo = codigo.trim();
    let chave_publica = estado.identidade.chave_publica();
    let prova = mensagem_confirmacao_pareamento(codigo, &chave_publica);
    let dispositivo = estado
        .api
        .confirmar_pareamento_com_prova(
            codigo,
            &chave_publica,
            &estado.identidade.assinar(prova.as_bytes()),
        )
        .await
        .map_err(|e| e.to_string())?;

    // A resposta desta cerimônia física é a única fonte que pode criar uma
    // entrada na raiz de confiança local. Listas posteriores da nuvem servem
    // apenas para remover revogados, nunca para substituir esta chave.
    estado
        .pares
        .guardar_confirmado(&dispositivo)
        .map_err(|e| e.to_string())?;
    Ok(dispositivo)
}

#[tauri::command]
async fn criar_convite_qr(estado: tauri::State<'_, Estado>) -> Result<ConvitePareamentoQr, String> {
    let nonce = uuid::Uuid::new_v4().to_string();
    let chave_publica = estado.identidade.chave_publica();
    let prova = mensagem_criacao_convite_qr(&nonce, &chave_publica);
    estado
        .api
        .criar_convite_qr(
            &nonce,
            &chave_publica,
            &estado.identidade.assinar(prova.as_bytes()),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn consultar_convite_qr(
    estado: tauri::State<'_, Estado>,
    convite_id: String,
) -> Result<SituacaoConviteQr, String> {
    let resultado = estado
        .api
        .consultar_convite_qr(&convite_id)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(dispositivo) = &resultado.dispositivo {
        estado
            .pares
            .guardar_confirmado(dispositivo)
            .map_err(|e| e.to_string())?;
    }
    Ok(resultado)
}

/// Remove um aparelho pareado.
///
/// A ordem importa: primeiro a nuvem, depois a raiz de confiança local. Se o
/// servidor recusar, o par continua confiável aqui — o contrário deixaria o
/// Agente recusando um aparelho que a conta ainda considera autorizado.
#[tauri::command]
async fn remover_dispositivo(estado: tauri::State<'_, Estado>, id: String) -> Result<(), String> {
    estado
        .api
        .remover_dispositivo(&id)
        .await
        .map_err(|e| e.to_string())?;
    estado
        .pares
        .remover_revogados(&[id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Atalhos de programa
// ---------------------------------------------------------------------------
//
// Todos estes comandos existem só aqui, na janela do Agente. Não há equivalente
// no canal com o celular, e a ausência é a decisão: `action.define` está em
// `ESCOPOS_SOMENTE_NO_PC` desde o ADR-0004. Escolher qual executável um atalho
// abre é ato de quem está na frente da máquina; o celular só manda o
// identificador do que já foi cadastrado.

/// Abre o seletor de arquivo do Windows e devolve o caminho escolhido.
///
/// O caminho nasce aqui, do diálogo nativo — nunca de texto digitado e nunca de
/// mensagem recebida. É essa origem que sustenta a promessa de que nada
/// arbitrário vira alvo de execução.
#[tauri::command]
async fn escolher_programa(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (envio, recebimento) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Escolha o programa ou jogo")
        .add_filter("Programas", &["exe", "lnk", "bat", "cmd", "url"])
        .pick_file(move |escolhido| {
            let _ = envio.send(escolhido);
        });

    let escolhido = recebimento.await.map_err(|_| "seleção cancelada".to_string())?;
    Ok(escolhido
        .and_then(|caminho| caminho.into_path().ok())
        .map(|caminho| caminho.to_string_lossy().to_string()))
}

#[tauri::command]
async fn listar_atalhos(estado: tauri::State<'_, Estado>) -> Result<Vec<Atalho>, String> {
    Ok(estado.atalhos.listar())
}

#[tauri::command]
async fn criar_atalho(
    estado: tauri::State<'_, Estado>,
    caminho: String,
    nome: String,
    cor: String,
) -> Result<Atalho, String> {
    estado
        .atalhos
        .criar(&caminho, &nome, &cor)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn remover_atalho(estado: tauri::State<'_, Estado>, id: String) -> Result<(), String> {
    estado.atalhos.remover(&id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn renomear_atalho(
    estado: tauri::State<'_, Estado>,
    id: String,
    nome: String,
    cor: String,
) -> Result<(), String> {
    estado
        .atalhos
        .renomear(&id, &nome, &cor)
        .map_err(|e| e.to_string())
}

/// Reenvia o deck para todo aparelho ligado agora.
///
/// Chamada depois de cada mudança de painel. Sem isto, mexer no editor só
/// valeria na conexão seguinte — a pessoa arrasta uma tecla na janela, olha
/// para o celular e não vê nada mudar. Um erro aqui significa apenas que
/// ninguém está ouvindo; a mudança já está gravada em disco.
async fn reanunciar_deck(estado: &tauri::State<'_, Estado>) {
    let _ = estado
        .avisos_de_permissao
        .send(transporte::Aviso::Permissao(
            transporte::AVISO_TODOS.to_string(),
        ));
}

/// A configuração do deck como a **janela** a recebe.
///
/// Struct separada de `ConfiguracaoDeck` porque esta carrega `Atalho` inteiro,
/// e `Atalho` tem `caminho`. Aqui isso é correto e necessário — a janela roda
/// neste computador e o editor precisa listar os programas cadastrados. O que
/// não pode acontecer é esta struct encontrar o caminho do canal: o celular
/// recebe `AtalhoNoCanal`, em `transporte.rs`, que não tem o campo (ADR-0004).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfiguracaoDeckNaJanela {
    atalhos: Vec<Atalho>,
    perfis: Vec<PerfilDeDeck>,
    perfil_padrao_id: String,
}

#[tauri::command]
async fn listar_configuracao_deck(
    estado: tauri::State<'_, Estado>,
) -> Result<ConfiguracaoDeckNaJanela, String> {
    let configuracao = estado.atalhos.configuracao();
    Ok(ConfiguracaoDeckNaJanela {
        atalhos: estado.atalhos.listar(),
        perfis: configuracao.perfis,
        perfil_padrao_id: configuracao.perfil_padrao_id,
    })
}

#[tauri::command]
async fn criar_perfil(
    estado: tauri::State<'_, Estado>,
    nome: String,
    cor: Option<String>,
) -> Result<PerfilDeDeck, String> {
    // A cor é opcional porque criar um painel não deve exigir uma escolha
    // estética antes de existir qualquer conteúdo. A janela escolhe depois.
    let perfil = estado
        .atalhos
        .criar_perfil(&nome, cor.as_deref().unwrap_or("blue"))
        .map_err(|e| e.to_string())?;
    reanunciar_deck(&estado).await;
    Ok(perfil)
}

#[tauri::command]
async fn duplicar_perfil(
    estado: tauri::State<'_, Estado>,
    id: String,
) -> Result<PerfilDeDeck, String> {
    let perfil = estado.atalhos.duplicar_perfil(&id).map_err(|e| e.to_string())?;
    reanunciar_deck(&estado).await;
    Ok(perfil)
}

#[tauri::command]
async fn salvar_perfil(
    estado: tauri::State<'_, Estado>,
    perfil: PerfilDeDeck,
) -> Result<PerfilDeDeck, String> {
    let salvo = estado
        .atalhos
        .salvar_perfil(perfil)
        .map_err(|e| e.to_string())?;
    reanunciar_deck(&estado).await;
    Ok(salvo)
}

#[tauri::command]
async fn remover_perfil(estado: tauri::State<'_, Estado>, id: String) -> Result<(), String> {
    estado.atalhos.remover_perfil(&id).map_err(|e| e.to_string())?;
    reanunciar_deck(&estado).await;
    Ok(())
}

#[tauri::command]
async fn definir_perfil_padrao(estado: tauri::State<'_, Estado>, id: String) -> Result<(), String> {
    estado
        .atalhos
        .definir_perfil_padrao(&id)
        .map_err(|e| e.to_string())?;
    reanunciar_deck(&estado).await;
    Ok(())
}

#[tauri::command]
async fn falha_inicial(estado: tauri::State<'_, Estado>) -> Result<Option<String>, String> {
    Ok(estado.falha_inicial.lock().await.clone())
}

fn nome_do_computador() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Meu computador".to_string())
}

fn endereco_api() -> String {
    // Configurável para desenvolvimento; o padrão aponta para produção, que é
    // o que um instalador distribuído precisa usar.
    std::env::var("SLATE_API_URL").unwrap_or_else(|_| "https://slate.aionixdev.com/api".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let pasta = app
                .path()
                .app_data_dir()
                .map_err(|_| "não foi possível acessar a pasta de dados do aplicativo")?;

            // Uma identidade que não pode ser criada é falha fatal: sem ela o
            // Agente não tem como se apresentar. Mas a janela ainda abre, para
            // que a pessoa veja a explicação em vez de um programa que fecha
            // sozinho.
            let (identidade, falha) = match Identidade::carregar_ou_criar(&pasta) {
                Ok(i) => (Some(i), None),
                Err(e) => (None, Some(e.to_string())),
            };

            if let Some(identidade) = identidade {
                let pares = Arc::new(ParesConfiaveis::carregar(&pasta).map_err(|e| e.to_string())?);
                let atalhos =
                    Arc::new(AtalhosPersonalizados::carregar(&pasta).map_err(|e| e.to_string())?);
                // `com_sessao` e não `novo`: é o que faz o cookie de sessão
                // sobreviver ao fechamento do Agente.
                let api = ClienteApi::com_sessao(endereco_api(), &pasta);
                let avisos_de_permissao = transporte::canal_de_avisos();
                let tarefa = tauri::async_runtime::spawn(transporte::executar(
                    api.clone(),
                    identidade.clone(),
                    pares.clone(),
                    atalhos.clone(),
                    avisos_de_permissao.clone(),
                ));
                // A vigilância do primeiro plano roda ao lado do transporte, e
                // não dentro dele: ela não depende de haver sessão aberta, e
                // fica calada sozinha enquanto nenhum painel tiver regra.
                tauri::async_runtime::spawn(transporte::vigiar_primeiro_plano(
                    atalhos.clone(),
                    avisos_de_permissao.clone(),
                ));
                app.manage(Estado {
                    identidade,
                    api,
                    nome_computador: nome_do_computador(),
                    falha_inicial: Mutex::new(falha),
                    pares,
                    atalhos,
                    avisos_de_permissao,
                    _transporte: Mutex::new(Some(tarefa)),
                });
            } else {
                return Err(falha.unwrap_or_default().into());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            situacao,
            entrar,
            sair,
            confirmar_pareamento,
            criar_convite_qr,
            consultar_convite_qr,
            remover_dispositivo,
            definir_atalhos_permitidos,
            escolher_programa,
            listar_atalhos,
            criar_atalho,
            remover_atalho,
            renomear_atalho,
            listar_configuracao_deck,
            criar_perfil,
            duplicar_perfil,
            salvar_perfil,
            remover_perfil,
            definir_perfil_padrao,
            falha_inicial
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Agente do SLATE");
}
