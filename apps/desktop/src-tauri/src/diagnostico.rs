//! Registro em arquivo do que dá errado longe de quem poderia consertar.
//!
//! **Existe porque o Agente falhava em silêncio absoluto.** Em release ele é
//! compilado com `windows_subsystem = "windows"` — sem console —, então todo
//! `eprintln!` do processo escreve para lugar nenhum. Quando a conexão não
//! subia, a única informação disponível para qualquer pessoa era "Conectando"
//! no celular e "nenhum aparelho conectado" na janela: a mesma frase para o
//! outro lado não ter chegado, ter chegado e sido recusado, ou ter conectado e
//! caído em seguida.
//!
//! Diagnosticar isso à distância custou uma noite inteira e cinco hipóteses
//! erradas. O arquivo daqui é o que troca "adivinhe" por "leia".
//!
//! **O que entra é o que ajuda a consertar, e nada além.** Etapa que falhou e
//! motivo. Nada de SDP, candidato ICE, endereço de rede alheio, token ou
//! qualquer conteúdo que atravesse o canal: um arquivo de diagnóstico que
//! guarda segredo vira o próprio problema no dia em que alguém o anexa num
//! chamado.

use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static ARQUIVO: OnceLock<PathBuf> = OnceLock::new();

/// Teto do arquivo, em bytes.
///
/// Um Agente residente fica meses aberto, e um laço de reconexão escreve uma
/// linha a cada tentativa. Sem teto, o diagnóstico de um problema viraria um
/// problema de disco.
const MAXIMO: u64 = 512 * 1024;

/// Define onde o registro mora. Chamado uma vez, na subida.
pub fn iniciar(pasta: &std::path::Path) {
    let _ = ARQUIVO.set(pasta.join("diagnostico.log"));
}

/// Anota uma linha, com horário.
///
/// Falhar aqui não faz nada: um diagnóstico que derruba o programa que ele
/// deveria explicar seria pior do que não existir.
pub fn registrar(mensagem: &str) {
    // Continua indo para a saída de erro também, que é o que aparece em
    // `tauri dev` sem precisar abrir arquivo nenhum.
    eprintln!("{mensagem}");

    let Some(caminho) = ARQUIVO.get() else {
        return;
    };
    if std::fs::metadata(caminho).is_ok_and(|m| m.len() > MAXIMO) {
        let _ = std::fs::remove_file(caminho);
    }
    let segundos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if let Ok(mut arquivo) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(caminho)
    {
        let _ = writeln!(arquivo, "{segundos} {mensagem}");
    }
}

/// O caminho do registro, para a janela poder mostrá-lo.
pub fn caminho() -> Option<&'static PathBuf> {
    ARQUIVO.get()
}
