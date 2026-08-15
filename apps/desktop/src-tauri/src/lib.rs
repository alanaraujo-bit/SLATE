mod acoes;
mod api;
mod identidade;
mod pares;
mod transporte;

use api::{ClienteApi, Dispositivo, Usuario};
use identidade::{mensagem_confirmacao_pareamento, Identidade};
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
    })
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
                let api = ClienteApi::novo(endereco_api());
                let tarefa = tauri::async_runtime::spawn(transporte::executar(
                    api.clone(),
                    identidade.clone(),
                    pares.clone(),
                ));
                app.manage(Estado {
                    identidade,
                    api,
                    nome_computador: nome_do_computador(),
                    falha_inicial: Mutex::new(falha),
                    pares,
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
            falha_inicial
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Agente do SLATE");
}
