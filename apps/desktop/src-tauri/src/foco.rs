//! Qual programa está em primeiro plano neste computador.
//!
//! **Este módulo é de propósito a coisa mais burra do projeto.** Ele devolve um
//! nome de arquivo, ou nada. Toda a decisão — qual painel isso pede, o que
//! fazer num empate, quando vale a pena olhar — mora em `atalhos.rs`, em
//! funções puras que rodam nos testes. Aqui embaixo fica só a chamada ao
//! Windows, que nenhuma máquina de testes consegue exercitar de verdade.
//!
//! A divisão não é estética: é o que permite o comportamento ser verificado sem
//! um Windows com janelas abertas na frente.
//!
//! **Nada aqui é lido enquanto ninguém configura uma regra.** Quem decide se
//! vale a pena perguntar é `alguem_quer_contexto`, e depois da migração todo
//! painel nasce sem regra nenhuma.

/// O nome do executável em primeiro plano, em minúsculas e sem caminho.
///
/// `None` quando não dá para saber, e **isso não é erro**. Os dois casos
/// comuns:
///
/// - Nenhuma janela em primeiro plano (a área de trabalho, a tela de bloqueio).
/// - Processo com privilégio mais alto que o do Agente. `OpenProcess` responde
///   acesso negado, e um jogo aberto como administrador cai exatamente aqui.
///
/// Quem chama trata ausência como "não mexa no painel", nunca como falha: parar
/// de responder é muito melhor do que arrancar a superfície da mão de alguém
/// por causa de uma leitura que não aconteceu.
pub fn programa_em_primeiro_plano() -> Option<String> {
    #[cfg(windows)]
    {
        windows_impl::consultar()
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(windows)]
mod windows_impl {
    use windows::Win32::Foundation::{CloseHandle, HANDLE, MAX_PATH};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    pub fn consultar() -> Option<String> {
        // SAFETY: as três chamadas são leituras do próprio sistema, sem
        // ponteiro nosso atravessando a fronteira além dos buffers locais
        // abaixo, e o handle é fechado antes de qualquer retorno.
        unsafe {
            let janela = GetForegroundWindow();
            if janela.0.is_null() {
                return None;
            }

            let mut processo_id: u32 = 0;
            GetWindowThreadProcessId(janela, Some(&mut processo_id));
            if processo_id == 0 {
                return None;
            }

            // `LIMITED_INFORMATION` e não `QUERY_INFORMATION`: é o direito
            // mínimo que ainda permite ler o caminho da imagem, e o único que
            // um processo sem privilégio consegue obter de processos de outras
            // sessões. Pedir mais falharia em mais casos sem ganhar nada.
            let processo: HANDLE =
                OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processo_id).ok()?;

            let mut buffer = [0u16; MAX_PATH as usize];
            let mut tamanho = buffer.len() as u32;
            let obteve = QueryFullProcessImageNameW(
                processo,
                PROCESS_NAME_FORMAT(0),
                windows::core::PWSTR(buffer.as_mut_ptr()),
                &mut tamanho,
            )
            .is_ok();
            let _ = CloseHandle(processo);

            if !obteve || tamanho == 0 {
                return None;
            }

            let caminho = String::from_utf16_lossy(&buffer[..tamanho as usize]);
            Some(nome_do_arquivo(&caminho))
        }
    }

    /// Fica só com o nome do arquivo, em minúsculas.
    ///
    /// Separada e testável porque é a única parte desta ilha que tem lógica:
    /// o que o Windows entrega é um caminho completo, e o que a regra guarda é
    /// o nome — comparar os dois inteiros nunca casaria.
    pub fn nome_do_arquivo(caminho: &str) -> String {
        caminho
            .trim_end_matches('\0')
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or(caminho)
            .to_lowercase()
    }

    #[cfg(test)]
    mod testes {
        use super::nome_do_arquivo;

        #[test]
        fn reduz_o_caminho_do_windows_ao_nome_comparavel() {
            assert_eq!(
                nome_do_arquivo(r"C:\Program Files\obs-studio\bin\64bit\obs64.exe"),
                "obs64.exe"
            );
            // O buffer volta preenchido com zeros depois do fim da string, e um
            // `\0` grudado no nome faria a comparação falhar sem nenhum sinal.
            assert_eq!(nome_do_arquivo("C:/Riot/VALORANT.exe\0\0"), "valorant.exe");
            assert_eq!(nome_do_arquivo("jogo.exe"), "jogo.exe");
        }
    }
}
