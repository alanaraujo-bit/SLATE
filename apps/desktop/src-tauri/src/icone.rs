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
