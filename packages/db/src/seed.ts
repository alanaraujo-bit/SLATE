import { eq, and } from "drizzle-orm";
import { createDb } from "./index";
import {
  projects,
  workItems,
  qualityGates,
  dependencies,
  operatorActions,
  executionState,
} from "./schema";
import { PROJECT, ROADMAP, type SeedItem } from "./roadmap-data";

/**
 * Seeds the roadmap.
 *
 * Idempotent and *additive*: re-running updates descriptive fields (title,
 * description, weight, ordering) but never rewinds a `status` or gate result
 * that execution has already advanced. Re-seeding after two weeks of work must
 * not reset progress to zero — so status is written on insert only.
 */

const OPERATOR_ACTIONS = [
  {
    code: "AÇÃO-001",
    title: "Liberar o escopo `workflow` no token do GitHub",
    projectBlocked: false,
    impact: "A integração contínua não pode ser enviada para o repositório.",
    blocks:
      "Somente a automação de CI/CD. Todo o desenvolvimento, publicação e validação seguem normalmente.",
    why:
      "O token autenticado do gh tem os escopos gist, read:org e repo, mas não tem workflow. " +
      "O GitHub recusa qualquer push que altere arquivos em .github/workflows/.",
    whatToDo:
      "Rode `gh auth refresh -h github.com -s workflow` e aprove a autorização que abrir no navegador.",
    howToValidate: "`gh auth status` deve listar `workflow` entre os escopos do token.",
    alreadyCompleted:
      "As definições da esteira já estão escritas e versionadas em docs/deployment/ci/, " +
      "prontas para serem movidas para .github/workflows/ num único commit.",
    whatHappensAfter:
      "Checagem de tipos, lint e testes passam a rodar a cada push, e os critérios de " +
      "qualidade do plano começam a reportar resultados automáticos.",
  },
  {
    code: "AÇÃO-002",
    title: "Certificado de assinatura de código para o instalador Windows",
    projectBlocked: false,
    impact:
      "Os instaladores ficam sem assinatura e o Windows SmartScreen alerta na primeira execução.",
    blocks:
      "Somente a distribuição confiável do instalador. O Agente compila, instala e roda normalmente.",
    why:
      "A assinatura Authenticode exige um certificado OV ou EV comprado de uma autoridade " +
      "certificadora em nome da Aionixdev, com validação da empresa. É uma compra comercial " +
      "que não pode ser feita de forma autônoma.",
    whatToDo:
      "Comprar um certificado de assinatura OV ou EV, concluir a validação da empresa e " +
      "guardar como os secrets WINDOWS_CERT_BASE64 e WINDOWS_CERT_PASSWORD no GitHub.",
    howToValidate:
      "`signtool verify /pa slate-setup.exe` passa e o editor aparece como Aionixdev.",
    alreadyCompleted:
      "A esteira de build e empacotamento já está escrita de forma que assinar seja apenas " +
      "um passo de configuração.",
    whatHappensAfter:
      "Os instaladores publicados passam a ser confiáveis, os alertas do SmartScreen somem " +
      "e a atualização automática consegue verificar assinaturas.",
  },
  {
    code: "AÇÃO-003",
    title: "Publicações na Vercel não saem da fila",
    projectBlocked: false,
    impact: "Nenhum hoje. O Centro de Controle roda localmente por decisão sua (D-007).",
    blocks:
      "Nada no momento. Precisa ser resolvido antes da PWA, que é de fato hospedada na nuvem.",
    why:
      "Causa identificada. A CLI mostrava o status como UNKNOWN e não retornava log nenhum, " +
      "o que escondia o motivo. Rodando `vercel deploy --debug`, a resposta crua da API " +
      "mostra readyState BLOCKED, com seatBlock blockCode TEAM_ACCESS_REQUIRED e " +
      "isVerified false, e isInConcurrentBuildsQueue false. Ou seja: é bloqueio de assento " +
      "no time aionixdev — não é fila de build e não é problema técnico. As CLIs 58 e 59 " +
      "não conhecem o estado BLOCKED e o exibem como UNKNOWN, que é por que o diagnóstico " +
      "normal não levava a lugar nenhum. O lado do código está sadio: compila local, " +
      "compila em Docker, e uma publicação pré-compilada é bloqueada igual.",
    whatToDo:
      "Conferir o assento da conta alanarauj0 no time aionixdev em " +
      "vercel.com/teams/aionixdev/settings/members — TEAM_ACCESS_REQUIRED indica assento " +
      "ausente, não confirmado ou pendente de aprovação. Conferir também convite pendente " +
      "de aceite ou verificação de e-mail em aberto (isVerified false aponta para isso) e a " +
      "cobrança do time, já que pagamento pendente bloqueia assentos. Se o assento estiver " +
      "correto e verificado, acionar o suporte citando blockCode TEAM_ACCESS_REQUIRED e o " +
      "id de publicação dpl_96RDqKidmsE2fSK1ygzJmbbPSf2Q.",
    howToValidate:
      "`vercel deploy --prod --yes --scope aionixdev` chega em Ready e o domínio serve a nova versão.",
    alreadyCompleted:
      "O projeto está criado e configurado corretamente (diretório raiz, framework, GitHub " +
      "conectado e DATABASE_URL nos dois ambientes). Existe também um Dockerfile validado, " +
      "então a aplicação pode ser hospedada em qualquer lugar com container.",
    whatHappensAfter:
      "A hospedagem na nuvem volta a ficar disponível para a etapa da PWA. O Centro de " +
      "Controle não precisa dela e continua rodando local.",
  },
  {
    code: "AÇÃO-007",
    title: "Criar a chave do relay TURN",
    projectBlocked: false,
    impact:
      "O fallback entre redes restritivas não pode ser provado; o caminho direto na mesma rede continua funcionando.",
    blocks: "Conclusão de P1-M5-T4 e o teste forçado com política relay.",
    why:
      "O Railway não expõe UDP público. O Cloudflare Realtime TURN fornece UDP, TCP e TLS, " +
      "mas criar a chave de emissão exige acesso à conta externa do operador.",
    whatToDo:
      "Criar uma chave slate-production em Cloudflare Realtime > TURN e guardar " +
      "CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN e TURN_TTL_SEGUNDOS=21600 " +
      "no serviço slate-api do Railway.",
    howToValidate:
      "Executar a interoperabilidade com iceTransportPolicy=relay e confirmar por getStats() que o par selecionado usa candidato relay.",
    alreadyCompleted:
      "A API emite e renova credenciais temporárias sem expor o segredo; PWA e Agente já consomem a mesma configuração ICE.",
    whatHappensAfter:
      "O DataChannel funciona também sob NAT simétrico e redes isoladas, sem configuração pelo usuário.",
  },
  {
    code: "AÇÃO-008",
    title: "Criar token somente leitura para as releases privadas do Agente",
    projectBlocked: false,
    impact:
      "A busca automática não alcança uma release real enquanto o repositório continuar privado; o Agente atual continua funcionando.",
    blocks: "Critério publicação de P3-M1-T4.",
    why:
      "O token do GitHub não pode ser embutido no Agente. A API precisa de uma credencial servidor-servidor restrita para gerar o redirecionamento temporário do pacote.",
    whatToDo:
      "Criar um fine-grained PAT com Contents: read apenas para alanaraujo-bit/SLATE e definir GITHUB_RELEASE_TOKEN no serviço da API no Railway.",
    howToValidate:
      "Publicar uma versão maior e verificar que /api/atualizacoes/windows/x86_64/0.1.0 responde 200 com versão, URL e assinatura, sem expor o token.",
    alreadyCompleted:
      "Endpoint seguro, validação do manifesto, restrição ao asset da release, assinatura do Tauri e workflow de publicação já estão implementados.",
    whatHappensAfter:
      "O Agente encontra, baixa, verifica e instala releases reais sem exigir reinstalação manual.",
  },
  {
    code: "AÇÃO-009",
    title: "Guardar a chave de atualização no GitHub Actions",
    projectBlocked: false,
    impact:
      "O workflow não consegue publicar o primeiro pacote assinado; builds e testes locais continuam funcionando.",
    blocks: "Critério publicação de P3-M1-T4.",
    why:
      "A chave privada e a senha precisam virar secrets remotos, e o envio de credenciais exige autorização explícita do operador.",
    whatToDo:
      "Autorizar a gravação de TAURI_SIGNING_PRIVATE_KEY e TAURI_SIGNING_PRIVATE_KEY_PASSWORD nos secrets do repositório e manter backup cifrado.",
    howToValidate:
      "gh secret list exibe os dois nomes e o workflow Publicar Agente Desktop gera .exe, .sig e latest.json.",
    alreadyCompleted:
      "Chave forte gerada fora do repositório, ACL restrita, pública embutida e teste de adulteração passando.",
    whatHappensAfter:
      "Tags slate-vX.Y.Z passam a publicar atualizações verificáveis de ponta a ponta.",
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const db = createDb(url);
  console.log(`Seeding roadmap into ${new URL(url).host}`);

  const [project] = await db
    .insert(projects)
    .values(PROJECT)
    .onConflictDoUpdate({
      target: projects.slug,
      set: {
        name: PROJECT.name,
        description: PROJECT.description,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!project) throw new Error("Failed to upsert project");
  const projectId = project.id;

  const idByKey = new Map<string, string>();
  const pendingDeps: Array<{ from: string; to: string }> = [];
  let inserted = 0;
  let updated = 0;
  let orphanedGatesRemoved = 0;

  const walk = async (items: SeedItem[], parentId: string | null) => {
    for (const [index, item] of items.entries()) {
      const existing = await db
        .select({ id: workItems.id })
        .from(workItems)
        .where(and(eq(workItems.projectId, projectId), eq(workItems.key, item.key)))
        .limit(1);

      let id: string;

      if (existing[0]) {
        id = existing[0].id;
        // Descriptive fields refresh; status deliberately does not.
        await db
          .update(workItems)
          .set({
            parentId,
            kind: item.kind,
            title: item.title,
            description: item.description ?? null,
            weight: item.weight ?? 1,
            position: index,
            updatedAt: new Date(),
          })
          .where(eq(workItems.id, id));
        updated += 1;
      } else {
        const [row] = await db
          .insert(workItems)
          .values({
            projectId,
            parentId,
            kind: item.kind,
            key: item.key,
            title: item.title,
            description: item.description ?? null,
            status: item.status ?? "PLANNED",
            weight: item.weight ?? 1,
            position: index,
          })
          .returning({ id: workItems.id });
        if (!row) throw new Error(`Failed to insert ${item.key}`);
        id = row.id;
        inserted += 1;
      }

      idByKey.set(item.key, id);

      /*
       * Remove critérios que saíram da definição do item.
       *
       * Sem isto, renomear ou trocar um critério deixa o antigo órfão no banco,
       * permanentemente pendente — e como um critério pendente impede a
       * conclusão, o item ficaria impossível de concluir para sempre, sem
       * nenhuma pista do motivo. Um critério só existe enquanto o plano o
       * declara.
       */
      const chavesDefinidas = (item.gates ?? []).map((gate) => gate.key);
      const gatesNoBanco = await db
        .select({ id: qualityGates.id, key: qualityGates.key })
        .from(qualityGates)
        .where(eq(qualityGates.workItemId, id));

      for (const gate of gatesNoBanco) {
        if (chavesDefinidas.includes(gate.key)) continue;
        await db.delete(qualityGates).where(eq(qualityGates.id, gate.id));
        orphanedGatesRemoved += 1;
      }

      for (const gate of item.gates ?? []) {
        const existingGate = await db
          .select({ id: qualityGates.id })
          .from(qualityGates)
          .where(and(eq(qualityGates.workItemId, id), eq(qualityGates.key, gate.key)))
          .limit(1);

        if (existingGate[0]) {
          // Title may be reworded; a recorded result is never overwritten.
          await db
            .update(qualityGates)
            .set({ title: gate.title, weight: gate.weight ?? 1 })
            .where(eq(qualityGates.id, existingGate[0].id));
        } else {
          await db.insert(qualityGates).values({
            workItemId: id,
            key: gate.key,
            title: gate.title,
            status: gate.status ?? "PENDING",
            weight: gate.weight ?? 1,
            evidence: gate.evidence ?? null,
            checkedAt: gate.status && gate.status !== "PENDING" ? new Date() : null,
          });
        }
      }

      for (const dep of item.dependsOn ?? []) {
        pendingDeps.push({ from: item.key, to: dep });
      }

      if (item.children?.length) {
        await walk(item.children, id);
      }
    }
  };

  await walk(ROADMAP, null);

  for (const dep of pendingDeps) {
    const from = idByKey.get(dep.from);
    const to = idByKey.get(dep.to);
    if (!from || !to) {
      console.warn(`Skipping dependency ${dep.from} -> ${dep.to}: unknown key`);
      continue;
    }
    await db
      .insert(dependencies)
      .values({ workItemId: from, dependsOnId: to })
      .onConflictDoNothing();
  }

  for (const action of OPERATOR_ACTIONS) {
    await db
      .insert(operatorActions)
      .values({ projectId, ...action })
      .onConflictDoUpdate({
        target: operatorActions.code,
        set: {
          title: action.title,
          impact: action.impact,
          blocks: action.blocks,
          why: action.why,
          whatToDo: action.whatToDo,
          howToValidate: action.howToValidate,
          alreadyCompleted: action.alreadyCompleted,
          whatHappensAfter: action.whatHappensAfter,
        },
      });
  }

  await db
    .insert(executionState)
    .values({ projectId, operation: "Seeding roadmap", branch: "main" })
    .onConflictDoNothing();

  console.log(
    `Plano carregado: ${inserted} inseridos, ${updated} atualizados, ` +
      `${orphanedGatesRemoved} critério(s) órfão(s) removido(s), ` +
      `${pendingDeps.length} dependências, ${OPERATOR_ACTIONS.length} ações do operador.`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
