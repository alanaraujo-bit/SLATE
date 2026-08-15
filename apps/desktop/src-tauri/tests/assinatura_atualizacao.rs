use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};

const CHAVE_PUBLICA: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDhFMEVFM0E4ODc4QUZCQzIKUldUQys0cUhxT01PanFhU3NjY3hVb2xMUjYvWTV0aEIwMS9uVUxIUTRrWllqR0JYdWUvc0YvNTIK";
const CONTEUDO: &[u8] = include_bytes!("fixtures/conteudo-atualizacao.txt");
const ASSINATURA: &str = include_str!("fixtures/conteudo-atualizacao.txt.sig");

fn verificar(conteudo: &[u8]) -> bool {
    let publica_decodificada = String::from_utf8(STANDARD.decode(CHAVE_PUBLICA).unwrap()).unwrap();
    let assinatura_decodificada =
        String::from_utf8(STANDARD.decode(ASSINATURA.trim()).unwrap()).unwrap();
    let publica = PublicKey::decode(&publica_decodificada).unwrap();
    let assinatura = Signature::decode(&assinatura_decodificada).unwrap();
    publica.verify(conteudo, &assinatura, true).is_ok()
}

#[test]
fn aceita_pacote_produzido_pela_chave_de_release() {
    assert!(verificar(CONTEUDO));
}

#[test]
fn recusa_pacote_com_um_unico_byte_alterado() {
    let mut adulterado = CONTEUDO.to_vec();
    adulterado[0] ^= 1;
    assert!(!verificar(&adulterado));
}
