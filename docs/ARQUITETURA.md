# Arquitetura do Dumax Hub

## Visão geral

```
┌──────────────────────── apps/web (React + Vite) ────────────────────────┐
│  público: /vagas /teste /assinar /verificar   colaborador: /inicio …     │
│  admin: /admin/*                                                         │
│  React Query (cache) · socket.io-client (tempo real) · Tailwind         │
└───────────────┬──────────────────────────────────────┬──────────────────┘
                │ REST /api/*  (JWT Bearer)             │ WebSocket (JWT)
┌───────────────▼──────────────────────────────────────▼──────────────────┐
│                         apps/api (Fastify 5)                             │
│  módulos: auth · users · org · recruitment · profiles · tasks · chat ·   │
│           pulse · feed · meetings · metrics · ponto · performance ·      │
│           timelogs · goals · documents · licenses · inbox · ai           │
│  lib: auth (hierarquia) · crypto (AES-256-GCM) · storage (cifrado) ·     │
│       realtime · notify · mailer                                         │
│  jobs: pulse sexta · ponto 15min · demandas 8h30 · licenças 8h ·         │
│        documentos 10h · lembretes de reunião                             │
└──────┬───────────────────┬─────────────────────┬────────────────────────┘
       │ Prisma            │ HTTP                 │ HTTPS
┌──────▼──────┐   ┌────────▼─────────┐   ┌───────▼────────┐
│ PostgreSQL  │   │ Sistema de ponto │   │ API Anthropic  │
│     16      │   │  (pull/webhook)  │   │ (Claude + tools)│
└─────────────┘   └──────────────────┘   └────────────────┘
```

## Decisões principais

- **Monorepo npm workspaces**. `packages/shared` guarda enums, rótulos em português e os perfis comportamentais — front e API falam a mesma língua sem duplicar.
- **Fastify + Prisma**. Fastify é rápido e simples; o Prisma dá tipos do banco de ponta a ponta e migrations versionadas.
- **Permissão por hierarquia** (`lib/auth.ts → visibleUserIds`). Uma CTE recursiva no Postgres calcula toda a árvore abaixo de um gestor. Toda rota de relatório e **toda ferramenta da IA** passa por aí.
- **Tempo real via salas por usuário** (`user:<id>`). A API emite direto para quem precisa (mensagens, leitura, digitando, notificações). Não há salas por conversa para sincronizar.
- **Perguntas do teste só na API**. O mapeamento resposta→perfil nunca vai para o navegador do candidato.
- **IA com ferramentas, não com SQL livre**. O modelo só chama funções tipadas (`modules/ai/tools.ts`) que já aplicam permissão. O histórico guarda os blocos `tool_use`/`tool_result`, então dá para auditar o que a IA consultou.
- **Ponto desacoplado**. Um `PontoProvider` (mock ou http) mais um webhook alimentam `TimeEntry`; `computeDay()` consolida o dia em `TimeDay`, onde mora a validação.
- **Datas**: o banco guarda tudo em UTC; regras de jornada usam `America/Sao_Paulo` (`lib/dates.ts`).
- **Três portais, uma API**. Colaborador (`/inicio`), admin (`/admin`) e vagas (`/vagas`) são rotas do mesmo front; o que muda é o menu e a permissão de cada rota.
- **Desempenho por cruzamento de fontes** (`modules/performance/engine.ts`). Nota 0–100 com pesos: prazo 20%, volume 20% (contra a mediana do grupo), uso do tempo 25% (apontado + reuniões ÷ trabalhado no ponto), pontualidade 15%, metas 20%, menos 3 pontos por demanda atrasada (até 15). Alertas: horas sem registro, atrasadas, sem entrega, atrasos, faltas, bloqueios, retrabalho, meta atrasada, queda ou alta da nota.
- **Criptografia na aplicação** (`lib/crypto.ts`). Campos sensíveis com prefixo `enc:v1:`; arquivos com cabeçalho `DMXE1`, ambos AES-256-GCM com a chave `DATA_ENCRYPTION_KEY`. Nada é servido de pasta pública.
- **Assinatura eletrônica com trilha**. Hash SHA-256 do PDF original, IP, navegador e horário de cada evento; certificado imprimível e verificação pública comparando o hash no navegador.

## Modelo de dados (resumo)

| Domínio | Tabelas |
|---|---|
| Pessoas | `users` (managerId = hierarquia), `departments` (árvore + responsável), `teams`, `team_members`, `work_schedules` |
| Recrutamento | `jobs`, `candidates`, `applications` (etapa), `application_events` (timeline), `assessment_invites` (token, respostas, resultado) |
| Demandas | `tasks`, `task_checklist_items`, `task_comments`, `task_activities` (histórico de delegação/status) |
| Chat | `conversations` (DIRECT com `directKey` único / GROUP), `conversation_members` (lastReadAt → ✓✓), `messages`, `message_reactions` |
| Clima | `pulse_surveys` (1 por semana), `pulse_responses` (único por pessoa/semana, snapshot da área) |
| Ponto | `time_entries` (batidas, `externalId` único), `time_days` (consolidação + validação), `ponto_sync_logs` |
| Agenda | `meetings`, `meeting_participants` (RSVP) |
| Comunicação | `announcements`, `kudos`, `notifications` |
| IA | `ai_threads`, `ai_messages` |
| Desempenho | `time_logs` (apontamento), `goals`, `goal_checkins`, `feedbacks` (texto cifrado) |
| Perfis | `profile_assessments` (colaboradores), `jobs.idealProfile` |
| Documentos | `documents` (hash do original), `document_signers` (token, CPF e assinatura cifrados), `document_events` |
| Licenças | `licenses` (dias de aviso, responsável, substituto), `license_renewals`, `license_alert_logs` (um aviso por limite) |

## Ferramentas do assistente

| Ferramenta | Exemplo de pergunta |
|---|---|
| `buscar_pessoas` | (usada antes de qualquer pergunta sobre alguém) |
| `ponto_do_dia` | "Quem chegou atrasado hoje?", "Quem não bateu ponto?" |
| `resumo_ponto` | "Como está o banco de horas do Pedro este mês?" |
| `demandas_da_pessoa` | "Quantas demandas a Luiza tem?" |
| `ranking_pendencias` | "Quem do time está com coisa atrasada?" |
| `criar_demanda` | "Manda pro Rafael fechar o relatório de SLA até sexta" |
| `agendar_reuniao` | "Marque uma reunião pra mim amanhã às 10" |
| `agenda` | "O que tenho amanhã?" |
| `enviar_mensagem_chat` | "Avisa a Camila no chat que a reunião mudou" |
| `resumo_clima` | "Como está o clima nas últimas semanas?" |
| `resumo_recrutamento` | "Quantos candidatos temos para a vaga de vendas?" |
| `desempenho` | "Quem do time está menos produtivo este mês?" |
| `licencas` | "Tem alguma licença vencendo?" |
| `documentos_assinatura` | "O que falta eu assinar?" |

Para adicionar uma ferramenta: declare em `TOOL_DEFS` e implemente em `handlers`, sempre usando `visibleUserIds`/`canSeeUser`.

## Inspiração de mercado

| Produto | O que pegamos |
|---|---|
| Gupy / Sólides | site de vagas, teste de perfil comportamental no fluxo, pipeline por etapas |
| Feedz / Qulture.Rocks | pulse semanal, elogios ligados a valores, mural |
| Factorial / Pontomais | ponto com validação do colaborador e aprovação do gestor |
| Slack / WhatsApp | chat com leitura, reações, respostas, anexos |
| Asana / Trello | demandas em kanban com delegação |

## Roadmap sugerido

1. **WhatsApp Business API**: enviar o teste e as atualizações direto pelo número da empresa, sem abrir o app.
2. **Onboarding**: ao mover um candidato para "Contratado", criar o usuário e um checklist de integração.
3. **Férias e ausências**: solicitações com aprovação, alimentando o cálculo de faltas do ponto.
4. **SSO Google/Microsoft** e 2FA.
5. **App mobile** (PWA): notificações push e bater o ponto por geolocalização.
6. **Alertas proativos da IA**: um resumo de segunda de manhã para cada gestor ("3 pessoas com atraso recorrente, clima caiu 0,4").
