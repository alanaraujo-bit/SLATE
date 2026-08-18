//! Descoberta do desenho de um site, para virar a arte de uma tecla.
//!
//! É o equivalente, para atalhos de endereço, do que `icone.rs` faz com um
//! `.exe`: sem isto, o atalho do site viraria um quadrado genérico enquanto o
//! do jogo ao lado mostra a arte dele. A diferença é que a arte do programa
//! está dentro do arquivo, e a do site está na rede — com tudo que isso traz.
//!
//! **Este módulo não usa o cliente de `api.rs`.** Aquele carrega o cookie de
//! sessão da conta, guardado em disco sob DPAPI; reaproveitá-lo mandaria a
//! sessão do SLATE para qualquer servidor cujo endereço alguém digitasse na
//! janela. O cliente daqui não tem armazenamento de cookies nenhum, não
//! autentica nada e existe só enquanto a busca dura.

use std::time::Duration;

/// Quanto tempo a busca inteira pode levar.
///
/// Curto de propósito: ninguém está esperando pelo desenho, está esperando para
/// cadastrar o atalho. Um site lento devolve `None`, o atalho nasce sem arte e
/// a pessoa escolhe uma imagem se quiser.
const TEMPO_LIMITE: Duration = Duration::from_secs(6);

/// Teto do HTML lido à procura do `<link rel="icon">`.
///
/// A declaração do ícone mora no `<head>`, nos primeiros quilobytes. Ler o
/// documento inteiro de um portal grande seriam megabytes atravessando a rede
/// para achar uma linha que já passou.
const MAXIMO_HTML: usize = 256 * 1024;

/// Busca o desenho do site e devolve o data URI dele.
///
/// `None` em toda falha — sem rede, sem ícone declarado, formato que não
/// reconhecemos, arquivo grande demais. Nenhuma delas impede o cadastro: um
/// atalho sem arte continua abrindo o endereço.
pub async fn buscar(url: &str) -> Option<String> {
    let base = reqwest::Url::parse(url).ok()?;
    let cliente = reqwest::Client::builder()
        .timeout(TEMPO_LIMITE)
        // Redirecionamento existe — `exemplo.com` que vira `www.exemplo.com` é
        // o caso comum —, mas limitado: uma corrente infinita seria um jeito
        // barato de prender a busca até o tempo limite.
        .redirect(reqwest::redirect::Policy::limited(5))
        // Sem isto, servidores que negociam conteúdo por navegador devolvem 403
        // ou uma página diferente da que qualquer pessoa veria.
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) SLATE-Agente")
        .build()
        .ok()?;

    // A ordem importa: o que o site declara vence o palpite. Um `/favicon.ico`
    // pode existir e ser o desenho antigo, ou o do domínio inteiro em vez do
    // desta aplicação.
    if let Some(declarado) = declarado_no_html(&cliente, &base).await {
        if let Some(icone) = baixar_imagem(&cliente, declarado).await {
            return Some(icone);
        }
    }

    let padrao = base.join("/favicon.ico").ok()?;
    baixar_imagem(&cliente, padrao).await
}

/// O endereço do ícone que a própria página declara, se declarar algum.
async fn declarado_no_html(cliente: &reqwest::Client, base: &reqwest::Url) -> Option<reqwest::Url> {
    let resposta = cliente.get(base.clone()).send().await.ok()?;
    if !resposta.status().is_success() {
        return None;
    }
    let html = ler_limitado(resposta, MAXIMO_HTML).await?;
    let html = String::from_utf8_lossy(&html);
    let href = href_do_icone(&html)?;
    base.join(&href).ok()
}

/// Extrai o `href` do primeiro `<link>` que se diz ícone.
///
/// **Uma varredura de texto, e não um analisador de HTML.** O que se procura é
/// uma linha do `<head>` com forma conhecida, e trazer um analisador completo
/// para achá-la seria pagar um pacote inteiro por um `find`. O custo dessa
/// escolha é conhecido: HTML criativo o bastante escapa da varredura, e o
/// resultado disso é o palpite `/favicon.ico` — o mesmo lugar aonde se chega
/// quando a página não declara nada.
///
/// Função pura de propósito, para ser testável sem rede.
pub fn href_do_icone(html: &str) -> Option<String> {
    let minusculo = html.to_lowercase();
    // O `<head>` basta, e parar nele evita casar com um `<link>` desenhado
    // dentro do corpo por algum componente.
    let limite = minusculo.find("</head>").unwrap_or(minusculo.len());
    let mut posicao = 0usize;

    while let Some(inicio) = minusculo[posicao..limite].find("<link") {
        let inicio = posicao + inicio;
        let fim = minusculo[inicio..limite]
            .find('>')
            .map(|f| inicio + f)
            .unwrap_or(limite);
        let tag = &minusculo[inicio..fim];
        posicao = fim.max(inicio + 5);

        // `rel="icon"`, `rel="shortcut icon"`, `rel="apple-touch-icon"` — e
        // nunca `rel="canonical"`, que é o outro `<link>` que toda página tem.
        // A comparação é por palavra inteira.
        let e_icone = valor_do_atributo(tag, "rel")
            .map(|rel| {
                rel.split_whitespace().any(|palavra| {
                    matches!(
                        palavra,
                        "icon"
                            | "shortcut"
                            | "apple-touch-icon"
                            | "apple-touch-icon-precomposed"
                    )
                })
            })
            .unwrap_or(false);
        if !e_icone {
            continue;
        }
        // O `href` sai do texto original, e não do minúsculo: um caminho de
        // arquivo pode diferenciar maiúsculas, e pedir `/Logo.png` como
        // `/logo.png` devolve 404 em servidor que respeita a caixa.
        if let Some(href) = valor_do_atributo(&html[inicio..fim], "href") {
            let href = href.trim();
            if !href.is_empty() {
                return Some(href.to_string());
            }
        }
    }
    None
}

/// O valor de um atributo dentro de uma tag, entre aspas simples ou duplas.
fn valor_do_atributo(tag: &str, nome: &str) -> Option<String> {
    let minusculo = tag.to_lowercase();
    let mut procura = 0usize;
    loop {
        let achado = procura + minusculo[procura..].find(nome)?;
        // Precisa ser o atributo, e não o fim de outro: `data-rel` não é `rel`.
        // Antes dele tem de haver espaço ou o começo da tag.
        let antes_serve = achado == 0
            || minusculo[..achado]
                .chars()
                .next_back()
                .is_some_and(char::is_whitespace);
        let depois = &minusculo[achado + nome.len()..];
        let depois_serve = depois.trim_start().starts_with('=');
        if antes_serve && depois_serve {
            let resto = &tag[achado + nome.len()..];
            let resto = resto.trim_start().strip_prefix('=')?.trim_start();
            let aspas = resto.chars().next()?;
            return if aspas == '"' || aspas == '\'' {
                resto[1..].split(aspas).next().map(str::to_string)
            } else {
                resto.split_whitespace().next().map(str::to_string)
            };
        }
        procura = achado + nome.len();
    }
}

/// Baixa uma imagem e devolve o data URI, se for imagem.
async fn baixar_imagem(cliente: &reqwest::Client, endereco: reqwest::Url) -> Option<String> {
    let resposta = cliente.get(endereco).send().await.ok()?;
    if !resposta.status().is_success() {
        return None;
    }
    let bytes = ler_limitado(resposta, crate::icone::MAXIMO_LEITURA).await?;
    // O tipo declarado pelo servidor é ignorado: quem decide é a assinatura do
    // arquivo. Página de erro servida como `image/x-icon` é caso comum, e ela
    // viraria HTML dentro de um `<img>` no celular.
    crate::icone::de_bytes(&bytes)
}

/// Lê o corpo até o teto, desistindo em vez de crescer.
///
/// `Content-Length` não é confiável — pode faltar, pode mentir —, então a conta
/// é feita sobre o que chega de fato.
async fn ler_limitado(mut resposta: reqwest::Response, teto: usize) -> Option<Vec<u8>> {
    let mut corpo = Vec::new();
    while let Ok(Some(pedaco)) = resposta.chunk().await {
        if corpo.len() + pedaco.len() > teto {
            return None;
        }
        corpo.extend_from_slice(&pedaco);
    }
    (!corpo.is_empty()).then_some(corpo)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn acha_o_icone_declarado_em_cada_forma_usada_na_web() {
        let casos = [
            (r#"<head><link rel="icon" href="/f.png"></head>"#, "/f.png"),
            (
                r#"<head><link rel="shortcut icon" href='/a.ico'></head>"#,
                "/a.ico",
            ),
            (
                r#"<head><link href="//cdn.site/x.png" rel="apple-touch-icon"></head>"#,
                "//cdn.site/x.png",
            ),
            // Caixa preservada no href, mesmo com a tag em maiúsculas.
            (
                r#"<HEAD><LINK REL="ICON" HREF="/Logo.PNG"></HEAD>"#,
                "/Logo.PNG",
            ),
        ];
        for (html, esperado) in casos {
            assert_eq!(href_do_icone(html).as_deref(), Some(esperado), "em: {html}");
        }
    }

    #[test]
    fn nao_confunde_outro_link_com_icone() {
        // `canonical` e `stylesheet` são os dois `<link>` que toda página tem.
        // Casar com eles poria a folha de estilo dentro de um `<img>`.
        let html = r#"<head>
            <link rel="canonical" href="https://site/">
            <link rel="stylesheet" href="/estilo.css">
        </head>"#;
        assert_eq!(href_do_icone(html), None);
    }

    #[test]
    fn ignora_link_de_icone_fora_do_head() {
        let html = r#"<head><link rel="stylesheet" href="/e.css"></head>
            <body><link rel="icon" href="/injetado.png"></body>"#;
        assert_eq!(href_do_icone(html), None);
    }
}
