use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};

/// Energia remota (ADR-0006).
///
/// Duas metades que parecem uma só e não são:
///
/// - **Desligar** acontece com este Agente rodando. É ação comum, e entra pelo
///   registro fechado de `acoes.rs` como qualquer outra.
/// - **Acordar** acontece com o Agente do *alvo* desligado. Este módulo é
///   sempre a **ponte**: quem emite o pacote é um Agente vivo na mesma rede.
///
/// O fato que governa tudo: um navegador não emite quadro de broadcast. Acordar
/// exige um componente dentro da rede do alvo, e este é ele.
///
/// A parte pura — perfil, escolha do estado, montagem do pacote — fica separada
/// das chamadas ao Windows de propósito: é o que permite exercitar a regra
/// inteira no CI do Ubuntu, onde não há nem Windows nem placa de rede para
/// acordar.

// ---------------------------------------------------------------------------
// Perfil de capacidades
// ---------------------------------------------------------------------------

/// O que se sabe sobre uma capacidade desta máquina.
///
/// `Desconhecido` **não** é sinônimo de `Nao`, e a distinção é a promessa
/// central do ADR-0006. Uma máquina cujo autoteste nunca rodou não suporta
/// menos que outra — nós é que não sabemos, e a interface precisa poder dizer
/// isso em vez de escolher um chute que vira uma máquina que não liga mais.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Suporte {
    Sim,
    Nao,
    Desconhecido,
}

impl Suporte {
    fn de_bool(valor: bool) -> Self {
        if valor {
            Suporte::Sim
        } else {
            Suporte::Nao
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EstadoProntoParaRetorno {
    Desligado,
    Hibernado,
    Nenhum,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum NivelEnergia {
    Completo,
    #[serde(rename = "PADRAO")]
    Padrao,
    Limitado,
}

/// Por que acordar não está disponível. Lista fechada porque cada motivo tem um
/// texto e uma ação diferentes na tela — "não deu" não ajuda ninguém.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Impedimento {
    HibernacaoDesligada,
    AdaptadorSemPermissao,
    AdaptadorNaoSuporta,
    FirmwarePrecisaDeAjuste,
    SemPonteNaRede,
    NaoTestado,
}

/// O perfil como ele viaja até o celular.
///
/// **Não existe endereço físico neste struct, e a ausência é a
/// funcionalidade** — mesma regra de `AtalhoDeDeck` não carregar caminho. O
/// endereço mora na nuvem e é entregue só à ponte, autenticada e restrita à
/// própria conta. Publicá-lo aqui daria a todo aparelho pareado o mapa de
/// endereços físicos da casa (ADR-0006 §3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfilEnergia {
    pub bloquear: Suporte,
    pub suspender: Suporte,
    pub hibernar: Suporte,
    pub reiniciar: Suporte,
    pub desligar: Suporte,
    pub cancelar_desligamento: Suporte,

    pub acordar_pela_rede: Suporte,
    pub acordar_de_suspenso: Suporte,
    pub acordar_de_hibernado: Suporte,
    /// O caso que decide entre COMPLETO e PADRÃO, e o único que nenhuma leitura
    /// do Windows responde com confiança: depende de firmware. Fica
    /// `Desconhecido` até um autoteste real, e é assim que deve ser.
    pub acordar_de_desligado: Suporte,

    pub pronto_para_retorno: EstadoProntoParaRetorno,
    pub nivel: NivelEnergia,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub adaptador: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tipo_de_adaptador: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub impedimentos: Vec<Impedimento>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub testado_em: Option<i64>,
}

/// O que a detecção descobriu, antes de virar perfil publicável.
///
/// Separado do `PerfilEnergia` porque carrega o endereço físico, que **não**
/// pode ser serializado para o celular. Este struct fica no processo do Agente
/// e vai para a nuvem, nunca para o canal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapacidadesDetectadas {
    pub suspender: bool,
    pub hibernar: bool,
    pub acordar_de_suspenso: Suporte,
    pub acordar_de_hibernado: Suporte,
    pub acordar_de_desligado: Suporte,
    pub adaptador: Option<Adaptador>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Adaptador {
    pub nome: String,
    pub mac: [u8; 6],
    pub tipo: TipoAdaptador,
    /// O driver está configurado para deixar este adaptador acordar a máquina.
    pub pode_acordar: Suporte,
    /// Endereço IPv4 e máscara, para calcular o broadcast da sub-rede.
    pub ipv4: Option<(Ipv4Addr, Ipv4Addr)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TipoAdaptador {
    Ethernet,
    WiFi,
    Desconhecido,
}

impl TipoAdaptador {
    fn como_texto(self) -> &'static str {
        match self {
            TipoAdaptador::Ethernet => "ethernet",
            TipoAdaptador::WiFi => "wifi",
            TipoAdaptador::Desconhecido => "desconhecido",
        }
    }
}

/// Escolhe o estado de Pronto para Retorno (ADR-0006 §4).
///
/// A ordem não é arbitrária: desligado consome menos que hibernado, então vem
/// primeiro **quando o retorno a partir dele estiver comprovado**.
/// `Desconhecido` não serve — apostar num retorno não testado é exatamente a
/// promessa que o ADR-0006 proíbe, e o custo do erro é uma máquina que não liga
/// mais pelo celular.
///
/// O espelho desta função em TypeScript é `escolherProntoParaRetorno` em
/// `packages/protocol/src/energia.ts`, e as duas precisam andar juntas.
pub fn escolher_pronto_para_retorno(
    acordar_pela_rede: Suporte,
    acordar_de_desligado: Suporte,
    acordar_de_hibernado: Suporte,
    hibernar: bool,
    desligar: bool,
) -> EstadoProntoParaRetorno {
    if acordar_pela_rede != Suporte::Sim {
        return EstadoProntoParaRetorno::Nenhum;
    }
    if acordar_de_desligado == Suporte::Sim && desligar {
        return EstadoProntoParaRetorno::Desligado;
    }
    if acordar_de_hibernado == Suporte::Sim && hibernar {
        return EstadoProntoParaRetorno::Hibernado;
    }
    EstadoProntoParaRetorno::Nenhum
}

/// O nível de compatibilidade desta máquina.
///
/// `tem_ponte` entra no cálculo porque COMPLETO afirma que a pessoa consegue
/// acordar de onde estiver, e isso é falso sem alguém na rede para emitir o
/// pacote — por melhor que seja o hardware. Uma máquina impecável numa casa com
/// um computador só é honestamente PADRÃO.
pub fn nivel_de_compatibilidade(
    estado: EstadoProntoParaRetorno,
    tem_ponte: bool,
) -> NivelEnergia {
    match estado {
        EstadoProntoParaRetorno::Nenhum => NivelEnergia::Limitado,
        EstadoProntoParaRetorno::Desligado if tem_ponte => NivelEnergia::Completo,
        _ => NivelEnergia::Padrao,
    }
}

/// Monta o perfil publicável a partir do que a detecção encontrou.
pub fn montar_perfil(
    detectadas: &CapacidadesDetectadas,
    tem_ponte: bool,
    testado_em: Option<i64>,
) -> PerfilEnergia {
    // Acordar pela rede exige as duas coisas: um adaptador que saiba, e a
    // permissão de driver para ele de fato acordar a máquina. Um dos dois
    // faltando torna a capacidade inútil, e anunciá-la seria prometer.
    let acordar_pela_rede = match detectadas.adaptador.as_ref() {
        None => Suporte::Nao,
        Some(adaptador) => adaptador.pode_acordar,
    };

    let mut impedimentos = Vec::new();
    if detectadas.adaptador.is_none() {
        impedimentos.push(Impedimento::AdaptadorNaoSuporta);
    } else if acordar_pela_rede == Suporte::Nao {
        impedimentos.push(Impedimento::AdaptadorSemPermissao);
    }
    if !detectadas.hibernar {
        impedimentos.push(Impedimento::HibernacaoDesligada);
    }
    if detectadas.acordar_de_desligado == Suporte::Desconhecido {
        // Não é defeito: é firmware, e nenhuma leitura responde isso. A pessoa
        // descobre com o autoteste, e até lá a interface diz "não testado".
        impedimentos.push(Impedimento::NaoTestado);
    }
    if !tem_ponte {
        impedimentos.push(Impedimento::SemPonteNaRede);
    }

    let pronto = escolher_pronto_para_retorno(
        acordar_pela_rede,
        detectadas.acordar_de_desligado,
        detectadas.acordar_de_hibernado,
        detectadas.hibernar,
        true,
    );

    PerfilEnergia {
        // Bloquear existe em todo Windows; é a única capacidade que pode ser
        // afirmada sem medir.
        bloquear: Suporte::Sim,
        suspender: Suporte::de_bool(detectadas.suspender),
        hibernar: Suporte::de_bool(detectadas.hibernar),
        reiniciar: Suporte::Sim,
        desligar: Suporte::Sim,
        cancelar_desligamento: Suporte::Sim,
        acordar_pela_rede,
        acordar_de_suspenso: detectadas.acordar_de_suspenso,
        acordar_de_hibernado: detectadas.acordar_de_hibernado,
        acordar_de_desligado: detectadas.acordar_de_desligado,
        pronto_para_retorno: pronto,
        nivel: nivel_de_compatibilidade(pronto, tem_ponte),
        adaptador: detectadas.adaptador.as_ref().map(|a| a.nome.clone()),
        tipo_de_adaptador: detectadas
            .adaptador
            .as_ref()
            .map(|a| a.tipo.como_texto().to_string()),
        impedimentos,
        testado_em,
    }
}

// ---------------------------------------------------------------------------
// Pacote mágico
// ---------------------------------------------------------------------------

/// O pacote mágico do Wake-on-LAN: seis bytes `0xFF` seguidos do endereço
/// físico repetido dezesseis vezes. 102 bytes, sempre.
///
/// É deliberadamente uma função pura sobre bytes, sem rede: assim o formato —
/// que é a parte fácil de errar e impossível de depurar depois, porque o alvo
/// simplesmente não acorda e não diz por quê — pode ser conferido byte a byte
/// num teste que roda em qualquer sistema.
pub fn montar_pacote_magico(mac: &[u8; 6]) -> [u8; 102] {
    let mut pacote = [0xFFu8; 102];
    for repeticao in 0..16 {
        let inicio = 6 + repeticao * 6;
        pacote[inicio..inicio + 6].copy_from_slice(mac);
    }
    pacote
}

/// Lê um endereço físico em qualquer das formas usuais.
///
/// Aceita `AA:BB:CC:DD:EE:FF`, `AA-BB-...` e a forma sem separador, porque o
/// valor chega da nuvem — escrito por outra versão do Agente, possivelmente
/// mais antiga — e recusar por causa de um hífen deixaria a máquina sem acordar
/// por motivo nenhum.
pub fn ler_mac(texto: &str) -> Result<[u8; 6], &'static str> {
    let limpo: String = texto
        .chars()
        .filter(|c| !matches!(c, ':' | '-' | '.' | ' '))
        .collect();
    if limpo.len() != 12 {
        return Err("endereço físico com tamanho inválido");
    }
    let mut mac = [0u8; 6];
    for (indice, destino) in mac.iter_mut().enumerate() {
        let par = &limpo[indice * 2..indice * 2 + 2];
        *destino = u8::from_str_radix(par, 16).map_err(|_| "endereço físico inválido")?;
    }
    // Um endereço todo zero é o que sai de uma leitura falhada; emitir um
    // pacote para ele não acorda nada e esconde o defeito de origem.
    if mac == [0u8; 6] {
        return Err("endereço físico vazio");
    }
    Ok(mac)
}

/// Para onde emitir o pacote.
///
/// O broadcast da sub-rede vem primeiro porque é o que atravessa switches
/// gerenciados e pontos de acesso que descartam `255.255.255.255`. O limitado
/// vai junto como rede de segurança — os dois são baratos, e qual dos dois
/// funciona depende de equipamento que não temos como inspecionar daqui.
///
/// As portas 9 e 7 são as duas usadas na prática por firmware de placa de rede.
/// Emitir nas duas custa quatro datagramas e evita a classe de falha mais
/// irritante possível: a que não dá erro nenhum.
pub fn destinos_do_pacote(ipv4: Option<(Ipv4Addr, Ipv4Addr)>) -> Vec<SocketAddr> {
    let mut enderecos = Vec::new();
    if let Some((ip, mascara)) = ipv4 {
        let broadcast = broadcast_da_sub_rede(ip, mascara);
        enderecos.push(broadcast);
    }
    enderecos.push(Ipv4Addr::BROADCAST);

    enderecos
        .into_iter()
        .flat_map(|endereco| {
            [9u16, 7u16]
                .into_iter()
                .map(move |porta| SocketAddr::new(IpAddr::V4(endereco), porta))
        })
        .collect()
}

pub fn broadcast_da_sub_rede(ip: Ipv4Addr, mascara: Ipv4Addr) -> Ipv4Addr {
    let ip = u32::from(ip);
    let mascara = u32::from(mascara);
    Ipv4Addr::from(ip | !mascara)
}

/// Emite o pacote mágico.
///
/// Devolve quantos destinos aceitaram o datagrama. **Zero é falha; qualquer
/// número maior não é sucesso** — é só a confirmação de que o quadro saiu desta
/// placa de rede. Se o alvo acordou, quem diz é a reconexão do Agente dele,
/// minutos depois (ADR-0006). A máquina de estados existe justamente para essa
/// distinção não se perder.
pub fn emitir_pacote(mac: &[u8; 6], destinos: &[SocketAddr]) -> Result<usize, &'static str> {
    let pacote = montar_pacote_magico(mac);
    // Porta de origem 0: o sistema escolhe. Emitir de uma porta fixa daria
    // conflito com um segundo Agente na mesma máquina.
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .map_err(|_| "não foi possível abrir o socket de rede")?;
    socket
        .set_broadcast(true)
        .map_err(|_| "a rede não permite envio em broadcast")?;

    let aceitos = destinos
        .iter()
        .filter(|destino| socket.send_to(&pacote, destino).is_ok())
        .count();

    if aceitos == 0 {
        return Err("nenhum destino aceitou o pacote");
    }
    Ok(aceitos)
}

// ---------------------------------------------------------------------------
// Ações de energia (Windows)
// ---------------------------------------------------------------------------

/// As ações que mexem no estado de energia desta máquina.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcaoEnergia {
    Bloquear,
    Suspender,
    Hibernar,
    Reiniciar,
    Desligar,
    CancelarDesligamento,
}

impl AcaoEnergia {
    /// Se a ação pode custar trabalho não salvo.
    ///
    /// Bloquear e cancelar não; o resto sim. É a lista que a interface usa para
    /// decidir o que exige confirmação deliberada.
    pub fn e_destrutiva(self) -> bool {
        !matches!(self, AcaoEnergia::Bloquear | AcaoEnergia::CancelarDesligamento)
    }

    /// Se o perfil desta máquina permite executá-la.
    ///
    /// Recusar aqui, com motivo, é melhor que tentar e falhar: hibernar numa
    /// máquina com a hibernação desligada devolve um erro do Windows que não
    /// diz nada a quem está com o celular na mão.
    pub fn suportada_por(self, perfil: &PerfilEnergia) -> bool {
        let suporte = match self {
            AcaoEnergia::Bloquear => perfil.bloquear,
            AcaoEnergia::Suspender => perfil.suspender,
            AcaoEnergia::Hibernar => perfil.hibernar,
            AcaoEnergia::Reiniciar => perfil.reiniciar,
            AcaoEnergia::Desligar => perfil.desligar,
            AcaoEnergia::CancelarDesligamento => perfil.cancelar_desligamento,
        };
        suporte == Suporte::Sim
    }
}

/// Executa a ação de energia.
///
/// **Nada aqui força o fechamento de programas.** Um documento não salvo vale
/// mais que a garantia de que o comando funcionou: se algo segurar o
/// desligamento, o certo é o desligamento não acontecer e a pessoa descobrir
/// por quê, não perder o trabalho (ADR-0006 §6).
pub fn executar(acao: AcaoEnergia, perfil: &PerfilEnergia) -> Result<(), &'static str> {
    if !acao.suportada_por(perfil) {
        return Err("este computador não sabe fazer isso");
    }

    #[cfg(windows)]
    {
        match acao {
            AcaoEnergia::Bloquear => bloquear_windows(),
            AcaoEnergia::Suspender => suspender_windows(false),
            AcaoEnergia::Hibernar => suspender_windows(true),
            AcaoEnergia::Reiniciar => desligar_windows(true),
            AcaoEnergia::Desligar => desligar_windows(false),
            AcaoEnergia::CancelarDesligamento => cancelar_desligamento_windows(),
        }
    }

    #[cfg(not(windows))]
    {
        let _ = acao;
        Err("ação disponível apenas no Windows")
    }
}

#[cfg(windows)]
fn bloquear_windows() -> Result<(), &'static str> {
    use windows::Win32::System::Shutdown::LockWorkStation;
    // Não exige privilégio: bloquear a própria estação é direito do usuário.
    unsafe { LockWorkStation() }.map_err(|_| "não foi possível bloquear a tela")
}

/// Suspende ou hiberna.
///
/// `SetSuspendState` com `bForce = FALSE` deixa os programas vetarem a
/// transição — é a mesma escolha do resto do módulo: quem tem trabalho aberto
/// ganha da conveniência de o comando ter funcionado.
#[cfg(windows)]
fn suspender_windows(hibernar: bool) -> Result<(), &'static str> {
    use windows::Win32::Foundation::BOOLEAN;
    use windows::Win32::System::Power::SetSuspendState;
    // `SetSuspendState` usa `BOOLEAN` (um byte), e não o `BOOL` de quatro bytes
    // do resto da API do Windows. Trocar um pelo outro compila em algumas
    // posições e passa o valor errado.
    let resultado = unsafe {
        SetSuspendState(
            BOOLEAN::from(hibernar),
            // `bForce = FALSE`: os programas podem vetar a transição. Mesma
            // escolha do resto do módulo — trabalho aberto ganha da
            // conveniência de o comando ter funcionado.
            BOOLEAN::from(false),
            BOOLEAN::from(false),
        )
    };
    if resultado == false {
        return Err(if hibernar {
            "não foi possível hibernar este computador"
        } else {
            "não foi possível suspender este computador"
        });
    }
    Ok(())
}

/// Desliga ou reinicia, com uma contagem curta.
///
/// A contagem existe por dois motivos concretos: dá à pessoa na frente da
/// máquina a chance de cancelar um comando disparado por engano do celular, e é
/// o que torna `sistema.cancelar-desligamento` uma ação com sentido — sem
/// janela, não há o que cancelar.
#[cfg(windows)]
fn desligar_windows(reiniciar: bool) -> Result<(), &'static str> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Shutdown::{
        InitiateSystemShutdownExW, SHTDN_REASON_FLAG_PLANNED,
        SHTDN_REASON_MAJOR_APPLICATION, SHTDN_REASON_MINOR_OTHER,
    };

    obter_privilegio_de_desligamento()?;

    const SEGUNDOS_DE_CONTAGEM: u32 = 15;
    let resultado = unsafe {
        InitiateSystemShutdownExW(
            PCWSTR::null(),
            PCWSTR::null(),
            SEGUNDOS_DE_CONTAGEM,
            // `bForceAppsClosed = FALSE`: um programa com trabalho não salvo
            // segura o desligamento em vez de perdê-lo.
            false,
            reiniciar,
            SHTDN_REASON_MAJOR_APPLICATION
                | SHTDN_REASON_MINOR_OTHER
                | SHTDN_REASON_FLAG_PLANNED,
        )
    };
    resultado.map_err(|_| {
        if reiniciar {
            "não foi possível reiniciar este computador"
        } else {
            "não foi possível desligar este computador"
        }
    })
}

#[cfg(windows)]
fn cancelar_desligamento_windows() -> Result<(), &'static str> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Shutdown::AbortSystemShutdownW;

    obter_privilegio_de_desligamento()?;
    unsafe { AbortSystemShutdownW(PCWSTR::null()) }
        .map_err(|_| "não havia desligamento em andamento para cancelar")
}

/// Habilita `SeShutdownPrivilege` no processo.
///
/// O privilégio existe no token de qualquer usuário interativo do Windows, mas
/// nasce **desabilitado**: sem esta chamada, desligar falha com acesso negado
/// mesmo num administrador. É a pegadinha clássica desta API, e o sintoma é um
/// erro genérico que não menciona privilégio nenhum.
///
/// Habilitar não amplia poder: só liga algo que a conta já tem.
#[cfg(windows)]
fn obter_privilegio_de_desligamento() -> Result<(), &'static str> {
    use windows::core::w;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, LUID};
    use windows::Win32::Security::{
        AdjustTokenPrivileges, LookupPrivilegeValueW, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED,
        TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
            &mut token,
        )
        .map_err(|_| "não foi possível verificar as permissões deste computador")?;

        let mut luid = LUID::default();
        let encontrou = LookupPrivilegeValueW(None, w!("SeShutdownPrivilege"), &mut luid);

        let resultado = if encontrou.is_ok() {
            let privilegios = TOKEN_PRIVILEGES {
                PrivilegeCount: 1,
                Privileges: [LUID_AND_ATTRIBUTES {
                    Luid: luid,
                    Attributes: SE_PRIVILEGE_ENABLED,
                }],
            };
            AdjustTokenPrivileges(token, false, Some(&privilegios), 0, None, None)
        } else {
            Err(windows::core::Error::empty())
        };

        let _ = CloseHandle(token);
        resultado.map_err(|_| "este computador não autoriza desligar por aqui")?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Detecção de capacidades (Windows)
// ---------------------------------------------------------------------------

/// Descobre o que esta máquina sabe fazer.
///
/// Fora do Windows devolve tudo negativo com o retorno de rede desconhecido —
/// não é um caso real de produto, mas mantém o módulo compilando e testável no
/// CI do Ubuntu, que é onde a parte pura é exercitada.
pub fn detectar() -> CapacidadesDetectadas {
    #[cfg(windows)]
    {
        detectar_windows()
    }

    #[cfg(not(windows))]
    {
        CapacidadesDetectadas {
            suspender: false,
            hibernar: false,
            acordar_de_suspenso: Suporte::Desconhecido,
            acordar_de_hibernado: Suporte::Desconhecido,
            acordar_de_desligado: Suporte::Desconhecido,
            adaptador: None,
        }
    }
}

#[cfg(windows)]
fn detectar_windows() -> CapacidadesDetectadas {
    use windows::Win32::System::Power::{GetPwrCapabilities, SYSTEM_POWER_CAPABILITIES};

    let mut capacidades = SYSTEM_POWER_CAPABILITIES::default();
    let leu = unsafe { GetPwrCapabilities(&mut capacidades) } == true;

    // Sem leitura confiável, tudo vira desconhecido em vez de virar `false`:
    // "não suporta" é uma afirmação, e não temos base para fazê-la.
    let suspender = leu && capacidades.SystemS3.as_bool();
    let hibernar = leu && capacidades.SystemS4.as_bool() && capacidades.HiberFilePresent.as_bool();

    let adaptador = adaptador_ativo();

    // `AcWakeSupported`/`SystemS1..S4` dizem que a máquina *pode* ser acordada
    // daquele estado; quem de fato acorda é o adaptador com permissão. As duas
    // condições juntas é o que autoriza dizer "sim".
    let acordar_permitido = adaptador
        .as_ref()
        .map(|a| a.pode_acordar)
        .unwrap_or(Suporte::Nao);

    let acordar_de_suspenso = if !leu {
        Suporte::Desconhecido
    } else if suspender && acordar_permitido == Suporte::Sim {
        Suporte::Sim
    } else {
        Suporte::Nao
    };

    let acordar_de_hibernado = if !leu {
        Suporte::Desconhecido
    } else if hibernar && acordar_permitido == Suporte::Sim {
        Suporte::Sim
    } else {
        Suporte::Nao
    };

    CapacidadesDetectadas {
        suspender,
        hibernar,
        acordar_de_suspenso,
        acordar_de_hibernado,
        // Depende de firmware, e nenhuma API do Windows responde. Só o
        // autoteste real, com a máquina desligando e voltando, decide isto —
        // ver o critério `acordar-real` de P3-M5-T7 no plano.
        acordar_de_desligado: Suporte::Desconhecido,
        adaptador,
    }
}

/// O adaptador de rede que está de fato carregando o tráfego.
///
/// Escolhe o primeiro adaptador ativo, com endereço físico de seis bytes e IPv4
/// atribuído, ignorando loopback e túneis. Ethernet ganha de Wi-Fi no
/// desempate: acordar pela rede sem fio depende de suporte que boa parte das
/// placas não tem, e escolher a Ethernet quando ela existe é escolher o caminho
/// que funciona.
#[cfg(windows)]
fn adaptador_ativo() -> Option<Adaptador> {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER,
        GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows::Win32::Networking::WinSock::{AF_INET, AF_UNSPEC, SOCKADDR_IN};

    const IF_TYPE_ETHERNET: u32 = 6;
    const IF_TYPE_WIFI: u32 = 71;
    const IF_TYPE_LOOPBACK: u32 = 24;

    unsafe {
        let mut tamanho: u32 = 0;
        let sinalizadores =
            GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;

        // Primeira chamada só para descobrir o tamanho. O buffer cresce com a
        // quantidade de adaptadores, e chutar um tamanho fixo é como esta API
        // costuma ser usada errado.
        GetAdaptersAddresses(AF_UNSPEC.0 as u32, sinalizadores, None, None, &mut tamanho);
        if tamanho == 0 {
            return None;
        }

        let mut buffer = vec![0u8; tamanho as usize];
        let inicio = buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH;
        let resultado = GetAdaptersAddresses(
            AF_UNSPEC.0 as u32,
            sinalizadores,
            None,
            Some(inicio),
            &mut tamanho,
        );
        if resultado != 0 {
            return None;
        }

        let mut melhor: Option<Adaptador> = None;
        let mut atual = inicio;
        while !atual.is_null() {
            let adaptador = &*atual;
            atual = adaptador.Next;

            if adaptador.IfType == IF_TYPE_LOOPBACK
                || adaptador.OperStatus != IfOperStatusUp
                || adaptador.PhysicalAddressLength != 6
            {
                continue;
            }

            let mut mac = [0u8; 6];
            mac.copy_from_slice(&adaptador.PhysicalAddress[..6]);
            if mac == [0u8; 6] {
                continue;
            }

            // O IPv4 atribuído dá o broadcast da sub-rede, que é o destino que
            // atravessa equipamento que descarta `255.255.255.255`.
            let mut ipv4 = None;
            let mut endereco = adaptador.FirstUnicastAddress;
            while !endereco.is_null() {
                let unicast = &*endereco;
                let sockaddr = unicast.Address.lpSockaddr;
                if !sockaddr.is_null() && (*sockaddr).sa_family == AF_INET {
                    let inet = &*(sockaddr as *const SOCKADDR_IN);
                    let octetos = inet.sin_addr.S_un.S_addr.to_ne_bytes();
                    let ip = Ipv4Addr::from(octetos);
                    let mascara = mascara_de_prefixo(unicast.OnLinkPrefixLength);
                    if !ip.is_loopback() && !ip.is_unspecified() {
                        ipv4 = Some((ip, mascara));
                        break;
                    }
                }
                endereco = unicast.Next;
            }
            if ipv4.is_none() {
                continue;
            }

            let tipo = match adaptador.IfType {
                IF_TYPE_ETHERNET => TipoAdaptador::Ethernet,
                IF_TYPE_WIFI => TipoAdaptador::WiFi,
                _ => TipoAdaptador::Desconhecido,
            };

            let nome = if adaptador.Description.is_null() {
                String::from("Adaptador de rede")
            } else {
                adaptador.Description.to_string().unwrap_or_default()
            };

            let candidato = Adaptador {
                nome,
                mac,
                tipo,
                // A permissão de acordar mora na configuração do driver, e não
                // é exposta por esta API. `Desconhecido` é a resposta honesta:
                // quem decide é o autoteste ou a leitura em `powercfg`.
                pode_acordar: Suporte::Desconhecido,
                ipv4,
            };

            let melhor_e_ethernet = melhor
                .as_ref()
                .is_some_and(|m| m.tipo == TipoAdaptador::Ethernet);
            if melhor.is_none() || (tipo == TipoAdaptador::Ethernet && !melhor_e_ethernet) {
                melhor = Some(candidato);
            }
        }
        melhor
    }
}

#[cfg(windows)]
fn mascara_de_prefixo(prefixo: u8) -> Ipv4Addr {
    // Prefixo 0 significaria máscara zero e broadcast 255.255.255.255, que é o
    // destino limitado que já vai na lista. /24 é o padrão doméstico e o chute
    // menos danoso quando o valor não vem.
    if prefixo == 0 || prefixo > 32 {
        return Ipv4Addr::new(255, 255, 255, 0);
    }
    Ipv4Addr::from((!0u32).checked_shl(32 - prefixo as u32).unwrap_or(0))
}

#[cfg(test)]
mod testes {
    use super::*;

    fn detectadas(over: impl FnOnce(&mut CapacidadesDetectadas)) -> CapacidadesDetectadas {
        let mut base = CapacidadesDetectadas {
            suspender: true,
            hibernar: true,
            acordar_de_suspenso: Suporte::Sim,
            acordar_de_hibernado: Suporte::Sim,
            acordar_de_desligado: Suporte::Desconhecido,
            adaptador: Some(Adaptador {
                nome: "Placa de rede".into(),
                mac: [0x00, 0x11, 0x22, 0x33, 0x44, 0x55],
                tipo: TipoAdaptador::Ethernet,
                pode_acordar: Suporte::Sim,
                ipv4: Some((Ipv4Addr::new(192, 168, 1, 40), Ipv4Addr::new(255, 255, 255, 0))),
            }),
        };
        over(&mut base);
        base
    }

    #[test]
    fn o_pacote_magico_tem_o_formato_da_especificacao() {
        // O formato é a parte impossível de depurar depois: um pacote errado
        // não dá erro, o alvo apenas não acorda. Conferido byte a byte.
        let mac = [0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01];
        let pacote = montar_pacote_magico(&mac);

        assert_eq!(pacote.len(), 102);
        assert_eq!(&pacote[..6], &[0xFF; 6], "faltou o cabeçalho de sincronismo");
        for repeticao in 0..16 {
            let inicio = 6 + repeticao * 6;
            assert_eq!(
                &pacote[inicio..inicio + 6],
                &mac,
                "repetição {repeticao} do endereço saiu errada"
            );
        }
    }

    #[test]
    fn le_o_endereco_fisico_nas_formas_usuais() {
        let esperado = [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF];
        assert_eq!(ler_mac("AA:BB:CC:DD:EE:FF").unwrap(), esperado);
        assert_eq!(ler_mac("aa-bb-cc-dd-ee-ff").unwrap(), esperado);
        assert_eq!(ler_mac("AABBCCDDEEFF").unwrap(), esperado);
    }

    #[test]
    fn recusa_endereco_fisico_invalido_ou_vazio() {
        // O endereço todo zero é o que sai de uma leitura falhada. Emitir para
        // ele não acorda nada e esconde o defeito de origem.
        assert!(ler_mac("00:00:00:00:00:00").is_err());
        assert!(ler_mac("AA:BB:CC").is_err());
        assert!(ler_mac("ZZ:BB:CC:DD:EE:FF").is_err());
        assert!(ler_mac("").is_err());
    }

    #[test]
    fn o_broadcast_da_sub_rede_sai_certo() {
        assert_eq!(
            broadcast_da_sub_rede(Ipv4Addr::new(192, 168, 1, 40), Ipv4Addr::new(255, 255, 255, 0)),
            Ipv4Addr::new(192, 168, 1, 255)
        );
        assert_eq!(
            broadcast_da_sub_rede(Ipv4Addr::new(10, 0, 5, 7), Ipv4Addr::new(255, 255, 0, 0)),
            Ipv4Addr::new(10, 0, 255, 255)
        );
    }

    #[test]
    fn emite_no_broadcast_da_sub_rede_e_no_limitado() {
        // O da sub-rede atravessa equipamento que descarta o limitado, e o
        // limitado cobre quem não tem IPv4 legível. Os dois, nas duas portas.
        let destinos = destinos_do_pacote(Some((
            Ipv4Addr::new(192, 168, 1, 40),
            Ipv4Addr::new(255, 255, 255, 0),
        )));
        let texto: Vec<String> = destinos.iter().map(|d| d.to_string()).collect();
        assert!(texto.contains(&"192.168.1.255:9".to_string()));
        assert!(texto.contains(&"192.168.1.255:7".to_string()));
        assert!(texto.contains(&"255.255.255.255:9".to_string()));
        assert!(texto.contains(&"255.255.255.255:7".to_string()));

        // Sem IPv4 conhecido ainda sobra o limitado, em vez de lista vazia.
        assert_eq!(destinos_do_pacote(None).len(), 2);
    }

    #[test]
    fn pronto_para_retorno_prefere_desligado_quando_o_retorno_foi_comprovado() {
        let perfil = montar_perfil(
            &detectadas(|d| d.acordar_de_desligado = Suporte::Sim),
            true,
            Some(1_000),
        );
        assert_eq!(perfil.pronto_para_retorno, EstadoProntoParaRetorno::Desligado);
        assert_eq!(perfil.nivel, NivelEnergia::Completo);
    }

    #[test]
    fn nunca_aposta_num_retorno_apenas_desconhecido() {
        // O teste que sustenta a promessa do ADR-0006. Trocar a comparação por
        // "diferente de não" para "aproveitar melhor o hardware" produz uma
        // máquina desligada que não liga mais pelo celular.
        let perfil = montar_perfil(
            &detectadas(|d| {
                d.acordar_de_desligado = Suporte::Desconhecido;
                d.acordar_de_hibernado = Suporte::Desconhecido;
            }),
            true,
            None,
        );
        assert_eq!(perfil.pronto_para_retorno, EstadoProntoParaRetorno::Nenhum);
        assert_eq!(perfil.nivel, NivelEnergia::Limitado);
    }

    #[test]
    fn hardware_impecavel_sem_ponte_nao_e_completo() {
        // A casa com um computador só. Nada está com defeito e mesmo assim
        // ninguém acorda a máquina do 4G, porque não há quem emita o pacote.
        let perfil = montar_perfil(
            &detectadas(|d| d.acordar_de_desligado = Suporte::Sim),
            false,
            Some(1_000),
        );
        assert_eq!(perfil.nivel, NivelEnergia::Padrao);
        assert!(perfil.impedimentos.contains(&Impedimento::SemPonteNaRede));
    }

    #[test]
    fn adaptador_sem_permissao_nao_vira_acordar_pela_rede() {
        let perfil = montar_perfil(
            &detectadas(|d| {
                d.adaptador.as_mut().unwrap().pode_acordar = Suporte::Nao;
            }),
            true,
            None,
        );
        assert_eq!(perfil.acordar_pela_rede, Suporte::Nao);
        assert_eq!(perfil.pronto_para_retorno, EstadoProntoParaRetorno::Nenhum);
        assert!(perfil
            .impedimentos
            .contains(&Impedimento::AdaptadorSemPermissao));
    }

    #[test]
    fn o_perfil_publicavel_nao_carrega_endereco_fisico() {
        // Mesma regra de `AtalhoDeDeck` não carregar caminho: o endereço vai da
        // nuvem direto para a ponte e nunca passa pelo celular (ADR-0006 §3).
        // Se alguém acrescentar o campo, este teste cai — e é para cair.
        let perfil = montar_perfil(&detectadas(|_| {}), true, None);
        let json = serde_json::to_string(&perfil).unwrap();
        assert!(!json.contains("mac"), "endereço físico vazou no perfil: {json}");
        assert!(!json.contains("0011"), "endereço físico vazou no perfil: {json}");
        assert!(!json.to_lowercase().contains("11:22"));
    }

    #[test]
    fn hibernacao_desligada_aparece_como_impedimento() {
        let perfil = montar_perfil(&detectadas(|d| d.hibernar = false), true, None);
        assert_eq!(perfil.hibernar, Suporte::Nao);
        assert!(perfil
            .impedimentos
            .contains(&Impedimento::HibernacaoDesligada));
    }

    #[test]
    fn acao_sem_suporte_e_recusada_antes_de_tentar() {
        // Hibernar numa máquina com hibernação desligada devolveria um erro do
        // Windows que não diz nada a quem está com o celular na mão.
        let perfil = montar_perfil(&detectadas(|d| d.hibernar = false), true, None);
        assert!(!AcaoEnergia::Hibernar.suportada_por(&perfil));
        assert_eq!(
            executar(AcaoEnergia::Hibernar, &perfil),
            Err("este computador não sabe fazer isso")
        );
    }

    #[test]
    fn bloquear_e_cancelar_nao_sao_destrutivas_e_o_resto_e() {
        assert!(!AcaoEnergia::Bloquear.e_destrutiva());
        assert!(!AcaoEnergia::CancelarDesligamento.e_destrutiva());
        for acao in [
            AcaoEnergia::Suspender,
            AcaoEnergia::Hibernar,
            AcaoEnergia::Reiniciar,
            AcaoEnergia::Desligar,
        ] {
            assert!(acao.e_destrutiva(), "{acao:?} deveria pedir confirmação");
        }
    }
}
