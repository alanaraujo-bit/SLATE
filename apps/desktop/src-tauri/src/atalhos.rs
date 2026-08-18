//! Programas e perfis de deck definidos localmente neste computador.
//!
//! O arquivo guarda caminhos, mas o transporte nunca serializa esta estrutura
//! diretamente: o celular recebe somente identificadores de acoes conhecidas.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

const VERSAO_ARQUIVO: u8 = 2;
const ARQUIVO: &str = "atalhos.json";
const MAXIMO: usize = 100;
const MAXIMO_PERFIS: usize = 12;
const MAXIMO_ITENS: usize = 200;

/// Teto do endereço de um atalho de site, em caracteres.
///
/// 2048 é o limite prático que navegadores e servidores respeitam há décadas.
/// Um endereço maior que isto não é um atalho — é um payload.
const MAXIMO_URL: usize = 2048;

/**
 * Teto do ícone guardado, contando o data URI inteiro.
 *
 * **Não é estética, é a integridade do canal.** O deck viaja por DataChannel e
 * `LIMITE_MENSAGEM_DECK` (48 KiB, em `transporte.rs`) não é conselho:
 * estourar o limite do SCTP não devolve erro legível, derruba a conexão. E
 * `mensagens_do_deck` deixa um item grande demais passar sozinho de propósito
 * — recusá-lo tiraria a tecla da grade sem explicar.
 *
 * O ícone extraído de um `.exe` tem 32×32 e ocupa uns 2 KB. Um favicon `.ico`
 * ou uma imagem escolhida à mão passa de 100 KB sem esforço. 24 KiB deixa o
 * pior caso com folga debaixo do teto da mensagem, mesmo com a inflação do
 * base64 já contada — o valor aqui mede o texto final, não os bytes da arte.
 *
 * Quem não couber fica sem ícone, e a janela diz isso. É a mesma resposta que
 * `icone::extrair` já dá quando o Windows não entrega a arte.
 */
pub const MAXIMO_ICONE: usize = 24 * 1024;

pub const CORES: [&str; 12] = [
    "red", "orange", "amber", "yellow", "lime", "green", "teal", "cyan", "blue", "indigo",
    "violet", "pink",
];

/// A mesma lista fechada resolvida por `acoes.rs`.
pub const ACOES_FIXAS: [&str; 13] = [
    "midia.anterior",
    "midia.reproduzir-pausar",
    "midia.proxima",
    "midia.parar",
    "volume.diminuir",
    "volume.mudo",
    "volume.aumentar",
    "atalho.youtube",
    "atalho.twitch",
    "atalho.netflix",
    "atalho.prime",
    "atalho.disney",
    "atalho.spotify",
];

#[derive(Debug, thiserror::Error)]
pub enum ErroAtalhos {
    #[error("nao foi possivel guardar os atalhos")]
    Arquivo(#[from] std::io::Error),
    #[error("a configuracao do deck esta corrompida")]
    Corrompida,
    #[error("nao foi possivel acessar a configuracao do deck")]
    Concorrencia,
    #[error("esse arquivo nao e um programa que de para abrir")]
    CaminhoInvalido,
    #[error("esse endereco nao serve - use um endereco http ou https")]
    UrlInvalida,
    #[error("essa imagem e grande demais para virar uma tecla")]
    IconeInvalido,
    #[error("de um nome ao atalho")]
    NomeVazio,
    #[error("ja sao {MAXIMO} atalhos - remova algum antes de criar outro")]
    Cheio,
    #[error("atalho nao encontrado")]
    NaoEncontrado,
    #[error("perfil nao encontrado")]
    PerfilNaoEncontrado,
    #[error("ja sao {MAXIMO_PERFIS} perfis - remova algum antes de criar outro")]
    PerfisCheios,
    #[error("o perfil e invalido")]
    PerfilInvalido,
    #[error("o perfil padrao nao tem espaco para outro programa")]
    PerfilSemEspaco,
    #[error("o deck precisa ter ao menos um perfil")]
    UltimoPerfil,
}

/// O que um atalho abre.
///
/// Duas formas, um identificador só: o celular continua mandando
/// `programa.<id>` para as duas, porque abrir um site e abrir um programa são
/// a mesma autoridade (`system.process`, em `acoes.rs`) e separá-las daria
/// duas caixas para marcar sem nenhum ganho. O que muda é o mecanismo deste
/// lado, e ele é escolhido aqui — nunca pelo pedido que chegou.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Alvo<'a> {
    /// Caminho absoluto neste disco. Nunca atravessa o canal.
    Programa(&'a str),
    /// Endereço `http`/`https` digitado na janela do Agente.
    Site(&'a str),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Atalho {
    pub id: String,
    pub nome: String,
    /// Caminho absoluto do executavel. Nunca chega pelo canal.
    ///
    /// **Vazio quando o atalho é um endereço**, e é isso que mantém o arquivo
    /// na versão 2. Ver `url` para o porquê de não ser um enum.
    pub caminho: String,
    /**
     * Endereço, quando o atalho abre um site em vez de um programa.
     *
     * **Campo acrescentado em vez de um enum, e o arquivo continua na versão
     * 2.** Um enum seria o modelo honesto, mas obrigaria a versão 3 — e este
     * Agente se atualiza sozinho. Quem voltasse para uma versão anterior
     * encontraria um arquivo que ela recusa como corrompido, e
     * `AtalhosPersonalizados::carregar` é chamado no `setup` do Tauri: recusar
     * ali não é perder os atalhos, é a janela não abrir.
     *
     * Do jeito de baixo, um Agente antigo lê o arquivo inteiro, mostra o
     * atalho de site com caminho vazio e, se alguém o acionar, responde "o
     * programa deste atalho não está mais no lugar" — que é feio, mas é uma
     * frase numa tecla em vez de um programa que não abre.
     */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub cor: String,
    /// Data URI da arte da tecla, dentro de `MAXIMO_ICONE`.
    ///
    /// Vem do próprio `.exe`, do favicon do site ou de uma imagem escolhida à
    /// mão — e, seja qual for a origem, `None` é sempre uma resposta válida.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icone: Option<String>,
}

impl Atalho {
    /// O que este atalho abre, ou `None` se o cadastro não descreve nada.
    ///
    /// `None` acontece com um arquivo escrito por um Agente mais novo e lido
    /// por este — o oposto do caso que o campo `url` protege. Devolver
    /// `Option` obriga quem executa, pelo compilador, a dizer o que fazer com
    /// um atalho que ele não entende, em vez de abrir a coisa errada.
    pub fn alvo(&self) -> Option<Alvo<'_>> {
        match self.url.as_deref() {
            Some(url) if !url.is_empty() => Some(Alvo::Site(url)),
            _ if !self.caminho.is_empty() => Some(Alvo::Programa(&self.caminho)),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ItemDePerfilDeck {
    pub action_id: String,
    pub pagina: u8,
    pub ordem: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tamanho: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PerfilDeDeck {
    pub id: String,
    pub nome: String,
    pub cor: String,
    pub colunas_retrato: u8,
    pub colunas_paisagem: u8,
    pub itens: Vec<ItemDePerfilDeck>,
    /**
     * Executáveis que fazem este painel entrar sozinho, em minúsculas e sem
     * caminho — `obs64.exe`, `valorant.exe`.
     *
     * **Nunca atravessa o canal.** É a lista de programas desta máquina com
     * outro nome, e entregá-la a cada aparelho pareado é a mesma classe de
     * vazamento que o `caminho` do `Atalho` — por isso o deck é montado a
     * partir de `PerfilNoCanal`, em `transporte.rs`, que não tem este campo.
     *
     * `default` porque perfis gravados antes desta versão não o têm, e um
     * campo novo jamais pode invalidar um arquivo que já está no disco.
     */
    #[serde(default)]
    pub regras: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguracaoDeck {
    pub perfis: Vec<PerfilDeDeck>,
    pub perfil_padrao_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArquivoAtalhos {
    versao: u8,
    atalhos: Vec<Atalho>,
    perfis: Vec<PerfilDeDeck>,
    perfil_padrao_id: String,
}

#[derive(Deserialize)]
struct ArquivoAtalhosV1 {
    versao: u8,
    atalhos: Vec<Atalho>,
}

pub struct AtalhosPersonalizados {
    caminho: PathBuf,
    estado: RwLock<ArquivoAtalhos>,
}

impl AtalhosPersonalizados {
    pub fn carregar(pasta: &Path) -> Result<Self, ErroAtalhos> {
        std::fs::create_dir_all(pasta)?;
        let caminho = pasta.join(ARQUIVO);
        let (estado, precisa_gravar) = if caminho.exists() {
            let bruto = std::fs::read(&caminho)?;
            let valor: serde_json::Value =
                serde_json::from_slice(&bruto).map_err(|_| ErroAtalhos::Corrompida)?;
            match valor.get("versao").and_then(|v| v.as_u64()) {
                Some(1) => {
                    let antigo: ArquivoAtalhosV1 = serde_json::from_value(valor)
                        .map_err(|_| ErroAtalhos::Corrompida)?;
                    if antigo.versao != 1 || antigo.atalhos.len() > MAXIMO {
                        return Err(ErroAtalhos::Corrompida);
                    }
                    (novo_estado(antigo.atalhos), true)
                }
                Some(2) => {
                    let atual: ArquivoAtalhos = serde_json::from_value(valor)
                        .map_err(|_| ErroAtalhos::Corrompida)?;
                    validar_estado(&atual)?;
                    (atual, false)
                }
                _ => return Err(ErroAtalhos::Corrompida),
            }
        } else {
            (novo_estado(Vec::new()), true)
        };

        if precisa_gravar {
            gravar(&caminho, &estado)?;
        }
        Ok(Self {
            caminho,
            estado: RwLock::new(estado),
        })
    }

    pub fn listar(&self) -> Vec<Atalho> {
        self.estado
            .read()
            .map(|e| e.atalhos.clone())
            .unwrap_or_default()
    }

    pub fn configuracao(&self) -> ConfiguracaoDeck {
        self.estado
            .read()
            .map(|e| ConfiguracaoDeck {
                perfis: e.perfis.clone(),
                perfil_padrao_id: e.perfil_padrao_id.clone(),
            })
            .unwrap_or_else(|_| ConfiguracaoDeck {
                perfis: Vec::new(),
                perfil_padrao_id: String::new(),
            })
    }

    pub fn buscar(&self, id: &str) -> Option<Atalho> {
        self.estado
            .read()
            .ok()?
            .atalhos
            .iter()
            .find(|a| a.id == id)
            .cloned()
    }

    /// Cadastra um programa deste disco.
    ///
    /// **O ícone chega pronto, e não é extraído aqui.** Extrair do `.exe` é
    /// uma chamada ao Shell que dura microssegundos, mas a arte de um site
    /// vem da rede, com tempo limite medido em segundos — e este método
    /// segura a trava de escrita do estado. Resolver a imagem antes de
    /// chamar, do lado do comando, é o que impede um site fora do ar de
    /// travar a listagem e o reanúncio do deck junto.
    pub fn criar(
        &self,
        caminho: &str,
        nome: &str,
        cor: &str,
        icone: Option<String>,
    ) -> Result<Atalho, ErroAtalhos> {
        validar_caminho(caminho)?;
        self.inserir(caminho.to_string(), None, nome, cor, icone)
    }

    /// Cadastra um endereço.
    ///
    /// Irmão de `criar`, e de propósito: os dois produzem a mesma tecla, com o
    /// mesmo `programa.<id>`, e só o campo preenchido difere.
    pub fn criar_site(
        &self,
        url: &str,
        nome: &str,
        cor: &str,
        icone: Option<String>,
    ) -> Result<Atalho, ErroAtalhos> {
        let url = normalizar_url(url)?;
        self.inserir(String::new(), Some(url), nome, cor, icone)
    }

    fn inserir(
        &self,
        caminho: String,
        url: Option<String>,
        nome: &str,
        cor: &str,
        icone: Option<String>,
    ) -> Result<Atalho, ErroAtalhos> {
        let nome = nome.trim();
        if nome.is_empty() {
            return Err(ErroAtalhos::NomeVazio);
        }
        let icone = validar_icone(icone)?;
        let cor = if CORES.contains(&cor) { cor } else { "violet" };

        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        if estado.atalhos.len() >= MAXIMO {
            return Err(ErroAtalhos::Cheio);
        }
        let atalho = Atalho {
            id: uuid::Uuid::new_v4().to_string(),
            nome: nome.chars().take(40).collect(),
            caminho,
            url,
            cor: cor.to_string(),
            icone,
        };
        let mut candidato = estado.clone();
        adicionar_programa_ao_padrao(&mut candidato, &atalho)?;
        candidato.atalhos.push(atalho.clone());
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(atalho)
    }

    pub fn remover(&self, id: &str) -> Result<(), ErroAtalhos> {
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        if !estado.atalhos.iter().any(|a| a.id == id) {
            return Err(ErroAtalhos::NaoEncontrado);
        }
        let mut candidato = estado.clone();
        candidato.atalhos.retain(|a| a.id != id);
        let action_id = format!("programa.{id}");
        for perfil in &mut candidato.perfis {
            perfil.itens.retain(|item| item.action_id != action_id);
        }
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(())
    }

    /// Edita nome, cor e — só para atalho de site — o endereço.
    ///
    /// `url` só vale para quem já é site: promover um programa a endereço, ou
    /// o contrário, transformaria a tecla em outra coisa mantendo o mesmo
    /// identificador, e o celular não teria como saber. Quem quer trocar de
    /// forma remove e cadastra de novo.
    pub fn renomear(
        &self,
        id: &str,
        nome: &str,
        cor: &str,
        url: Option<&str>,
    ) -> Result<(), ErroAtalhos> {
        let nome = nome.trim();
        if nome.is_empty() {
            return Err(ErroAtalhos::NomeVazio);
        }
        let url = match url {
            Some(bruta) => Some(normalizar_url(bruta)?),
            None => None,
        };
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        let mut candidato = estado.clone();
        let alvo = candidato
            .atalhos
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or(ErroAtalhos::NaoEncontrado)?;
        alvo.nome = nome.chars().take(40).collect();
        if CORES.contains(&cor) {
            alvo.cor = cor.to_string();
        }
        if let Some(url) = url {
            if alvo.url.is_none() {
                return Err(ErroAtalhos::UrlInvalida);
            }
            alvo.url = Some(url);
        }
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(())
    }

    /// Troca a arte da tecla, ou tira a que estava lá.
    ///
    /// `None` volta a tecla ao desenho genérico, e é uma escolha legítima:
    /// nem todo favicon fica bom em 32 pontos, e uma tecla com a cor certa e
    /// sem imagem pode ser mais legível que uma com o desenho errado.
    pub fn definir_icone(&self, id: &str, icone: Option<String>) -> Result<(), ErroAtalhos> {
        let icone = validar_icone(icone)?;
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        let mut candidato = estado.clone();
        let alvo = candidato
            .atalhos
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or(ErroAtalhos::NaoEncontrado)?;
        alvo.icone = icone;
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(())
    }

    pub fn criar_perfil(&self, nome: &str, cor: &str) -> Result<PerfilDeDeck, ErroAtalhos> {
        let nome = nome.trim();
        if nome.is_empty() || nome.chars().count() > 28 || !CORES.contains(&cor) {
            return Err(ErroAtalhos::PerfilInvalido);
        }
        let perfil = PerfilDeDeck {
            id: uuid::Uuid::new_v4().to_string(),
            nome: nome.to_string(),
            cor: cor.to_string(),
            colunas_retrato: 3,
            colunas_paisagem: 6,
            itens: Vec::new(),
            regras: Vec::new(),
        };
        self.inserir_perfil(perfil)
    }

    pub fn duplicar_perfil(&self, id: &str) -> Result<PerfilDeDeck, ErroAtalhos> {
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        if estado.perfis.len() >= MAXIMO_PERFIS {
            return Err(ErroAtalhos::PerfisCheios);
        }
        let mut perfil = estado
            .perfis
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or(ErroAtalhos::PerfilNaoEncontrado)?;
        perfil.id = uuid::Uuid::new_v4().to_string();
        perfil.nome = nome_da_copia(&perfil.nome);
        let mut candidato = estado.clone();
        candidato.perfis.push(perfil.clone());
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(perfil)
    }

    pub fn salvar_perfil(&self, perfil: PerfilDeDeck) -> Result<PerfilDeDeck, ErroAtalhos> {
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        let mut perfil = perfil;
        normalizar_ordem(&mut perfil.itens);
        perfil.regras = normalizar_regras(&perfil.regras);
        validar_perfil(&perfil, &estado.atalhos)?;
        let mut candidato = estado.clone();
        let alvo = candidato
            .perfis
            .iter_mut()
            .find(|p| p.id == perfil.id)
            .ok_or(ErroAtalhos::PerfilNaoEncontrado)?;
        *alvo = perfil.clone();
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(perfil)
    }

    pub fn remover_perfil(&self, id: &str) -> Result<(), ErroAtalhos> {
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        if estado.perfis.len() == 1 {
            return Err(ErroAtalhos::UltimoPerfil);
        }
        if !estado.perfis.iter().any(|p| p.id == id) {
            return Err(ErroAtalhos::PerfilNaoEncontrado);
        }
        let mut candidato = estado.clone();
        candidato.perfis.retain(|p| p.id != id);
        if candidato.perfil_padrao_id == id {
            candidato.perfil_padrao_id = candidato.perfis[0].id.clone();
        }
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(())
    }

    pub fn definir_perfil_padrao(&self, id: &str) -> Result<(), ErroAtalhos> {
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        if !estado.perfis.iter().any(|p| p.id == id) {
            return Err(ErroAtalhos::PerfilNaoEncontrado);
        }
        let mut candidato = estado.clone();
        candidato.perfil_padrao_id = id.to_string();
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(())
    }

    fn inserir_perfil(&self, perfil: PerfilDeDeck) -> Result<PerfilDeDeck, ErroAtalhos> {
        let mut estado = self.estado.write().map_err(|_| ErroAtalhos::Concorrencia)?;
        if estado.perfis.len() >= MAXIMO_PERFIS {
            return Err(ErroAtalhos::PerfisCheios);
        }
        let mut candidato = estado.clone();
        candidato.perfis.push(perfil.clone());
        gravar(&self.caminho, &candidato)?;
        *estado = candidato;
        Ok(perfil)
    }
}

fn novo_estado(atalhos: Vec<Atalho>) -> ArquivoAtalhos {
    let perfil = perfil_padrao(&atalhos);
    ArquivoAtalhos {
        versao: VERSAO_ARQUIVO,
        atalhos,
        perfil_padrao_id: perfil.id.clone(),
        perfis: vec![perfil],
    }
}

fn perfil_padrao(atalhos: &[Atalho]) -> PerfilDeDeck {
    let id = uuid::Uuid::new_v4().to_string();
    let mut itens = Vec::new();
    for (ordem, action_id) in ACOES_FIXAS[..7].iter().enumerate() {
        itens.push(item(action_id, 0, ordem as u16));
    }
    for (ordem, action_id) in ACOES_FIXAS[7..].iter().enumerate() {
        itens.push(item(action_id, 1, ordem as u16));
    }
    for (indice, atalho) in atalhos.iter().enumerate() {
        itens.push(item(
            &format!("programa.{}", atalho.id),
            2 + (indice / 24) as u8,
            (indice % 24) as u16,
        ));
    }
    PerfilDeDeck {
        id,
        nome: "Principal".to_string(),
        cor: "violet".to_string(),
        colunas_retrato: 3,
        colunas_paisagem: 6,
        itens,
        regras: Vec::new(),
    }
}

fn item(action_id: &str, pagina: u8, ordem: u16) -> ItemDePerfilDeck {
    ItemDePerfilDeck {
        action_id: action_id.to_string(),
        pagina,
        ordem,
        cor: None,
        tamanho: None,
    }
}

fn adicionar_programa_ao_padrao(
    estado: &mut ArquivoAtalhos,
    atalho: &Atalho,
) -> Result<(), ErroAtalhos> {
    let perfil = estado
        .perfis
        .iter_mut()
        .find(|p| p.id == estado.perfil_padrao_id)
        .ok_or(ErroAtalhos::Corrompida)?;
    if perfil.itens.len() >= MAXIMO_ITENS {
        return Err(ErroAtalhos::PerfilSemEspaco);
    }
    let ocupados: HashSet<(u8, u16)> = perfil.itens.iter().map(|i| (i.pagina, i.ordem)).collect();
    let posicao = (2..=9)
        .flat_map(|pagina| (0..24).map(move |ordem| (pagina, ordem)))
        .find(|posicao| !ocupados.contains(posicao))
        .or_else(|| {
            (0..=9)
                .flat_map(|pagina| (0..=199).map(move |ordem| (pagina, ordem)))
                .find(|posicao| !ocupados.contains(posicao))
        })
        .ok_or(ErroAtalhos::PerfilSemEspaco)?;
    perfil.itens.push(item(
        &format!("programa.{}", atalho.id),
        posicao.0,
        posicao.1,
    ));
    Ok(())
}

fn validar_estado(estado: &ArquivoAtalhos) -> Result<(), ErroAtalhos> {
    if estado.versao != VERSAO_ARQUIVO
        || estado.atalhos.len() > MAXIMO
        || estado.perfis.is_empty()
        || estado.perfis.len() > MAXIMO_PERFIS
        || !estado
            .perfis
            .iter()
            .any(|p| p.id == estado.perfil_padrao_id)
    {
        return Err(ErroAtalhos::Corrompida);
    }
    let mut ids = HashSet::new();
    for perfil in &estado.perfis {
        if !ids.insert(&perfil.id) || validar_perfil(perfil, &estado.atalhos).is_err() {
            return Err(ErroAtalhos::Corrompida);
        }
    }
    Ok(())
}

/// Renumera as posições de cada página em 0, 1, 2, … sem buracos nem empates.
///
/// **Recusar um perfil malformado seria pior do que consertá-lo.** A janela
/// reordena trocando o `ordem` entre vizinhos, e dois itens com o mesmo número
/// fazem a troca não trocar nada: as setas param de funcionar e nada explica
/// por quê. Empate é fácil de produzir sem ninguém errar — mover teclas entre
/// páginas, duplicar um perfil, editar o arquivo à mão — e devolver "o perfil
/// é inválido" para quem só arrastou uma tecla não ajudaria em nada.
///
/// A ordenação é estável, então itens empatados mantêm a sequência em que
/// chegaram, e não uma escolhida por sorteio.
fn normalizar_ordem(itens: &mut [ItemDePerfilDeck]) {
    itens.sort_by_key(|item| (item.pagina, item.ordem));
    let mut pagina_atual: Option<u8> = None;
    let mut proxima: u16 = 0;
    for item in itens.iter_mut() {
        if pagina_atual != Some(item.pagina) {
            pagina_atual = Some(item.pagina);
            proxima = 0;
        }
        item.ordem = proxima;
        proxima += 1;
    }
}

/// Teto de regras por painel.
const MAXIMO_REGRAS: usize = 20;

/// Deixa cada regra na forma em que ela vai ser comparada.
///
/// Quem digita "OBS Studio.exe", " valorant.exe " ou cola um caminho inteiro
/// está descrevendo a mesma coisa que `obs64.exe`, e uma comparação literal
/// erraria as três. Normalizar na gravação — e não na comparação — é o que faz
/// o campo mostrar exatamente aquilo que vai valer, em vez de guardar um texto
/// e obedecer a outro.
///
/// Regras vazias somem, e repetidas também: as duas só existiriam para nunca
/// casar ou para casar duas vezes.
pub fn normalizar_regras(regras: &[String]) -> Vec<String> {
    let mut vistas = Vec::new();
    for regra in regras {
        let limpa = regra.trim().to_lowercase();
        // Aceita caminho colado e fica só com o nome do arquivo — é o que a
        // comparação recebe do Windows.
        let nome = limpa
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or(&limpa)
            .to_string();
        if nome.is_empty() || nome.chars().count() > 120 || vistas.contains(&nome) {
            continue;
        }
        vistas.push(nome);
        if vistas.len() == MAXIMO_REGRAS {
            break;
        }
    }
    vistas
}

/// O painel que um programa em foco pede, se algum pedir.
///
/// Função pura de propósito: é aqui que mora o comportamento, e a leitura do
/// Windows fica sendo uma casca fina que só devolve um nome de arquivo. Assim
/// a regra é testável numa máquina onde nada disso está rodando.
///
/// **O primeiro painel na ordem da lista ganha um empate.** Dois painéis
/// reivindicando `obs64.exe` é configuração ambígua, e resolver por ordem é
/// previsível — a alternativa seria alternar entre os dois conforme o humor do
/// mapa, que é o tipo de coisa impossível de depurar olhando.
pub fn perfil_para_programa<'a>(
    programa: &str,
    perfis: &'a [PerfilDeDeck],
) -> Option<&'a PerfilDeDeck> {
    let alvo = programa.trim().to_lowercase();
    if alvo.is_empty() {
        return None;
    }
    perfis
        .iter()
        .find(|perfil| perfil.regras.iter().any(|regra| *regra == alvo))
}

/// Se vale a pena olhar o programa em foco neste computador.
///
/// Sem nenhuma regra configurada, a resposta é não — e é o que mantém a
/// vigilância do primeiro plano **desligada até alguém pedir**. Depois da
/// migração todo painel nasce sem regra, então uma instalação que só atualizou
/// não ganha nenhum comportamento novo.
pub fn alguem_quer_contexto(perfis: &[PerfilDeDeck]) -> bool {
    perfis.iter().any(|perfil| !perfil.regras.is_empty())
}

fn validar_perfil(perfil: &PerfilDeDeck, atalhos: &[Atalho]) -> Result<(), ErroAtalhos> {
    if perfil.id.is_empty()
        || perfil.id.len() > 64
        || perfil.nome.trim().is_empty()
        || perfil.nome.chars().count() > 28
        || !CORES.contains(&perfil.cor.as_str())
        || !(2..=3).contains(&perfil.colunas_retrato)
        || !(4..=6).contains(&perfil.colunas_paisagem)
        || perfil.itens.len() > MAXIMO_ITENS
        || perfil.regras.len() > MAXIMO_REGRAS
        || perfil
            .regras
            .iter()
            .any(|r| r.trim().is_empty() || r.chars().count() > 120)
    {
        return Err(ErroAtalhos::PerfilInvalido);
    }
    for item in &perfil.itens {
        let tamanho_valido = item
            .tamanho
            .as_deref()
            .is_none_or(|t| matches!(t, "normal" | "largo"));
        let cor_valida = item
            .cor
            .as_deref()
            .is_none_or(|cor| CORES.contains(&cor));
        if item.action_id.is_empty()
            || item.action_id.len() > 128
            || item.pagina > 9
            || item.ordem > 199
            || !tamanho_valido
            || !cor_valida
            || !acao_existe(&item.action_id, atalhos)
        {
            return Err(ErroAtalhos::PerfilInvalido);
        }
    }
    Ok(())
}

fn acao_existe(action_id: &str, atalhos: &[Atalho]) -> bool {
    ACOES_FIXAS.contains(&action_id)
        || action_id
            .strip_prefix("programa.")
            .is_some_and(|id| !id.is_empty() && atalhos.iter().any(|a| a.id == id))
}

fn nome_da_copia(nome: &str) -> String {
    let sufixo = " (copia)";
    let limite = 28usize.saturating_sub(sufixo.chars().count());
    format!("{}{}", nome.chars().take(limite).collect::<String>(), sufixo)
}

/**
 * Deixa um endereço na forma em que ele vai ser aberto, ou recusa.
 *
 * Só `http` e `https` passam. Um atalho é uma tecla que abre alguma coisa no
 * navegador; `file://` abriria o disco, `javascript:` executaria script na
 * página que estivesse aberta, e esquemas registrados por outros programas
 * (`steam:`, `ms-settings:`) são superfície de execução com outro nome.
 *
 * **Não há lista de caracteres proibidos aqui, e é de propósito.** O endereço é
 * aberto por `ShellExecuteW`, que recebe a string inteira como um argumento só
 * e não passa por interpretador nenhum — quem protege é o mecanismo. Uma lista
 * negra seria pior que inútil: teria de recusar `&`, que é o separador normal
 * de toda consulta com mais de um parâmetro.
 *
 * O que continua recusado é espaço e caractere de controle, porque um endereço
 * de verdade não tem nenhum dos dois — quem os tem foi montado para enganar
 * quem lê a tela.
 */
pub fn normalizar_url(url: &str) -> Result<String, ErroAtalhos> {
    let url = url.trim();
    if url.chars().count() > MAXIMO_URL {
        return Err(ErroAtalhos::UrlInvalida);
    }
    let resto = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or(ErroAtalhos::UrlInvalida)?;
    let hospedeiro = resto
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    if hospedeiro.is_empty() || !hospedeiro.contains(|c: char| c.is_ascii_alphanumeric()) {
        return Err(ErroAtalhos::UrlInvalida);
    }
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(ErroAtalhos::UrlInvalida);
    }
    Ok(url.to_string())
}

/// Aceita a arte, ou explica por que ela não serve.
///
/// `None` entra e sai como `None`: tecla sem imagem é um estado normal, não
/// uma falha. O que não passa é o que não é imagem e o que não cabe no canal
/// (`MAXIMO_ICONE`).
pub fn validar_icone(icone: Option<String>) -> Result<Option<String>, ErroAtalhos> {
    let Some(icone) = icone else {
        return Ok(None);
    };
    if !icone.starts_with("data:image/") || icone.len() > MAXIMO_ICONE {
        return Err(ErroAtalhos::IconeInvalido);
    }
    Ok(Some(icone))
}

pub fn validar_caminho(caminho: &str) -> Result<(), ErroAtalhos> {
    let p = Path::new(caminho);
    if !p.is_absolute() || !p.is_file() {
        return Err(ErroAtalhos::CaminhoInvalido);
    }
    let extensao = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match extensao.as_deref() {
        Some("exe") | Some("lnk") | Some("bat") | Some("cmd") | Some("url") => Ok(()),
        _ => Err(ErroAtalhos::CaminhoInvalido),
    }
}

fn gravar(caminho: &Path, estado: &ArquivoAtalhos) -> Result<(), ErroAtalhos> {
    let bruto = serde_json::to_vec(estado).map_err(|_| ErroAtalhos::Corrompida)?;
    let temporario = caminho.with_extension("json.novo");
    {
        use std::io::Write;
        let mut arquivo = std::fs::File::create(&temporario)?;
        arquivo.write_all(&bruto)?;
        arquivo.sync_all()?;
    }
    std::fs::rename(&temporario, caminho)?;
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;

    fn pasta(nome: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "slate-atalhos-{nome}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn programa_existente() -> String {
        let candidatos = [
            r"C:\Windows\System32\notepad.exe",
            r"C:\Windows\notepad.exe",
            "/bin/sh",
        ];
        candidatos
            .iter()
            .find(|c| Path::new(c).is_file())
            .unwrap_or(&candidatos[0])
            .to_string()
    }

    #[test]
    fn recusa_caminho_que_nao_e_programa() {
        for ruim in ["nao-absoluto.exe", "", r"C:\Windows"] {
            assert!(validar_caminho(ruim).is_err(), "deixou passar: {ruim}");
        }
    }

    #[test]
    fn migra_v1_sem_perder_programas_e_monta_perfil_padrao() {
        let pasta = pasta("migracao");
        let atalho = Atalho {
            id: "programa-1".into(),
            nome: "Editor".into(),
            caminho: r"C:\Programas\editor.exe".into(),
            url: None,
            cor: "blue".into(),
            icone: None,
        };
        std::fs::write(
            pasta.join(ARQUIVO),
            serde_json::to_vec(&serde_json::json!({ "versao": 1, "atalhos": [atalho] })).unwrap(),
        )
        .unwrap();
        let carregado = AtalhosPersonalizados::carregar(&pasta).unwrap();
        assert_eq!(carregado.listar().len(), 1);
        let configuracao = carregado.configuracao();
        assert_eq!(configuracao.perfis.len(), 1);
        let itens = &configuracao.perfis[0].itens;
        for fixa in ACOES_FIXAS {
            assert!(itens.iter().any(|i| i.action_id == fixa));
        }
        assert!(itens.iter().any(|i| i.action_id == "programa.programa-1"));
        let salvo: serde_json::Value =
            serde_json::from_slice(&std::fs::read(pasta.join(ARQUIVO)).unwrap()).unwrap();
        assert_eq!(salvo["versao"], 2);
        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn cria_remove_e_limpa_referencias_do_programa() {
        let pasta = pasta("ciclo");
        let programa = programa_existente();
        if validar_caminho(&programa).is_err() {
            return;
        }
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        let criado = atalhos
            .criar(&programa, "  Meu Jogo  ", "green", None)
            .unwrap();
        let action_id = format!("programa.{}", criado.id);
        assert!(atalhos.configuracao().perfis[0]
            .itens
            .iter()
            .any(|i| i.action_id == action_id));
        atalhos.remover(&criado.id).unwrap();
        assert!(atalhos
            .configuracao()
            .perfis
            .iter()
            .all(|p| p.itens.iter().all(|i| i.action_id != action_id)));
        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn atalho_de_site_entra_na_grade_como_qualquer_programa() {
        let pasta = pasta("site");
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        let criado = atalhos
            .criar_site("  https://exemplo.com/painel  ", " Painel ", "cyan", None)
            .unwrap();

        // Mesmo identificador das teclas de programa, de propósito: é o que
        // permite ao celular não saber o que a tecla abre.
        let action_id = format!("programa.{}", criado.id);
        assert!(atalhos.configuracao().perfis[0]
            .itens
            .iter()
            .any(|i| i.action_id == action_id));
        assert_eq!(criado.nome, "Painel");
        assert_eq!(criado.url.as_deref(), Some("https://exemplo.com/painel"));
        assert!(criado.caminho.is_empty());
        assert_eq!(criado.alvo(), Some(Alvo::Site("https://exemplo.com/painel")));
        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn so_endereco_de_navegador_vira_atalho() {
        for ruim in [
            // Abriria o disco desta máquina.
            "file:///C:/Windows",
            // Executaria script na página aberta.
            "javascript:alert(1)",
            // Esquema registrado por outro programa é execução com outro nome.
            "steam://run/730",
            "ms-settings:",
            // Sem esquema não dá para saber o que é.
            "exemplo.com",
            "",
            "https://",
            // Espaço no meio: endereço de verdade não tem.
            "https://exemplo.com /outra-coisa",
        ] {
            assert!(normalizar_url(ruim).is_err(), "deixou passar: {ruim}");
        }

        // E o que é endereço de verdade passa, inclusive sem TLS: intranet e
        // roteador não têm certificado, e recusá-los recusaria metade do uso.
        for bom in [
            "https://exemplo.com",
            "http://192.168.0.1/admin",
            "https://exemplo.com/busca?a=1&b=2#topo",
        ] {
            assert!(normalizar_url(bom).is_ok(), "recusou: {bom}");
        }
    }

    #[test]
    fn a_arte_grande_demais_e_recusada_antes_de_chegar_ao_canal() {
        // O teto não é estético: LIMITE_MENSAGEM_DECK, em transporte.rs, é de
        // 48 KiB, e estourar o limite do SCTP derruba a conexão em vez de
        // devolver erro. Guardar um ícone maior seria trocar um desenho pelo
        // canal inteiro.
        let gigante = format!("data:image/png;base64,{}", "A".repeat(MAXIMO_ICONE));
        assert!(validar_icone(Some(gigante)).is_err());
        // O que não é imagem também não entra: um data:text/html viraria
        // documento dentro de uma imagem no celular.
        assert!(validar_icone(Some("data:text/html,<h1>oi</h1>".into())).is_err());
        assert!(validar_icone(Some("https://site/logo.png".into())).is_err());
        // Tecla sem arte continua sendo estado normal.
        assert!(matches!(validar_icone(None), Ok(None)));
    }

    #[test]
    fn editar_nao_transforma_programa_em_site() {
        // Trocar a forma mantendo o identificador faria a mesma tecla passar a
        // abrir outra coisa sem o celular ter como saber. Quem quer trocar
        // remove e cadastra de novo.
        let pasta = pasta("forma");
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        let programa = programa_existente();
        if validar_caminho(&programa).is_err() {
            return;
        }
        let criado = atalhos.criar(&programa, "Jogo", "green", None).unwrap();
        assert!(atalhos
            .renomear(&criado.id, "Jogo", "green", Some("https://exemplo.com"))
            .is_err());
        assert_eq!(atalhos.buscar(&criado.id).unwrap().url, None);

        // E o caminho inverso funciona: um site troca de endereço sem drama.
        let site = atalhos
            .criar_site("https://exemplo.com", "Site", "cyan", None)
            .unwrap();
        atalhos
            .renomear(&site.id, "Site", "cyan", Some("https://outro.com/x"))
            .unwrap();
        assert_eq!(
            atalhos.buscar(&site.id).unwrap().url.as_deref(),
            Some("https://outro.com/x")
        );
        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn um_agente_antigo_ainda_le_o_arquivo_com_atalho_de_site() {
        // A razão de o arquivo continuar na versão 2 e o endereço ser um campo
        // acrescentado, e não um enum. Este Agente se atualiza sozinho; quem
        // voltasse para uma versão anterior encontraria um arquivo recusado
        // como corrompido, e carregar é chamado no setup do Tauri — recusar
        // ali não perde atalhos, faz a janela não abrir.
        let pasta = pasta("compatibilidade");
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        atalhos
            .criar_site("https://exemplo.com", "Site", "cyan", None)
            .unwrap();

        let salvo: serde_json::Value =
            serde_json::from_slice(&std::fs::read(pasta.join(ARQUIVO)).unwrap()).unwrap();
        assert_eq!(salvo["versao"], 2);
        // O campo que o Agente antigo conhece está lá, vazio — e é ele que faz
        // a leitura passar em vez de estourar por campo faltando.
        assert_eq!(salvo["atalhos"][0]["caminho"], "");
        let _ = std::fs::remove_dir_all(pasta);
    }

    #[test]
    fn perfis_aplicam_limites_e_lista_fechada() {
        let pasta = pasta("perfis");
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        let mut perfil = atalhos.criar_perfil("Trabalho", "cyan").unwrap();
        perfil.itens.push(item("comando.arbitrario", 0, 0));
        assert!(matches!(
            atalhos.salvar_perfil(perfil),
            Err(ErroAtalhos::PerfilInvalido)
        ));
        let _ = std::fs::remove_dir_all(pasta);
    }

    fn perfil_com_regras(id: &str, regras: &[&str]) -> PerfilDeDeck {
        PerfilDeDeck {
            id: id.to_string(),
            nome: id.to_string(),
            cor: "violet".to_string(),
            colunas_retrato: 3,
            colunas_paisagem: 6,
            itens: Vec::new(),
            regras: regras.iter().map(|r| r.to_string()).collect(),
        }
    }

    #[test]
    fn a_regra_e_guardada_na_forma_em_que_vai_ser_comparada() {
        // O que o Windows devolve é `obs64.exe`, sempre. Quem digita escreve
        // com maiúscula, com espaço sobrando ou cola o caminho inteiro — e uma
        // comparação literal erraria os três casos calada.
        assert_eq!(
            normalizar_regras(&[
                "  OBS64.exe ".to_string(),
                r"C:\Riot Games\VALORANT.exe".to_string(),
                "obs64.exe".to_string(),
                "   ".to_string(),
            ]),
            vec!["obs64.exe", "valorant.exe"],
            "normaliza, tira caminho, e não repete",
        );
    }

    #[test]
    fn sem_nenhuma_regra_o_agente_nao_olha_o_primeiro_plano() {
        // É este teste que sustenta a promessa de que atualizar o Agente não
        // liga nada sozinho: depois da migração todo painel nasce sem regra.
        assert!(!alguem_quer_contexto(&[perfil_com_regras("a", &[])]));
        assert!(alguem_quer_contexto(&[
            perfil_com_regras("a", &[]),
            perfil_com_regras("b", &["obs64.exe"]),
        ]));
    }

    #[test]
    fn o_programa_em_foco_escolhe_o_painel_ou_nenhum() {
        let perfis = vec![
            perfil_com_regras("live", &["obs64.exe", "discord.exe"]),
            perfil_com_regras("jogo", &["valorant.exe"]),
            // Empate proposital: dois painéis reivindicando o mesmo programa.
            perfil_com_regras("outro", &["obs64.exe"]),
        ];

        assert_eq!(
            perfil_para_programa("obs64.exe", &perfis).map(|p| p.id.as_str()),
            Some("live"),
            "o empate vai para o primeiro da lista, e não para um sorteio",
        );
        assert_eq!(
            perfil_para_programa("VALORANT.EXE", &perfis).map(|p| p.id.as_str()),
            Some("jogo"),
            "o Windows não promete maiúsculas",
        );
        // Programa sem regra nenhuma não troca o painel — quem está usando
        // continua onde estava, que é bem melhor do que cair num padrão.
        assert!(perfil_para_programa("bloco-de-notas.exe", &perfis).is_none());
        // Processo elevado devolve nada do Windows, e nada não é erro.
        assert!(perfil_para_programa("", &perfis).is_none());
    }

    #[test]
    fn posicoes_empatadas_sao_renumeradas_em_vez_de_recusadas() {
        // O sintoma que isto evita não é um erro: é a seta de reordenar parar
        // de funcionar. A janela troca o `ordem` entre vizinhos, e trocar dois
        // números iguais não muda nada — a tecla fica presa e nada explica.
        let pasta = pasta("ordem");
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        let mut perfil = atalhos.configuracao().perfis[0].clone();
        perfil.itens = vec![
            item("midia.parar", 0, 7),
            item("volume.mudo", 0, 7),
            item("midia.proxima", 0, 3),
            item("atalho.netflix", 1, 99),
            item("atalho.prime", 1, 99),
        ];

        let salvo = atalhos.salvar_perfil(perfil).unwrap();

        let pagina_zero: Vec<_> = salvo.itens.iter().filter(|i| i.pagina == 0).collect();
        assert_eq!(
            pagina_zero
                .iter()
                .map(|i| (i.action_id.as_str(), i.ordem))
                .collect::<Vec<_>>(),
            // A menor posição vem primeiro; o empate preserva a sequência de
            // entrada, e não uma escolhida por sorteio.
            vec![("midia.proxima", 0), ("midia.parar", 1), ("volume.mudo", 2)],
        );
        let pagina_um: Vec<_> = salvo
            .itens
            .iter()
            .filter(|i| i.pagina == 1)
            .map(|i| i.ordem)
            .collect();
        assert_eq!(pagina_um, vec![0, 1], "cada página recomeça do zero");
        let _ = std::fs::remove_dir_all(pasta);
    }

    fn item(action_id: &str, pagina: u8, ordem: u16) -> ItemDePerfilDeck {
        ItemDePerfilDeck {
            action_id: action_id.to_string(),
            pagina,
            ordem,
            cor: None,
            tamanho: None,
        }
    }

    #[test]
    fn duplicar_remover_e_definir_padrao_persistem() {
        let pasta = pasta("crud");
        let atalhos = AtalhosPersonalizados::carregar(&pasta).unwrap();
        let original = atalhos.configuracao().perfis[0].clone();
        let copia = atalhos.duplicar_perfil(&original.id).unwrap();
        atalhos.definir_perfil_padrao(&copia.id).unwrap();
        atalhos.remover_perfil(&original.id).unwrap();
        let reaberto = AtalhosPersonalizados::carregar(&pasta).unwrap();
        assert_eq!(reaberto.configuracao().perfil_padrao_id, copia.id);
        assert_eq!(reaberto.configuracao().perfis.len(), 1);
        let _ = std::fs::remove_dir_all(pasta);
    }
}
