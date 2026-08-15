# ADR-0003 — Protocolo: contratos, versionamento e negociação

**Situação:** ACEITO
**Referências do mandato:** §38 (versionamento do protocolo), §33 (payloads tipados), §37 (estados de conexão)
**Depende de:** [ADR-0002 Transporte](./ADR-0002-transporte.md), [ADR-0004 Segurança](./ADR-0004-seguranca.md)

## Contexto

A PWA atualiza sozinha, na hora — basta o usuário recarregar. O Agente Desktop é
um instalador que a pessoa pode passar meses sem atualizar. Os dois vão estar
fora de sincronia em produção, o tempo todo, e isso não é falha: é o estado
normal do sistema.

O mandato §38 exige versionamento desde o início e alerta contra "construir
protocolo impossível de evoluir". As duas formas clássicas de errar aqui:

1. **Sem versão nenhuma.** Um campo novo quebra agentes antigos, e não há como
   detectar isso a não ser pelo erro do usuário.
2. **Versão rígida demais.** Exigir igualdade exata transforma toda mudança
   cosmética em atualização obrigatória para todo mundo.

## Decisão

### Envelope único, independente de transporte

Toda mensagem tem a mesma forma externa, seja qual for o transporte. Isso é o que
mantém barata a saída de emergência prevista no [ADR-0002](./ADR-0002-transporte.md)
(trocar DataChannel por WebSocket retransmitido) — a camada de aplicação não
sabe por onde os bytes passam.

```jsonc
{
  "v":   1,                    // versão maior do protocolo
  "id":  "01J...",             // identificador da mensagem, para correlação
  "t":   "req",                // req | res | evt
  "k":   "action.execute",     // tipo da mensagem
  "ts":  1786768350610,        // timestamp de origem
  "seq": 42,                   // contador monotônico da sessão
  "p":   { }                   // conteúdo, validado por schema por tipo
}
```

`ts` e `seq` não são enfeite: são exigidos pela resistência a repetição do
[ADR-0004 §6](./ADR-0004-seguranca.md).

- `req` espera exatamente um `res` com o mesmo `id`.
- `evt` não espera resposta e pode chegar sem pedido — é como o estado flui do
  PC para a tela (§6 do mandato).

### Versão maior e capacidades, não versão exata

O `v` só muda quando o **envelope** muda de forma incompatível. Isso deve ser
raro — idealmente nunca.

Tudo que é evolução de funcionalidade passa por **capacidades**, não por versão.
No handshake cada lado declara o que sabe fazer:

```jsonc
{
  "protocolVersion": 1,
  "appVersion": "0.4.1",
  "capabilities": ["action.execute", "state.system", "context.rules", "obs.control"]
}
```

A sessão passa a operar na **interseção** das capacidades. Um Agente antigo
simplesmente não anuncia `obs.control`, e a PWA desabilita aquela parte da
interface com uma explicação — em vez de mandar um comando que vai falhar.

Consequência prática: **adicionar funcionalidade nunca quebra ninguém**. Só
adicionar campo obrigatório em mensagem existente quebra, e por isso campo novo
é sempre opcional.

### Comportamento quando as versões não batem

| Situação | Comportamento |
|---|---|
| Mesma versão maior | Conecta; opera na interseção das capacidades |
| Agente com versão **menor** | Conecta; PWA opera no que o Agente suporta e sinaliza que há atualização disponível |
| Agente com versão **maior** | Recusa; a PWA pede que o usuário recarregue para pegar a versão nova |
| Versão maior incompatível | Estado `VERSION_MISMATCH` na interface, com instrução do que fazer |

`VERSION_MISMATCH` é um estado de conexão de primeira classe, ao lado de
`CONNECTED`, `RECONNECTING` e os demais (§37) — a tela precisa explicar o que
houve, não parecer quebrada.

### Payloads validados na borda

Todo `p` é validado contra um schema antes de qualquer uso. Mensagem que não
valida é descartada e registrada, nunca processada parcialmente. Isso vale nas
duas direções: o Agente não confia na PWA, e a PWA não confia no Agente.

Os schemas vivem em `packages/protocol` e são a **única** definição — os tipos
TypeScript são derivados deles, então tipo e validação não podem divergir.

### Resultado de ação é fluxo, não valor único

Executar uma ação não devolve uma resposta e acabou. O mandato §5 pede
`ACK → EXECUTING → RESULT`, e a interface precisa refletir cada etapa:

```
PWA ──req action.execute──► Agente
PWA ◄─res  (aceito, id) ─── Agente     aceito, começou
PWA ◄─evt  action.progress ─ Agente     opcional, para ação longa
PWA ◄─evt  action.result ─── Agente     sucesso ou falha, com motivo
```

Separar `res` (aceitei o pedido) de `evt action.result` (terminou, e deu isso) é
o que permite a uma ação de 30 segundos mostrar progresso em vez de parecer
travada.

## Consequências

**A favor**
- Agente e PWA evoluem em ritmos diferentes sem coordenação.
- Funcionalidade nova nunca quebra cliente antigo.
- Uma definição só para schema e tipo, compartilhada pelos três clientes.
- Trocar de transporte não toca a camada de aplicação.

**Custos aceitos**
- Todo recurso novo precisa declarar sua capacidade, e a interface precisa tratar
  a ausência dela. É trabalho real em cada funcionalidade.
- A negociação adiciona um ida-e-volta no início da sessão.

**Regra que não pode ser quebrada**
- Campo novo em mensagem existente é **sempre opcional**. Precisar de campo
  obrigatório significa mensagem nova, com capacidade nova.
