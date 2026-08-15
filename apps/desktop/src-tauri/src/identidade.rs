use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::pkcs8::DecodePublicKey as _;
use ed25519_dalek::{Signature as AssinaturaEd25519, Signer, SigningKey, Verifier, VerifyingKey};
use p256::ecdsa::{Signature as AssinaturaP256, VerifyingKey as ChaveP256};
use rand::rngs::OsRng;
use std::path::PathBuf;

/// Identidade criptográfica deste computador (ADR-0004 §1).
///
/// A chave privada é gerada uma vez e nunca sai daqui em texto claro. No
/// Windows ela é guardada protegida por DPAPI, o que a atrela à conta de
/// usuário: copiar o arquivo para outra máquina não devolve a chave.
#[derive(Debug, thiserror::Error)]
pub enum ErroIdentidade {
    #[error("falha ao ler ou gravar a identidade: {0}")]
    Arquivo(#[from] std::io::Error),
    #[error("a identidade guardada está corrompida")]
    Corrompida,
    #[error("falha ao proteger ou desproteger a chave")]
    Protecao,
}

#[derive(Clone)]
pub struct Identidade {
    chave: SigningKey,
}

impl Identidade {
    /// Carrega a identidade do disco, criando na primeira execução.
    pub fn carregar_ou_criar(pasta: &PathBuf) -> Result<Self, ErroIdentidade> {
        let caminho = pasta.join("identidade.bin");

        if caminho.exists() {
            let protegido = std::fs::read(&caminho)?;
            let bytes = desproteger(&protegido)?;

            let material: [u8; 32] = bytes
                .as_slice()
                .try_into()
                .map_err(|_| ErroIdentidade::Corrompida)?;

            return Ok(Self {
                chave: SigningKey::from_bytes(&material),
            });
        }

        std::fs::create_dir_all(pasta)?;

        // OsRng vem do sistema operacional. Gerar chave a partir de qualquer
        // fonte previsível tornaria a identidade adivinhável.
        let chave = SigningKey::generate(&mut OsRng);
        let protegido = proteger(&chave.to_bytes())?;

        std::fs::write(&caminho, protegido)?;
        restringir_permissoes(&caminho)?;

        Ok(Self { chave })
    }

    /// Chave pública em base64url — é o identificador deste computador.
    pub fn chave_publica(&self) -> String {
        let verificadora: VerifyingKey = self.chave.verifying_key();
        URL_SAFE_NO_PAD.encode(verificadora.to_bytes())
    }

    pub fn algoritmo(&self) -> &'static str {
        "Ed25519"
    }

    /// Assina uma mensagem. Usado no desafio-resposta da autenticação.
    pub fn assinar(&self, mensagem: &[u8]) -> String {
        URL_SAFE_NO_PAD.encode(self.chave.sign(mensagem).to_bytes())
    }
}

pub fn mensagem_desafio_sinalizacao(
    desafio_id: &str,
    dispositivo_id: &str,
    nonce: &str,
    expira_em: i64,
) -> String {
    format!("SLATE-SIGNAL-CHALLENGE/v1\n{desafio_id}\n{dispositivo_id}\n{nonce}\n{expira_em}")
}

pub fn mensagem_confirmacao_pareamento(codigo: &str, chave_publica_agente: &str) -> String {
    format!(
        "SLATE-PAIR-CONFIRM/v1\n{}\n{chave_publica_agente}",
        codigo.trim()
    )
}

pub fn normalizar_fingerprint_dtls(valor: &str) -> String {
    valor.trim().to_ascii_uppercase()
}

pub fn mensagem_fingerprint_dtls(sessao_id: &str, dispositivo_id: &str, valor: &str) -> String {
    format!(
        "SLATE-DTLS-FINGERPRINT/v1\n{sessao_id}\n{dispositivo_id}\nsha-256\n{}",
        normalizar_fingerprint_dtls(valor)
    )
}

/// Verifica as duas formas de chave aceitas pelo protocolo.
///
/// Ed25519 cru preserva Agentes já registrados; SPKI é a forma canônica usada
/// pela PWA. Entrada malformada sempre vira `false`, nunca caminho de exceção.
pub fn verificar_assinatura(
    chave_publica: &str,
    algoritmo: &str,
    mensagem: &[u8],
    assinatura: &str,
) -> bool {
    let Ok(chave) = URL_SAFE_NO_PAD.decode(chave_publica) else {
        return false;
    };
    let Ok(assinatura) = URL_SAFE_NO_PAD.decode(assinatura) else {
        return false;
    };

    match algoritmo {
        "Ed25519" => {
            let verificadora = if chave.len() == 32 {
                let Ok(bytes) = <[u8; 32]>::try_from(chave.as_slice()) else {
                    return false;
                };
                VerifyingKey::from_bytes(&bytes).ok()
            } else {
                VerifyingKey::from_public_key_der(&chave).ok()
            };
            let Ok(assinatura) = AssinaturaEd25519::from_slice(&assinatura) else {
                return false;
            };
            verificadora.is_some_and(|chave| chave.verify(mensagem, &assinatura).is_ok())
        }
        "ECDSA-P256" => {
            let Ok(verificadora) = ChaveP256::from_public_key_der(&chave) else {
                return false;
            };
            let Ok(assinatura) = AssinaturaP256::from_slice(&assinatura) else {
                return false;
            };
            verificadora.verify(mensagem, &assinatura).is_ok()
        }
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Proteção em repouso
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn proteger(dados: &[u8]) -> Result<Vec<u8>, ErroIdentidade> {
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

    let mut entrada = CRYPT_INTEGER_BLOB {
        cbData: dados.len() as u32,
        pbData: dados.as_ptr() as *mut u8,
    };
    let mut saida = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptProtectData(&mut entrada, None, None, None, None, 0, &mut saida)
            .map_err(|_| ErroIdentidade::Protecao)?;

        let resultado = std::slice::from_raw_parts(saida.pbData, saida.cbData as usize).to_vec();
        let _ = windows::Win32::Foundation::LocalFree(windows::Win32::Foundation::HLOCAL(
            saida.pbData as *mut _,
        ));

        Ok(resultado)
    }
}

#[cfg(windows)]
fn desproteger(dados: &[u8]) -> Result<Vec<u8>, ErroIdentidade> {
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let mut entrada = CRYPT_INTEGER_BLOB {
        cbData: dados.len() as u32,
        pbData: dados.as_ptr() as *mut u8,
    };
    let mut saida = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptUnprotectData(&mut entrada, None, None, None, None, 0, &mut saida)
            .map_err(|_| ErroIdentidade::Protecao)?;

        let resultado = std::slice::from_raw_parts(saida.pbData, saida.cbData as usize).to_vec();
        let _ = windows::Win32::Foundation::LocalFree(windows::Win32::Foundation::HLOCAL(
            saida.pbData as *mut _,
        ));

        Ok(resultado)
    }
}

/*
 * Fora do Windows a chave fica sem proteção adicional.
 *
 * Isso é aceitável só porque o Windows é a única plataforma alvo hoje; o
 * caminho existe para que o projeto compile em outros sistemas durante o
 * desenvolvimento. Antes de haver Agente para macOS ou Linux, isto precisa ser
 * trocado pelo cofre de credenciais de cada sistema — não é uma escolha, é uma
 * pendência.
 */
#[cfg(not(windows))]
fn proteger(dados: &[u8]) -> Result<Vec<u8>, ErroIdentidade> {
    Ok(dados.to_vec())
}

#[cfg(not(windows))]
fn desproteger(dados: &[u8]) -> Result<Vec<u8>, ErroIdentidade> {
    Ok(dados.to_vec())
}

/// Restringe o arquivo ao usuário atual.
#[cfg(windows)]
fn restringir_permissoes(_caminho: &PathBuf) -> Result<(), ErroIdentidade> {
    // No Windows a proteção efetiva vem do DPAPI: mesmo com o arquivo em mãos,
    // outro usuário não consegue desprotegê-lo.
    Ok(())
}

#[cfg(not(windows))]
fn restringir_permissoes(caminho: &PathBuf) -> Result<(), ErroIdentidade> {
    use std::os::unix::fs::PermissionsExt;
    // Somente o dono lê e escreve.
    std::fs::set_permissions(caminho, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;

    fn pasta_temporaria(nome: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("slate-teste-{nome}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn cria_identidade_na_primeira_vez() {
        let pasta = pasta_temporaria("cria");
        let identidade = Identidade::carregar_ou_criar(&pasta).unwrap();

        assert!(!identidade.chave_publica().is_empty());
        assert_eq!(identidade.algoritmo(), "Ed25519");

        let _ = std::fs::remove_dir_all(&pasta);
    }

    #[test]
    fn a_mesma_identidade_persiste_entre_execucoes() {
        // Se a identidade mudasse a cada abertura, o computador apareceria como
        // um dispositivo novo toda vez e o pareamento não valeria de nada.
        let pasta = pasta_temporaria("persiste");

        let primeira = Identidade::carregar_ou_criar(&pasta)
            .unwrap()
            .chave_publica();
        let segunda = Identidade::carregar_ou_criar(&pasta)
            .unwrap()
            .chave_publica();

        assert_eq!(primeira, segunda);

        let _ = std::fs::remove_dir_all(&pasta);
    }

    #[test]
    fn computadores_diferentes_tem_identidades_diferentes() {
        let a = pasta_temporaria("dif-a");
        let b = pasta_temporaria("dif-b");

        let ka = Identidade::carregar_ou_criar(&a).unwrap().chave_publica();
        let kb = Identidade::carregar_ou_criar(&b).unwrap().chave_publica();

        assert_ne!(ka, kb);

        let _ = std::fs::remove_dir_all(&a);
        let _ = std::fs::remove_dir_all(&b);
    }

    #[test]
    fn a_chave_privada_nao_fica_em_texto_claro_no_disco() {
        // No Windows o DPAPI cifra o conteúdo; o teste confirma que o material
        // bruto não aparece no arquivo.
        let pasta = pasta_temporaria("protegida");
        let identidade = Identidade::carregar_ou_criar(&pasta).unwrap();

        let bruto = std::fs::read(pasta.join("identidade.bin")).unwrap();
        let publica = URL_SAFE_NO_PAD.decode(identidade.chave_publica()).unwrap();

        if cfg!(windows) {
            assert_ne!(bruto.len(), 32, "o arquivo tem o tamanho de uma chave crua");
            assert!(
                !bruto
                    .windows(publica.len())
                    .any(|j| j == publica.as_slice()),
                "a chave aparece sem proteção no arquivo"
            );
        }

        let _ = std::fs::remove_dir_all(&pasta);
    }

    #[test]
    fn assina_de_forma_verificavel() {
        let pasta = pasta_temporaria("assina");
        let identidade = Identidade::carregar_ou_criar(&pasta).unwrap();

        let a = identidade.assinar(b"desafio-do-servidor");
        let b = identidade.assinar(b"desafio-do-servidor");
        let c = identidade.assinar(b"outro-desafio");

        // Ed25519 é determinístico: a mesma mensagem produz sempre a mesma
        // assinatura. É o que dispensa gerar um número aleatório por assinatura
        // — e é onde o ECDSA costuma falhar.
        assert_eq!(a, b);
        assert_ne!(a, c);

        let _ = std::fs::remove_dir_all(&pasta);
    }

    #[test]
    fn verifica_a_forma_crua_do_agente() {
        let pasta = pasta_temporaria("verifica-crua");
        let identidade = Identidade::carregar_ou_criar(&pasta).unwrap();
        let mensagem = b"prova-de-posse";
        assert!(verificar_assinatura(
            &identidade.chave_publica(),
            identidade.algoritmo(),
            mensagem,
            &identidade.assinar(mensagem),
        ));
        let _ = std::fs::remove_dir_all(&pasta);
    }

    #[test]
    fn formas_canonicas_batem_com_o_typescript() {
        assert_eq!(
            mensagem_desafio_sinalizacao(
                "11111111-1111-4111-8111-111111111111",
                "22222222-2222-4222-8222-222222222222",
                "abc_123",
                1_786_768_350_610,
            ),
            "SLATE-SIGNAL-CHALLENGE/v1\n11111111-1111-4111-8111-111111111111\n22222222-2222-4222-8222-222222222222\nabc_123\n1786768350610"
        );
        assert!(mensagem_fingerprint_dtls("sessao", "dispositivo", "aa:bb").ends_with("\nAA:BB"));
        assert_eq!(
            mensagem_confirmacao_pareamento(" 123456 ", "chave-do-agente"),
            "SLATE-PAIR-CONFIRM/v1\n123456\nchave-do-agente"
        );
    }
}
