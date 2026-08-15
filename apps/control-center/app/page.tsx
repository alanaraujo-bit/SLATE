import { loadSnapshot } from "@/lib/snapshot";
import { T } from "@/lib/rotulos";
import { Dashboard } from "@/components/dashboard";

// O estado do plano muda independentemente de build, então esta página nunca
// pode ser servida de cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  try {
    const snapshot = await loadSnapshot();
    return <Dashboard initial={snapshot} />;
  } catch (error) {
    // Banco inacessível é um estado operacional real, não uma falha do código.
    // Dizer isso claramente é melhor do que renderizar uma página quebrada.
    const mensagem = error instanceof Error ? error.message : "Erro desconhecido";
    return (
      <main className="shell">
        <div className="panel">
          <div className="panel__head">
            <h1 className="panel__title">{T.indisponivel}</h1>
          </div>
          <div className="panel__body">
            <p className="notice notice--error">{T.erroLeitura}</p>
            <pre className="code-line">{mensagem}</pre>
          </div>
        </div>
      </main>
    );
  }
}
