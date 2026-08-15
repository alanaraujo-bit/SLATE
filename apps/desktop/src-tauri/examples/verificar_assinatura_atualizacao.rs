use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use serde_json::Value;
use std::{env, error::Error, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn Error>> {
    let pacote = env::args_os().nth(1).ok_or("informe o caminho do pacote")?;
    let assinatura = env::args_os()
        .nth(2)
        .ok_or("informe o caminho da assinatura")?;
    let raiz = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let configuracao: Value = serde_json::from_slice(&fs::read(raiz.join("tauri.conf.json"))?)?;
    let publica_base64 = configuracao
        .pointer("/plugins/updater/pubkey")
        .and_then(Value::as_str)
        .ok_or("chave pública ausente no tauri.conf.json")?;

    let publica_texto = String::from_utf8(STANDARD.decode(publica_base64)?)?;
    let assinatura_texto =
        String::from_utf8(STANDARD.decode(fs::read_to_string(assinatura)?.trim())?)?;
    let publica = PublicKey::decode(&publica_texto)?;
    let assinatura = Signature::decode(&assinatura_texto)?;
    publica.verify(&fs::read(pacote)?, &assinatura, true)?;

    println!("Assinatura da atualização válida.");
    Ok(())
}
