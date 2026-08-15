import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";

export function InicioAutomatico() {
  const [ativo, setAtivo] = useState<boolean | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let montado = true;
    void isEnabled()
      .then((valor) => {
        if (montado) setAtivo(valor);
      })
      .catch(() => {
        if (montado) setErro("Não foi possível consultar a inicialização do Windows.");
      });
    return () => {
      montado = false;
    };
  }, []);

  const alterar = async (novoValor: boolean) => {
    if (salvando || ativo === null) return;
    setSalvando(true);
    setErro(null);
    try {
      await (novoValor ? enable() : disable());
      // O estado visual só muda depois de o Windows confirmar a gravação.
      setAtivo(novoValor);
    } catch {
      setErro(
        novoValor
          ? "O Windows não permitiu ativar a inicialização automática."
          : "O Windows não permitiu desativar a inicialização automática.",
      );
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className="inicio-automatico" aria-busy={salvando}>
      <label className="preferencia">
        <span className="preferencia__texto">
          <strong>Abrir o SLATE ao entrar no Windows</strong>
          <small>
            Recomendado para o computador ficar disponível sem precisar abrir o Agente manualmente.
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={ativo ?? false}
          disabled={ativo === null || salvando}
          onChange={(evento) => void alterar(evento.currentTarget.checked)}
          aria-label="Abrir o SLATE ao entrar no Windows"
        />
      </label>
      {erro && (
        <p className="erro pequeno" role="alert">
          {erro}
        </p>
      )}
    </section>
  );
}
