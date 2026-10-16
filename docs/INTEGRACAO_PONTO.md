# Integração com o sistema de ponto

O Hub **não substitui** o seu sistema de ponto. Ele **lê as batidas** de lá, consolida os dias e organiza a validação: o colaborador confirma, o gestor aprova.

## Dois caminhos (pode usar os dois)

### 1. Pull — o Hub busca na sua API (padrão)

```env
PONTO_PROVIDER="http"
PONTO_API_URL="https://seu-sistema.com/api/marcacoes"
PONTO_API_TOKEN="..."           # enviado como Authorization: Bearer
PONTO_SYNC_CRON="*/15 * * * *"  # a cada 15 minutos
```

A cada execução o Hub chama:

```
GET {PONTO_API_URL}?from=2026-10-14T03:00:00.000Z&to=2026-10-15T22:40:00.000Z
```

e espera uma lista (array direto, ou `{ data: [...] }`, `{ items: [...] }`, `{ punches: [...] }`):

```json
[
  { "id": "98231", "matricula": "0005", "dataHora": "2026-10-15T08:58:00-03:00", "tipo": "ENTRADA" },
  { "id": "98232", "matricula": "0005", "dataHora": "2026-10-15T12:01:00-03:00" }
]
```

Campos aceitos (o primeiro que existir):

| Significado | Nomes aceitos |
|---|---|
| ID único da batida | `id`, `externalId`, `punchId`, `marcacaoId`, `nsr` |
| Quem bateu | `employeeCode`, `matricula`, `pis`, `cpf`, `employeeId`, `colaborador`, `codigo` |
| Quando | `at`, `timestamp`, `dataHora`, `datetime`, `date_time`, `horario` |
| Tipo (opcional) | `type`, `tipo`, `kind`, `direction` → `ENTRADA`, `SAIDA`, `SAIDA_INTERVALO`, `RETORNO_INTERVALO`, `IN`, `OUT`… |

Se a sua API usar outro formato, edite **apenas** `mapPunch()` em `apps/api/src/modules/ponto/providers.ts`.

Sem o tipo, o Hub deduz pela ordem do dia: 1ª entrada, 2ª saída para intervalo, 3ª volta, 4ª saída (com só 2 batidas: entrada e saída).

### 2. Push — webhook em tempo real

```env
PONTO_WEBHOOK_SECRET="um-segredo-grande"
```

```
POST https://seu-hub.com/api/ponto/webhook
X-Ponto-Secret: um-segredo-grande
Content-Type: application/json

{ "id": "98233", "matricula": "0005", "dataHora": "2026-10-15T18:04:00-03:00", "tipo": "SAIDA" }
```

Também aceita um array de batidas no corpo.

## Ligando pessoas ↔ ponto

Em **Gestão → Pessoas**, preencha **Código no sistema de ponto** de cada colaborador (o mesmo valor que vem em `matricula`/`pis`/…). Batidas de códigos desconhecidos são contadas como "sem vínculo" no log de sincronização.

Na mesma tela, configure a **jornada** (entrada, saída, intervalo, tolerância e dias da semana). É ela que define atraso e banco de horas.

## Como o dia é calculado

| Situação | Regra |
|---|---|
| **Atraso** | 1ª batida depois de `entrada + tolerância` → conta os minutos desde a entrada prevista |
| **Falta** | dia útil sem nenhuma batida (hoje só depois de passar a tolerância) |
| **Incompleto** | número ímpar de batidas num dia já encerrado (ex.: esqueceu a saída) |
| **Horas trabalhadas** | soma dos pares (entrada→saída intervalo, volta→saída) |
| **Saldo** | trabalhado − previsto (`saída − entrada − intervalo`) |

## Fluxo de validação

```
PENDING ──(colaborador confirma)──▶ CONFIRMED ──(gestor aprova)──▶ APPROVED
   │                                                     
   └──(colaborador contesta + motivo)──▶ CONTESTED ──(gestor aprova ou ajusta horas)──▶ APPROVED / ADJUSTED
```

- Dias aprovados/ajustados ficam **travados**: um novo sync não altera mais os números.
- Se chegar uma batida nova num dia já CONFIRMADO, ele volta para PENDING.
- O gestor recebe notificação de cada contestação; o colaborador é avisado quando o gestor aprova ou ajusta.

## Demonstração

Com `PONTO_PROVIDER="mock"` (padrão), o Hub gera batidas realistas para todas as pessoas com código de ponto: cerca de 15% de atrasos e 3% de faltas. O `npm run setup` já importa 30 dias.
