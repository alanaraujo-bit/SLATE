/**
 * Cliente da API do SLATE.
 *
 * Toda requisição vai com `credentials: "include"`, porque a sessão vive num
 * cookie `HttpOnly` que o JavaScript não consegue ler nem enviar por conta
 * própria (ADR-0005).
 */

/**
 * A API vive sob a mesma origem, atrás de `/api`.
 *
 * Não é detalhe de organização: o cookie de sessão é `HttpOnly` e, ao apontar
 * para outra origem, o WebKit — motor de todo navegador no iPhone e no iPad —
 * simplesmente não o enviava de volta. A sessão era criada e perdida na
 * requisição seguinte.
 *
 * Com origem única o cookie é de primeira parte, e nenhum navegador bloqueia
 * um cookie do próprio site.
 */
export const URL_API = "/api";
export const EVENTO_SEM_CONEXAO = "slate:sem-conexao";

export interface Usuario {
  id: string;
  email: string;
  nome: string | null;
}

export interface DispositivoResumo {
  id: string;
  nome: string;
  papel: "agent" | "surface";
  situacao: "pendente" | "ativo" | "revogado";
  escopos: string[];
  chavePublica: string;
  algoritmo: string;
}

export type ResultadoApi<T> =
  | { ok: true; dados: T }
  | { ok: false; erro: string; detalhe?: unknown; status: number };

/**
 * Mensagens para os erros que a API devolve.
 *
 * Ficam aqui, e não nas telas, para que a mesma falha seja explicada do mesmo
 * jeito em qualquer lugar — e para que nenhum código de erro cru chegue à
 * pessoa.
 */
const MENSAGENS: Record<string, string> = {
  credenciais_invalidas: "E-mail ou senha incorretos.",
  email_invalido: "Esse e-mail não parece válido.",
  senha_invalida: "Informe uma senha.",
  senha_fraca: "Escolha uma senha mais forte.",
  muitas_tentativas:
    "Muitas tentativas seguidas. Espere alguns minutos antes de tentar de novo.",
  nao_autenticado: "Sua sessão expirou. Entre novamente.",
  origem_nao_autorizada: "Este aplicativo não está autorizado a falar com o servidor.",
  codigo_incorreto: "Código incorreto.",
  bloqueado: "Tentativas esgotadas. Peça um código novo.",
  nenhum_pedido_ativo: "Nenhum pareamento em andamento.",
  chave_ja_registrada: "Este dispositivo já está registrado.",
  dados_invalidos: "Não foi possível enviar os dados.",
  erro_interno: "Algo deu errado no servidor. Tente de novo em instantes.",
  sem_conexao: "Não foi possível falar com o servidor. Verifique sua conexão.",
};

export function mensagemDoErro(codigo: string): string {
  return MENSAGENS[codigo] ?? "Algo deu errado. Tente de novo.";
}

async function chamar<T>(
  caminho: string,
  opcoes: RequestInit = {},
): Promise<ResultadoApi<T>> {
  let resposta: Response;

  try {
    resposta = await fetch(`${URL_API}${caminho}`, {
      // Sem isto o cookie de sessão não é enviado nem recebido, e o login
      // funcionaria uma vez e sumiria.
      credentials: "include",
      headers:
        opcoes.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      ...opcoes,
    });
  } catch {
    // Falha de rede não tem status; virar um código próprio evita que a tela
    // precise distinguir `undefined` de erro de verdade.
    if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_SEM_CONEXAO));
    return { ok: false, erro: "sem_conexao", status: 0 };
  }

  const corpo = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    return {
      ok: false,
      erro: typeof corpo.erro === "string" ? corpo.erro : "erro_interno",
      detalhe: corpo.problemas,
      status: resposta.status,
    };
  }

  return { ok: true, dados: corpo as T };
}

export const api = {
  saude: () => chamar<{ situacao: string }>("/saude"),

  cadastrar: (dados: { email: string; senha: string; nome?: string }) =>
    chamar<{ criado: boolean; usuario?: Usuario }>("/contas/cadastro", {
      method: "POST",
      body: JSON.stringify(dados),
    }),

  entrar: (dados: { email: string; senha: string }) =>
    chamar<{ usuario: Usuario }>("/contas/entrada", {
      method: "POST",
      body: JSON.stringify(dados),
    }),

  sair: () => chamar<{ encerrada: boolean }>("/contas/saida", { method: "POST" }),

  eu: () => chamar<{ usuario: Usuario }>("/contas/eu"),

  dispositivos: () => chamar<{ dispositivos: DispositivoResumo[] }>("/dispositivos"),

  pedirPareamento: (dados: { chavePublica: string; algoritmo: string; nome: string }) =>
    chamar<{
      pedidoId: string;
      codigo: string;
      codigoFormatado: string;
      expiraEm: string;
    }>("/pareamento/pedidos", {
      method: "POST",
      body: JSON.stringify(dados),
    }),

  consultarPedidoPareamento: (pedidoId: string) =>
    chamar<
      | { situacao: "pendente" | "expirado" | "bloqueado" }
      | {
          situacao: "confirmado";
          agente: {
            id: string;
            nome: string;
            papel: "agent";
            chavePublica: string;
            algoritmo: string;
            escopos: string[];
          };
        }
    >(`/pareamento/pedidos/${encodeURIComponent(pedidoId)}`),

  pedirDesafioSinalizacao: (chavePublica: string) =>
    chamar<{
      desafioId: string;
      dispositivoId: string;
      nonce: string;
      expiraEm: number;
      urlSinalizacao: string;
    }>("/sinalizacao/desafios", {
      method: "POST",
      body: JSON.stringify({ chavePublica }),
    }),

  trocarDesafioSinalizacao: (dados: {
    desafioId: string;
    nonce: string;
    assinatura: string;
  }) =>
    chamar<{ token: string; expiraEm: number }>("/sinalizacao/tokens", {
      method: "POST",
      body: JSON.stringify(dados),
    }),
};
