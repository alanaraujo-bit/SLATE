import type { GateStatus, WorkKind, WorkStatus } from "./schema";

/**
 * O plano de trabalho do SLATE.
 *
 * Este é o plano de referência (mandato §21, §54). Ele é carregado no Postgres
 * e, a partir daí, alterado pela CLI conforme o trabalho avança — este arquivo
 * é a decomposição *inicial*, não um espelho do estado atual. Recarregar é
 * aditivo e nunca sobrescreve um status que a CLI já avançou.
 *
 * Os pesos expressam tamanho relativo de engenharia entre irmãos, não duração.
 *
 * As chaves (P0-M1-T1) são identificadores estáveis usados pela CLI: não devem
 * ser traduzidas nem renumeradas.
 */

export interface SeedGate {
  key: string;
  title: string;
  status?: GateStatus;
  weight?: number;
  evidence?: string;
}

export interface SeedItem {
  key: string;
  kind: WorkKind;
  title: string;
  description?: string;
  status?: WorkStatus;
  weight?: number;
  gates?: SeedGate[];
  children?: SeedItem[];
  /** Chaves de itens que precisam ser concluídos antes. */
  dependsOn?: string[];
}

const g = (key: string, title: string, status: GateStatus = "PENDING"): SeedGate => ({
  key,
  title,
  status,
});

export const PROJECT = {
  slug: "slate",
  name: "SLATE",
  description:
    "Transforma qualquer celular ou tablet numa superfície de controle inteligente e contextual para o computador.",
  version: "0.1.0",
};

export const ROADMAP: SeedItem[] = [
  {
    key: "P0",
    kind: "PHASE",
    title: "Fundação e Inteligência do Projeto",
    description:
      "Entender o produto, fechar a arquitetura, montar a infraestrutura na nuvem e construir o instrumento que acompanha todo o resto.",
    weight: 1,
    children: [
      {
        key: "P0-M1",
        kind: "MILESTONE",
        title: "Inteligência do projeto e arquitetura",
        description:
          "Pesquisar as restrições reais — limitações de navegador acima de tudo — e registrar as decisões que elas obrigam.",
        weight: 2,
        children: [
          {
            key: "P0-M1-T1",
            kind: "TASK",
            title: "Validar a viabilidade do transporte contra as restrições dos navegadores",
            description:
              "Determinar se uma PWA em HTTPS consegue alcançar o agente no desktop. Estabelece as restrições de conteúdo misto, certificado e acesso à rede local.",
            gates: [
              g("research", "Comportamento atual dos navegadores pesquisado", "PASSED"),
              g("adr", "Decisão registrada como ADR", "PASSED"),
            ],
          },
          {
            key: "P0-M1-T2",
            kind: "TASK",
            title: "Definir a arquitetura do sistema e o formato do repositório",
            gates: [g("adr", "ADR-0001 escrito", "PASSED")],
          },
          {
            key: "P0-M1-T3",
            kind: "TASK",
            title: "Verificar a cadeia de ferramentas Rust/MSVC para o Tauri",
            description:
              "Confirmar que o linker resolve antes de comprometer o Agente Desktop com o Tauri.",
            gates: [g("build", "Binário Rust mínimo compila e linka", "PASSED")],
          },
          {
            key: "P0-M1-T4",
            kind: "TASK",
            title: "Especificar o modelo de segurança",
            description:
              "Identidade criptográfica do dispositivo, handshake de pareamento, escopos de permissão, validade e revogação de token.",
            gates: [
              g("adr", "ADR-0004 escrito"),
              g("review", "Modelo de ameaças revisado"),
            ],
          },
          {
            key: "P0-M1-T5",
            kind: "TASK",
            title: "Especificar o protocolo e sua estratégia de versionamento",
            description:
              "Contratos de mensagem independentes de transporte, negociação de capacidades e comportamento em caso de versões incompatíveis (§38).",
            gates: [
              g("adr", "ADR-0003 escrito"),
              g("schema", "Schemas definidos em código"),
            ],
          },
        ],
      },
      {
        key: "P0-M2",
        kind: "MILESTONE",
        title: "Repositório e infraestrutura na nuvem",
        description:
          "Monorepo, GitHub como fonte da verdade, Postgres no Railway em dois ambientes.",
        weight: 1,
        children: [
          {
            key: "P0-M2-T1",
            kind: "TASK",
            title: "Inicializar o monorepo e publicar no GitHub",
            gates: [g("push", "Branch main estabelecida no origin", "PASSED")],
          },
          {
            key: "P0-M2-T2",
            kind: "TASK",
            title: "Provisionar o Postgres para homologação e produção",
            gates: [
              g("provisioned", "Os dois ambientes no ar", "PASSED"),
              g("migrated", "Schema aplicado nos dois", "PASSED"),
            ],
          },
          {
            key: "P0-M2-T3",
            kind: "TASK",
            title: "Escrever a esteira de integração contínua",
            description:
              "Checagem de tipos, lint, testes unitários e ponta a ponta. A ativação depende da AÇÃO-001.",
            status: "OPERATOR_REQUIRED",
            gates: [
              g("authored", "Definições de workflow escritas"),
              g("active", "Esteira rodando a cada push"),
            ],
          },
        ],
      },
      {
        key: "P0-M3",
        kind: "MILESTONE",
        title: "Centro de Controle de Desenvolvimento",
        description:
          "Aplicação real mostrando progresso calculado, execução atual, atividade, critérios de qualidade, impedimentos e ações do operador — atualizando sem precisar recarregar a página.",
        weight: 3,
        children: [
          {
            key: "P0-M3-T1",
            kind: "TASK",
            title: "Modelo de dados do plano e motor de progresso",
            description:
              "Árvore recursiva de itens de trabalho, critérios de qualidade e progresso calculado que não pode ser inflado.",
            gates: [
              g("schema", "Schema migrado para a nuvem", "PASSED"),
              g("tests", "Regras de progresso cobertas por testes", "PASSED"),
            ],
          },
          {
            key: "P0-M3-T2",
            kind: "TASK",
            title: "Caminho de escrita via CLI",
            description:
              "Alteração de estado por comando, para que a execução atualize o plano sem ninguém editar a página (§24).",
            gates: [
              g("cli", "Comandos implementados"),
              g("tests", "Coberto por testes"),
            ],
          },
          {
            key: "P0-M3-T3",
            kind: "TASK",
            title: "Interface do Centro de Controle",
            description:
              "Fases, marcos, detalhamento em profundidade, execução atual, log de atividade, critérios e ações do operador. Interface inteiramente em português.",
            gates: [
              g("responsive", "Layouts para celular e desktop"),
              g("states", "Estados de carregamento, vazio e erro"),
              g("a11y", "Acessível"),
              g("i18n", "Interface em português"),
            ],
          },
          {
            key: "P0-M3-T4",
            kind: "TASK",
            title: "Atualização em tempo real",
            description:
              "Server-sent events com reconexão que nunca aparenta uma página quebrada.",
            gates: [
              g("sse", "Fluxo entrega atualizações"),
              g("reconnect", "Sobrevive à reconexão sem alarme falso"),
            ],
          },
          {
            key: "P0-M3-T5",
            kind: "TASK",
            title: "Rodar e validar de ponta a ponta",
            description:
              "Por decisão do operador (D-007) esta aplicação roda localmente contra o banco na nuvem, em vez de ser hospedada.",
            gates: [
              g("running", "Aplicação acessível e saudável"),
              g("e2e", "Testes ponta a ponta passando"),
            ],
          },
        ],
      },
    ],
  },
  {
    key: "P1",
    kind: "PHASE",
    title: "Plataforma Central",
    description:
      "As partes sobre as quais todo o resto se apoia: linguagem visual, protocolo, identidade, pareamento e o transporte em si.",
    weight: 3,
    children: [
      {
        key: "P1-M1",
        kind: "MILESTONE",
        title: "Design System",
        description:
          "Tokens e primitivas de tipografia, espaçamento, raios, elevação, movimento, cor semântica e estados interativos (§47).",
        weight: 2,
        children: [
          { key: "P1-M1-T1", kind: "TASK", title: "Conjunto de tokens e estratégia de tema" },
          { key: "P1-M1-T2", kind: "TASK", title: "Primitivas centrais e estados interativos" },
          { key: "P1-M1-T3", kind: "TASK", title: "Vocabulário de movimento e microinterações" },
          { key: "P1-M1-T4", kind: "TASK", title: "Iconografia" },
        ],
      },
      {
        key: "P1-M2",
        kind: "MILESTONE",
        title: "Pacote de protocolo",
        description:
          "Contratos de mensagem versionados e independentes de transporte, compartilhados por PWA, Agente e serviços.",
        weight: 2,
        dependsOn: ["P0-M1-T5"],
        children: [
          { key: "P1-M2-T1", kind: "TASK", title: "Schemas de mensagem e validação" },
          {
            key: "P1-M2-T2",
            kind: "TASK",
            title: "Negociação de capacidades e versões incompatíveis",
          },
          { key: "P1-M2-T3", kind: "TASK", title: "Testes de contrato" },
        ],
      },
      {
        key: "P1-M3",
        kind: "MILESTONE",
        title: "Contas e autenticação",
        weight: 2,
        children: [
          { key: "P1-M3-T1", kind: "TASK", title: "Integração com provedor de autenticação" },
          { key: "P1-M3-T2", kind: "TASK", title: "Modelo de conta e gestão de sessão" },
          {
            key: "P1-M3-T3",
            kind: "TASK",
            title: "Fluxos de entrada, cadastro e recuperação",
          },
        ],
      },
      {
        key: "P1-M4",
        kind: "MILESTONE",
        title: "Identidade do dispositivo e pareamento seguro",
        description:
          "Identidade criptográfica, handshake de pareamento, escopos de permissão e revogação (§13).",
        weight: 3,
        dependsOn: ["P1-M3", "P0-M1-T4"],
        children: [
          {
            key: "P1-M4-T1",
            kind: "TASK",
            title: "Geração e guarda do par de chaves do dispositivo",
          },
          { key: "P1-M4-T2", kind: "TASK", title: "Handshake de pareamento" },
          { key: "P1-M4-T3", kind: "TASK", title: "Emissão, rotação e revogação de token" },
          {
            key: "P1-M4-T4",
            kind: "TASK",
            title: "Testes de segurança: replay, dispositivo revogado, autenticação inválida",
          },
        ],
      },
      {
        key: "P1-M5",
        kind: "MILESTONE",
        title: "Transporte WebRTC",
        description:
          "Serviço de sinalização, ICE, DataChannel, fallback por retransmissão e reconexão.",
        weight: 4,
        dependsOn: ["P1-M4", "P1-M2"],
        children: [
          { key: "P1-M5-T1", kind: "TASK", title: "Serviço de sinalização" },
          { key: "P1-M5-T2", kind: "TASK", title: "Implementação do par no navegador" },
          { key: "P1-M5-T3", kind: "TASK", title: "Implementação do par no Agente (Rust)" },
          { key: "P1-M5-T4", kind: "TASK", title: "Fallback por retransmissão (TURN)" },
          {
            key: "P1-M5-T5",
            kind: "TASK",
            title: "Reconexão e máquina de estados da conexão",
          },
          {
            key: "P1-M5-T6",
            kind: "TASK",
            title:
              "Testes de protocolo: timeout, duplicidade, estado obsoleto, versão incompatível",
          },
        ],
      },
    ],
  },
  {
    key: "P2",
    kind: "PHASE",
    title: "Superfície de Controle",
    description: "A PWA em si — runtime, componentes, editor e sincronização.",
    weight: 3,
    dependsOn: ["P1"],
    children: [
      {
        key: "P2-M1",
        kind: "MILESTONE",
        title: "Estrutura da PWA",
        description:
          "Manifest, service worker, casca offline, instalabilidade, áreas seguras e estados de conexão (§7, §37).",
        weight: 3,
        children: [
          { key: "P2-M1-T1", kind: "TASK", title: "Manifest, ícones e instalabilidade" },
          { key: "P2-M1-T2", kind: "TASK", title: "Service worker e casca offline" },
          { key: "P2-M1-T3", kind: "TASK", title: "Exibição dos estados de conexão" },
          { key: "P2-M1-T4", kind: "TASK", title: "Primeiro acesso e fluxo de pareamento" },
        ],
      },
      {
        key: "P2-M2",
        kind: "MILESTONE",
        title: "Biblioteca de componentes de controle",
        description:
          "Botão, Interruptor, Slider, Dial, Medidor, Status, Texto, Imagem, Mídia, Cronômetro, Contador, Pasta, Navegação, Gráfico e Grupo de Ações (§10).",
        weight: 4,
        children: [
          { key: "P2-M2-T1", kind: "TASK", title: "Contrato do controle e modelo de estado" },
          { key: "P2-M2-T2", kind: "TASK", title: "Controles de acionamento" },
          { key: "P2-M2-T3", kind: "TASK", title: "Controles contínuos" },
          { key: "P2-M2-T4", kind: "TASK", title: "Controles de exibição e estado" },
          { key: "P2-M2-T5", kind: "TASK", title: "Controles de navegação" },
        ],
      },
      {
        key: "P2-M3",
        kind: "MILESTONE",
        title: "Runtime dos painéis",
        description: "Motor de layout e comportamento responsivo em celular e tablet.",
        weight: 3,
        children: [
          { key: "P2-M3-T1", kind: "TASK", title: "Motor de grade e layout" },
          { key: "P2-M3-T2", kind: "TASK", title: "Pontos de quebra e orientação" },
          { key: "P2-M3-T3", kind: "TASK", title: "Navegação entre páginas e pastas" },
          { key: "P2-M3-T4", kind: "TASK", title: "Orçamento de desempenho de renderização" },
        ],
      },
      {
        key: "P2-M4",
        kind: "MILESTONE",
        title: "Editor de painéis",
        weight: 4,
        children: [
          {
            key: "P2-M4-T1",
            kind: "TASK",
            title: "Criar, duplicar e excluir painéis e páginas",
          },
          {
            key: "P2-M4-T2",
            kind: "TASK",
            title: "Posicionamento, reordenação e redimensionamento",
          },
          { key: "P2-M4-T3", kind: "TASK", title: "Configuração dos controles" },
          { key: "P2-M4-T4", kind: "TASK", title: "Vínculo com ações" },
        ],
      },
      {
        key: "P2-M5",
        kind: "MILESTONE",
        title: "Sincronização na nuvem",
        description:
          "Painéis, layouts, fluxos de trabalho, preferências e regras de contexto (§42).",
        weight: 2,
        children: [
          {
            key: "P2-M5-T1",
            kind: "TASK",
            title: "Modelo de sincronização e resolução de conflito",
          },
          { key: "P2-M5-T2", kind: "TASK", title: "API de sincronização e persistência" },
        ],
      },
    ],
  },
  {
    key: "P3",
    kind: "PHASE",
    title: "Agente Desktop",
    description: "Onde o SLATE de fato toca o Windows.",
    weight: 4,
    dependsOn: ["P1"],
    children: [
      {
        key: "P3-M1",
        kind: "MILESTONE",
        title: "Estrutura do Agente e distribuição",
        weight: 3,
        children: [
          { key: "P3-M1-T1", kind: "TASK", title: "Aplicação base em Tauri" },
          {
            key: "P3-M1-T2",
            kind: "TASK",
            title: "Interface do Agente: status, pareamento e permissões",
          },
          { key: "P3-M1-T3", kind: "TASK", title: "Instalador para Windows" },
          { key: "P3-M1-T4", kind: "TASK", title: "Início automático e atualização" },
          { key: "P3-M1-T5", kind: "TASK", title: "Logs e diagnóstico" },
        ],
      },
      {
        key: "P3-M2",
        kind: "MILESTONE",
        title: "Motor de Ações",
        description:
          "Executor extensível com sequências, condições, atrasos, novas tentativas, variáveis e retorno de resultado (§5).",
        weight: 4,
        children: [
          { key: "P3-M2-T1", kind: "TASK", title: "Contrato de ação e registro" },
          { key: "P3-M2-T2", kind: "TASK", title: "Pipeline de execução com retorno para a PWA" },
          {
            key: "P3-M2-T3",
            kind: "TASK",
            title: "Ações centrais: teclado, mídia, abrir e focar aplicativos",
          },
          { key: "P3-M2-T4", kind: "TASK", title: "Composição e persistência de fluxos" },
          { key: "P3-M2-T5", kind: "TASK", title: "Modelo de permissão para ações de risco" },
        ],
      },
      {
        key: "P3-M3",
        kind: "MILESTONE",
        title: "Motor de Contexto",
        description:
          "Observação do aplicativo em primeiro plano e dos processos, dirigindo a troca automática de perfil (§4).",
        weight: 4,
        children: [
          {
            key: "P3-M3-T1",
            kind: "TASK",
            title: "Observação de primeiro plano e de processos",
          },
          {
            key: "P3-M3-T2",
            kind: "TASK",
            title: "Avaliação de regras com prioridade e alternativa padrão",
          },
          { key: "P3-M3-T3", kind: "TASK", title: "Sobreposição manual e retorno automático" },
          { key: "P3-M3-T4", kind: "TASK", title: "Transições de contexto na PWA" },
        ],
      },
      {
        key: "P3-M4",
        kind: "MILESTONE",
        title: "Provedores de estado",
        description: "Estado bidirecional para que a interface reflita o computador (§6).",
        weight: 3,
        children: [
          { key: "P3-M4-T1", kind: "TASK", title: "Canal de transmissão de estado" },
          { key: "P3-M4-T2", kind: "TASK", title: "Provedor de métricas do sistema" },
          { key: "P3-M4-T3", kind: "TASK", title: "Provedor de estado de mídia e áudio" },
        ],
      },
    ],
  },
  {
    key: "P4",
    kind: "PHASE",
    title: "Verticais",
    description:
      "Os dois públicos de lançamento, feitos bem em vez de feitos por atacado (§39).",
    weight: 3,
    dependsOn: ["P3", "P2"],
    children: [
      {
        key: "P4-M1",
        kind: "MILESTONE",
        title: "Games",
        weight: 3,
        children: [
          { key: "P4-M1-T1", kind: "TASK", title: "Integração com OBS" },
          { key: "P4-M1-T2", kind: "TASK", title: "Controle de áudio" },
          { key: "P4-M1-T3", kind: "TASK", title: "Detecção de jogo e perfis" },
          { key: "P4-M1-T4", kind: "TASK", title: "Widgets de desempenho" },
        ],
      },
      {
        key: "P4-M2",
        kind: "MILESTONE",
        title: "Desenvolvimento",
        weight: 3,
        children: [
          { key: "P4-M2-T1", kind: "TASK", title: "Status do Git e branch atual" },
          { key: "P4-M2-T2", kind: "TASK", title: "Executor de scripts com modelo de permissão" },
          {
            key: "P4-M2-T3",
            kind: "TASK",
            title: "Status de servidor de desenvolvimento e portas",
          },
          { key: "P4-M2-T4", kind: "TASK", title: "Integração com o editor" },
        ],
      },
      {
        key: "P4-M3",
        kind: "MILESTONE",
        title: "Modelos prontos",
        description:
          "Superfícies de controle pré-montadas que aceleram o primeiro uso (§41).",
        weight: 2,
        children: [
          { key: "P4-M3-T1", kind: "TASK", title: "Modelo de template e aplicação" },
          { key: "P4-M3-T2", kind: "TASK", title: "Conjunto inicial de templates" },
        ],
      },
    ],
  },
  {
    key: "P5",
    kind: "PHASE",
    title: "Prontidão Comercial",
    description:
      "Direitos de acesso, cobrança, extensibilidade e a auditoria de lançamento (§44, §58).",
    weight: 2,
    dependsOn: ["P4"],
    children: [
      {
        key: "P5-M1",
        kind: "MILESTONE",
        title: "Sistema de direitos de acesso",
        description:
          "Acesso a funcionalidades, limites e número de dispositivos por plano. Os preços continuam configuráveis.",
        weight: 2,
        children: [
          { key: "P5-M1-T1", kind: "TASK", title: "Modelo de direitos e aplicação" },
          { key: "P5-M1-T2", kind: "TASK", title: "Configuração de planos" },
        ],
      },
      {
        key: "P5-M2",
        kind: "MILESTONE",
        title: "Cobrança",
        description:
          "Arquitetura e integração. A validação de cobrança real depende de credenciais fornecidas pelo operador e não será marcada como concluída sem isso (§29).",
        weight: 2,
        children: [
          { key: "P5-M2-T1", kind: "TASK", title: "Integração de cobrança" },
          { key: "P5-M2-T2", kind: "TASK", title: "Ciclo de vida da assinatura" },
        ],
      },
      {
        key: "P5-M3",
        kind: "MILESTONE",
        title: "Arquitetura de plugins",
        description: "Manifesto, capacidades, permissões e ciclo de vida (§40).",
        weight: 3,
        children: [
          { key: "P5-M3-T1", kind: "TASK", title: "Manifesto e identidade do plugin" },
          { key: "P5-M3-T2", kind: "TASK", title: "Runtime de plugin e modelo de permissão" },
          { key: "P5-M3-T3", kind: "TASK", title: "Ações e widgets vindos de plugins" },
        ],
      },
      {
        key: "P5-M4",
        kind: "MILESTONE",
        title: "Auditoria de lançamento",
        description: "Regressão completa em todas as frentes listadas no §58.",
        weight: 3,
        children: [
          { key: "P5-M4-T1", kind: "TASK", title: "Auditoria de segurança" },
          { key: "P5-M4-T2", kind: "TASK", title: "Auditoria de desempenho" },
          { key: "P5-M4-T3", kind: "TASK", title: "Auditoria de experiência de uso" },
          { key: "P5-M4-T4", kind: "TASK", title: "Passagem de regressão completa" },
        ],
      },
    ],
  },
];
