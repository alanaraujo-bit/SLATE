//! Extração do ícone de um executável do Windows.
//!
//! É o que separa um deck de uma lista de texto: o atalho de um jogo mostra o
//! ícone do jogo, sem ninguém procurar imagem nenhuma. O Windows já guarda essa
//! arte dentro do próprio `.exe`.
//!
//! O caminho é longo porque o Windows entrega o ícone como handle, e não como
//! imagem: o Shell dá o `HICON`, o GDI expõe os pixels dele, e só então dá para
//! codificar. Falhar em qualquer etapa devolve `None` — um atalho sem ícone
//! ainda funciona, e recusar o cadastro por causa da arte seria trocar um
//! detalhe por uma funcionalidade.

/// Lado do ícone extraído, em pixels.
///
/// 32 é o tamanho "grande" padrão do Shell e o que existe em praticamente todo
/// executável. Pedir 256 renderia mais nitidez em poucos casos e um ícone
/// esticado e borrado na maioria.
#[cfg(windows)]
const LADO: i32 = 32;

/// Extrai o ícone e devolve um data URI PNG, pronto para o `src` de uma imagem.
///
/// Data URI, e não arquivo: o ícone viaja no mesmo pacote que descreve o atalho
/// e chega ao celular sem uma segunda requisição — que teria de atravessar o
/// canal WebRTC e transformar o desenho da grade num vaivém.
#[cfg(windows)]
pub fn extrair(caminho: &str) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use windows::core::HSTRING;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, ReleaseDC, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS,
    };
    use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

    let mut info = SHFILEINFOW::default();
    let obtido = unsafe {
        SHGetFileInfoW(
            &HSTRING::from(caminho),
            Default::default(),
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if obtido == 0 || info.hIcon.is_invalid() {
        return None;
    }

    // A partir daqui todo caminho de saída precisa destruir o ícone. Um handle
    // vazado por atalho cadastrado é o tipo de defeito que só aparece depois de
    // horas de uso, como uma interface que para de desenhar.
    let resultado = (|| {
        let mut icone = ICONINFO::default();
        unsafe { GetIconInfo(info.hIcon, &mut icone) }.ok()?;

        let mascara = icone.hbmMask;
        let cor = icone.hbmColor;

        let pixels = (|| {
            if cor.is_invalid() {
                return None;
            }

            let mut cabecalho = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: LADO,
                    // Altura negativa pede as linhas de cima para baixo. Sem
                    // isso o Windows entrega o bitmap invertido e o ícone
                    // aparece de cabeça para baixo.
                    biHeight: -LADO,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };

            let mut bytes = vec![0u8; (LADO * LADO * 4) as usize];
            let dc = unsafe { GetDC(None) };
            let lidas = unsafe {
                GetDIBits(
                    dc,
                    cor,
                    0,
                    LADO as u32,
                    Some(bytes.as_mut_ptr() as *mut _),
                    &mut cabecalho,
                    DIB_RGB_COLORS,
                )
            };
            unsafe { ReleaseDC(None, dc) };
            if lidas == 0 {
                return None;
            }

            // O Windows entrega BGRA; o PNG quer RGBA.
            for p in bytes.chunks_exact_mut(4) {
                p.swap(0, 2);
            }

            // Ícone sem canal alfa vem com o byte de transparência zerado, o
            // que produziria uma imagem inteiramente invisível. Quando nenhum
            // pixel tem alfa, o desenho é opaco — é o que a máscara indicaria.
            if bytes.chunks_exact(4).all(|p| p[3] == 0) {
                for p in bytes.chunks_exact_mut(4) {
                    p[3] = 255;
                }
            }

            Some(bytes)
        })();

        if !mascara.is_invalid() {
            let _ = unsafe { DeleteObject(mascara) };
        }
        if !cor.is_invalid() {
            let _ = unsafe { DeleteObject(cor) };
        }

        let bytes = pixels?;
        let png = codificar_png(&bytes)?;
        Some(format!("data:image/png;base64,{}", STANDARD.encode(png)))
    })();

    let _ = unsafe { DestroyIcon(info.hIcon) };
    resultado
}

#[cfg(windows)]
fn codificar_png(rgba: &[u8]) -> Option<Vec<u8>> {
    let mut saida = Vec::new();
    {
        let mut codificador = png::Encoder::new(&mut saida, LADO as u32, LADO as u32);
        codificador.set_color(png::ColorType::Rgba);
        codificador.set_depth(png::BitDepth::Eight);
        let mut escritor = codificador.write_header().ok()?;
        escritor.write_image_data(rgba).ok()?;
    }
    Some(saida)
}

/// Fora do Windows não há ícone a extrair — o atalho vale sem ele.
#[cfg(not(windows))]
pub fn extrair(_caminho: &str) -> Option<String> {
    None
}

/// Teto de leitura de uma imagem escolhida à mão, antes de qualquer conversão.
///
/// Não é o teto do que vira tecla — esse é `atalhos::MAXIMO_ICONE`, e vale
/// sobre o data URI já pronto. Este aqui existe só para que um arquivo de 400
/// MB com extensão `.png` não vire 400 MB de memória a caminho de ser
/// recusado. 4 MiB cabe qualquer logotipo que alguém queira usar.
pub const MAXIMO_LEITURA: usize = 4 * 1024 * 1024;

/// Tipos de imagem aceitos como arte de tecla, reconhecidos pelos bytes.
///
/// **Pelo conteúdo, e não pela extensão.** A extensão é um palpite de quem
/// nomeou o arquivo, e o `Content-Type` de um favicon é um palpite de quem
/// configurou o servidor — na prática, muita gente serve PNG dizendo
/// `image/x-icon`. O que decide é o começo do arquivo.
///
/// SVG fica de fora. Não tem assinatura binária, é XML — logo, um documento com
/// script e referências externas dentro de um `<img>` que vai ser desenhado
/// tanto na janela quanto no celular. Um desenho não vale esse risco.
fn tipo_da_imagem(bytes: &[u8]) -> Option<&'static str> {
    // Escrita byte a byte: a assinatura do PNG começa em 0x89, que não é ASCII
    // e por isso não cabe num literal de string de bytes.
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    const ICO: &[u8] = &[0x00, 0x00, 0x01, 0x00];
    const CUR: &[u8] = &[0x00, 0x00, 0x02, 0x00];

    if bytes.starts_with(PNG) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.starts_with(ICO) || bytes.starts_with(CUR) {
        Some("image/x-icon")
    } else if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// Transforma bytes de imagem no data URI correspondente, sem redimensionar.
///
/// **Não aplica `MAXIMO_ICONE`, e é de propósito.** O que sai daqui vai para a
/// janela, que encolhe a imagem para o tamanho de uma tecla antes de mandar
/// gravar — e é o resultado desse encolhimento que `atalhos::validar_icone`
/// mede. Cortar aqui, no tamanho original, recusaria praticamente toda imagem
/// que alguém escolheria: um PNG de logotipo passa de 24 KiB sem esforço, e
/// depois de virar 64 pontos ele cabe de sobra.
///
/// Quem encolhe é o webview porque é ele quem já tem decodificador de PNG,
/// JPEG, GIF, WebP e ICO. Trazer um para cá seria reimplementar o navegador
/// que a janela já é.
pub fn de_bytes(bytes: &[u8]) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let tipo = tipo_da_imagem(bytes)?;
    Some(format!("data:{tipo};base64,{}", STANDARD.encode(bytes)))
}

/// Lê uma imagem escolhida no seletor de arquivo e devolve o data URI dela.
pub fn de_arquivo(caminho: &str) -> Option<String> {
    let metadados = std::fs::metadata(caminho).ok()?;
    if metadados.len() > MAXIMO_LEITURA as u64 {
        return None;
    }
    de_bytes(&std::fs::read(caminho).ok()?)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn reconhece_pelos_bytes_e_ignora_o_que_nao_e_imagem() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, b'x'];
        assert_eq!(tipo_da_imagem(&png), Some("image/png"));
        assert_eq!(tipo_da_imagem(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(tipo_da_imagem(b"GIF89a"), Some("image/gif"));
        assert_eq!(tipo_da_imagem(&[0, 0, 1, 0, 1, 0]), Some("image/x-icon"));
        assert_eq!(tipo_da_imagem(b"RIFF____WEBPVP8 "), Some("image/webp"));

        // O que um servidor devolve quando o favicon não existe: uma página de
        // erro com `Content-Type: image/x-icon` na cabeça. Confiar no tipo
        // declarado poria HTML dentro de um `<img>`.
        assert!(tipo_da_imagem(b"<!DOCTYPE html><html>").is_none());
        // SVG é recusado por escolha, e não por descuido.
        assert!(tipo_da_imagem(b"<svg xmlns=\"http://www.w3.org/2000/svg\">").is_none());
        assert!(tipo_da_imagem(b"").is_none());
    }
}
