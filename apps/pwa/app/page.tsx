import { Aplicacao } from "@/components/aplicacao";

/**
 * A tela é montada no cliente porque depende da sessão em cookie e da
 * identidade guardada no aparelho — nenhuma das duas existe no servidor.
 */
export default function Page() {
  return <Aplicacao />;
}
