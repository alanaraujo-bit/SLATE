//! A ligação com o CALL que roda neste mesmo computador.
//!
//! O CALL abre uma porta em `127.0.0.1` e grava porta e segredo em
//! `%LOCALAPPDATA%\CALL\controle.json` (ver `controle.rs`, no repositório dele).
//! Este módulo acha o arquivo, se conecta, mantém a conexão de pé e traduz os
//! dois sentidos: o estado que vem de lá vira `call.estado` para o celular, e o
//! toque no celular vira um pedido de mudo para cá.
//!
//! **Por que uma conexão que fica aberta, e não um pedido por toque.** O botão
//! de mudo do celular precisa mostrar se você está mudo. Sem isso ele é cara ou
//! coroa a cada aperto — e quem está com o celular na mão não tem como conferir
//! olhando para o computador, que é justamente o motivo de o SLATE existir. Uma
//! conexão aberta entrega a mudança no instante em que ela acontece, inclusive
//! quando quem mudou foi o atalho do teclado no PC.
//!
//! **O CALL fechado é o caso comum, não o erro.** Ninguém deixa o CALL aberto o
//! dia inteiro, e o SLATE é usado sem ele o tempo todo. Por isso nada aqui
//! reclama: sem arquivo, sem conexão, ou conexão caída, tudo termina no mesmo
//! lugar — `disponivel: false` — e o celular explica em vez de mostrar uma tecla
//! que não faz nada.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

use crate::transporte::{Aviso, AvisoDePermissao};

/// Quanto se espera antes de procurar o CALL de novo.
///
/// Cinco segundos porque o custo de errar é assimétrico: procurar cedo demais é
/// ler um arquivo que não existe, várias vezes por minuto, para sempre;
/// procurar tarde demais é o botão do celular demorar a aparecer depois que a
/// pessoa abriu o CALL. Cinco segundos é imperceptível no segundo caso e
/// irrelevante no primeiro.
const ESPERA_ENTRE_TENTATIVAS: Duration = Duration::from_secs(5);

/// Teto por linha vinda do CALL.
///
/// Não é desconfiança do CALL: é que do outro lado da porta pode estar qualquer
/// processo desta máquina, e um que nunca mande `\n` faria este buffer crescer
/// sem fim.
const LIMITE_DE_LINHA: u64 = 4 * 1024;

/// O que o celular precisa saber sobre o CALL daquele computador.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstadoCall {
    pub disponivel: bool,
    pub em_chamada: bool,
    pub mudo: bool,
    pub transmitindo: bool,
}

/// Uma linha vinda do CALL.
///
/// Tipo desconhecido é ignorado em silêncio, e não derruba a conexão: um CALL
/// mais novo que este Agente é o estado normal — os dois são instaladores
/// separados, atualizados em dias diferentes.
#[derive(Debug, Deserialize)]
#[serde(tag = "tipo", rename_all = "kebab-case")]
enum LinhaDoCall {
    #[serde(rename_all = "camelCase")]
    Estado {
        em_chamada: bool,
        mudo: bool,
        transmitindo: bool,
    },
}

#[derive(Debug, Deserialize)]
struct Descoberta {
    porta: u16,
    segredo: String,
}

/// O estado do CALL e o caminho de volta até ele.
///
/// Uma fonte só para a pergunta "o que o CALL está fazendo": quem quiser saber
/// lê daqui. Guardar a mesma resposta em dois lugares é o defeito que só aparece
/// no dia em que um dos dois muda.
pub struct LigacaoComOCall {
    estado: Mutex<EstadoCall>,
    pedidos: mpsc::UnboundedSender<bool>,
}

impl LigacaoComOCall {
    pub fn nova() -> (Arc<Self>, mpsc::UnboundedReceiver<bool>) {
        let (pedidos, recebedor) = mpsc::unbounded_channel();
        (
            Arc::new(Self {
                estado: Mutex::new(EstadoCall::default()),
                pedidos,
            }),
            recebedor,
        )
    }

    pub fn estado(&self) -> EstadoCall {
        self.estado.lock().map(|e| *e).unwrap_or_default()
    }

    /// Pede ao CALL que fique mudo, ou que volte a falar.
    ///
    /// Recusa antes de mandar quando o pedido não teria efeito. O CALL também
    /// desiste em silêncio nesses casos, e silêncio é a pior resposta possível
    /// para quem apertou um botão do outro lado da casa: a pessoa fica sem saber
    /// se o comando não chegou, se o computador travou, ou se está tudo bem.
    pub fn pedir_mudo(&self, valor: bool) -> Result<(), &'static str> {
        let estado = self.estado();
        if !estado.disponivel {
            return Err("o CALL não está aberto nesse computador");
        }
        if !estado.em_chamada {
            return Err("não há chamada de voz aberta no CALL");
        }
        self.pedidos
            .send(valor)
            .map_err(|_| "a ligação com o CALL caiu")
    }

    /// Guarda o estado novo. Devolve se ele é diferente do que já estava aqui —
    /// é o que evita reanunciar ao celular uma mudança que não houve.
    fn definir(&self, novo: EstadoCall) -> bool {
        let Ok(mut atual) = self.estado.lock() else {
            return false;
        };
        if *atual == novo {
            return false;
        }
        *atual = novo;
        true
    }
}

/// Onde o CALL diz que está.
fn arquivo_de_descoberta() -> Option<PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    Some(PathBuf::from(base).join("CALL").join("controle.json"))
}

fn ler_descoberta() -> Option<Descoberta> {
    interpretar_descoberta(&std::fs::read_to_string(arquivo_de_descoberta()?).ok()?)
}

/// O conteúdo do arquivo, sem o disco no caminho.
///
/// Separada porque é aqui que mora o **contrato entre os dois repositórios**: o
/// que `anotar_descoberta` escreve do lado do CALL é exatamente o que esta
/// função precisa aceitar. Os dois lados são instaladores independentes, e um
/// nome de campo que divergisse não apareceria em teste nenhum dos dois — o
/// sintoma seria o painel simplesmente nunca achar o CALL, sem erro em lugar
/// algum. O teste abaixo fixa a forma literal, do mesmo jeito que a grade de
/// ações é fixada dos dois lados.
fn interpretar_descoberta(conteudo: &str) -> Option<Descoberta> {
    let descoberta: Descoberta = serde_json::from_str(conteudo).ok()?;
    // Porta zero não é endereço: é o que o CALL pediria ao sistema, não o que
    // ele recebeu. Um arquivo com zero está corrompido, e tentar conectar nele
    // daria um erro sem explicação.
    (descoberta.porta != 0 && !descoberta.segredo.is_empty()).then_some(descoberta)
}

/// Mantém a ligação de pé pelo resto da vida do Agente.
///
/// Nunca termina, e nunca desiste: o CALL abrir e fechar várias vezes numa
/// tarde é uso normal, e cada volta dele precisa reencontrar o painel sozinha.
pub async fn manter_ligacao(
    ligacao: Arc<LigacaoComOCall>,
    avisos: AvisoDePermissao,
    mut pedidos: mpsc::UnboundedReceiver<bool>,
) {
    loop {
        if let Some(descoberta) = ler_descoberta() {
            atender(&ligacao, &avisos, &mut pedidos, &descoberta).await;
            // Saiu de `atender` — a conexão caiu ou o CALL fechou. O celular
            // precisa saber disso agora, e não no próximo aperto de botão que
            // não funcionar.
            if ligacao.definir(EstadoCall::default()) {
                let _ = avisos.send(Aviso::Call);
            }
        }
        tokio::time::sleep(ESPERA_ENTRE_TENTATIVAS).await;
    }
}

/// Uma conexão com o CALL, do aperto de mão até a queda.
async fn atender(
    ligacao: &LigacaoComOCall,
    avisos: &AvisoDePermissao,
    pedidos: &mut mpsc::UnboundedReceiver<bool>,
    descoberta: &Descoberta,
) {
    let Ok(fluxo) = TcpStream::connect(("127.0.0.1", descoberta.porta)).await else {
        return;
    };
    let (leitura, mut escrita) = fluxo.into_split();

    let credencial = serde_json::json!({ "segredo": descoberta.segredo });
    if escrita
        .write_all(format!("{credencial}\n").as_bytes())
        .await
        .is_err()
    {
        return;
    }

    /*
     * Ler e escrever são dois laços independentes, e não dois braços de um
     * `select!` por linha.
     *
     * A diferença não é de estilo: `read_line` **não** é seguro a cancelamento.
     * Num `select!` por iteração, um pedido de mudo que chegasse no meio de uma
     * linha derrubaria o futuro da leitura e jogaria fora o pedaço já lido — o
     * canal continuaria de pé entregando lixo, e o sintoma apareceria como "o
     * estado do CALL às vezes some", muito longe daqui.
     *
     * Assim os dois laços correm lado a lado sem se interromper: um só é
     * descartado quando o outro termina, que é quando a conexão acabou de
     * qualquer jeito. As duas metades do socket são separadas por
     * `into_split`, então não disputam nada.
     */
    let ler = async {
        let mut leitura = BufReader::new(leitura);
        let mut linha = String::new();
        loop {
            linha.clear();
            match ler_linha(&mut leitura, &mut linha).await {
                Ok(0) | Err(_) => return,
                Ok(_) => {}
            }
            // Linha que este Agente não entende passa batido, e a conexão
            // segue. Um CALL mais novo mandando um tipo novo não pode derrubar
            // o que os dois lados já sabem fazer.
            let Ok(LinhaDoCall::Estado {
                em_chamada,
                mudo,
                transmitindo,
            }) = serde_json::from_str::<LinhaDoCall>(linha.trim())
            else {
                continue;
            };
            let novo = EstadoCall {
                disponivel: true,
                em_chamada,
                mudo,
                transmitindo,
            };
            if ligacao.definir(novo) {
                // O aviso não carrega o estado: quem reagir a ele lê da
                // ligação. Uma fonte só, pelo mesmo motivo que
                // `Aviso::Permissao` carrega só o destino.
                let _ = avisos.send(Aviso::Call);
            }
        }
    };

    let escrever = async {
        while let Some(valor) = pedidos.recv().await {
            let pedido = serde_json::json!({ "tipo": "mudo", "valor": valor });
            if escrita
                .write_all(format!("{pedido}\n").as_bytes())
                .await
                .is_err()
            {
                return;
            }
        }
    };

    tokio::select! {
        () = ler => {}
        () = escrever => {}
    }
}

/// Lê uma linha, com teto.
///
/// O `take` é refeito a cada chamada de propósito: o limite é **por linha**, e
/// um `Take` reaproveitado somaria a mensagem de agora com todas as anteriores
/// até parar de ler no meio de uma conversa saudável.
async fn ler_linha<R: tokio::io::AsyncBufRead + Unpin>(
    leitura: &mut R,
    linha: &mut String,
) -> std::io::Result<usize> {
    leitura.take(LIMITE_DE_LINHA).read_line(linha).await
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn o_arquivo_que_o_call_escreve_e_aceito_como_ele_escreve() {
        /*
         * Esta linha é literalmente o que `anotar_descoberta` grava em
         * `%LOCALAPPDATA%CALLntrole.json`, no outro repositório
         * (`src-tauri/src/controle.rs`), e o teste
         * `o_arquivo_de_descoberta_sai_na_forma_que_o_slate_espera` a fixa de
         * lá. Os dois precisam andar juntos.
         *
         * É o único contrato entre os dois projetos que nenhum dos dois
         * consegue verificar sozinho: são instaladores separados, e um campo
         * renomeado de um lado não quebraria compilação nem teste nenhum do
         * outro. O sintoma seria o painel nunca achar o CALL — sem erro, sem
         * log, sem pista.
         */
        let descoberta = interpretar_descoberta(r#"{"porta":54321,"segredo":"abc123"}"#)
            .expect("o arquivo escrito pelo CALL precisa ser aceito aqui");
        assert_eq!(descoberta.porta, 54_321);
        assert_eq!(descoberta.segredo, "abc123");
    }

    #[test]
    fn arquivo_corrompido_nao_vira_tentativa_de_conexao() {
        // Porta zero é o que o CALL *pede* ao sistema, nunca o que ele recebe;
        // e segredo vazio nunca passaria na credencial. Nos dois casos, tentar
        // conectar daria um erro sem explicação em vez de "o CALL não está
        // aberto", que é a verdade.
        assert!(interpretar_descoberta(r#"{"porta":0,"segredo":"abc"}"#).is_none());
        assert!(interpretar_descoberta(r#"{"porta":54321,"segredo":""}"#).is_none());
        // Arquivo pela metade, ou de uma versão que ninguém entende ainda.
        assert!(interpretar_descoberta(r#"{"porta":54321}"#).is_none());
        assert!(interpretar_descoberta("").is_none());
    }

    #[test]
    fn a_linha_de_estado_do_call_vira_estado() {
        let Ok(LinhaDoCall::Estado {
            em_chamada,
            mudo,
            transmitindo,
        }) = serde_json::from_str::<LinhaDoCall>(
            r#"{"tipo":"estado","emChamada":true,"mudo":true,"transmitindo":false}"#,
        ) else {
            panic!("a linha de estado deveria ser reconhecida");
        };
        assert!(em_chamada);
        assert!(mudo);
        assert!(!transmitindo);
    }

    #[test]
    fn linha_de_tipo_desconhecido_nao_e_estado() {
        // Um CALL mais novo mandando algo que este Agente não conhece. Precisa
        // falhar como "ignore esta linha", e nunca como queda de conexão.
        assert!(serde_json::from_str::<LinhaDoCall>(r#"{"tipo":"participantes","n":3}"#).is_err());
        assert!(serde_json::from_str::<LinhaDoCall>("ruído").is_err());
    }

    #[test]
    fn sem_o_call_aberto_o_pedido_e_recusado_com_motivo() {
        let (ligacao, _recebedor) = LigacaoComOCall::nova();
        assert_eq!(ligacao.estado(), EstadoCall::default());
        assert!(ligacao.pedir_mudo(true).is_err());

        // Conectado, mas fora de uma chamada: continua recusa, e com outro
        // motivo — é a diferença que a tela precisa explicar.
        ligacao.definir(EstadoCall {
            disponivel: true,
            em_chamada: false,
            mudo: false,
            transmitindo: false,
        });
        assert_eq!(
            ligacao.pedir_mudo(true),
            Err("não há chamada de voz aberta no CALL")
        );

        ligacao.definir(EstadoCall {
            disponivel: true,
            em_chamada: true,
            mudo: false,
            transmitindo: false,
        });
        assert!(ligacao.pedir_mudo(true).is_ok());
    }

    #[test]
    fn definir_so_avisa_quando_muda_de_verdade() {
        let (ligacao, _recebedor) = LigacaoComOCall::nova();
        let estado = EstadoCall {
            disponivel: true,
            em_chamada: true,
            mudo: false,
            transmitindo: false,
        };
        assert!(ligacao.definir(estado));
        // O CALL republica o estado em situações que não mudaram nada; reanunciar
        // ao celular a cada uma delas seria ruído no canal.
        assert!(!ligacao.definir(estado));
    }
}
