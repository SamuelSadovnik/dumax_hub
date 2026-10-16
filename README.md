# Dumax Hub

Hub interno da Dumax com três portais:

| Portal | Endereço | Para quem |
|---|---|---|
| **Colaborador** | `/inicio` | Todo mundo: demandas, chat, agenda, documentos, ponto, metas, desempenho próprio, perfil, mural, pulse |
| **Admin** | `/admin` | RH, diretoria e gestores: desempenho do time, ponto, metas, mapa de perfis, clima, recrutamento, cadastros, licenças, documentos |
| **Vagas** | `/vagas` e `/vagas/<vaga>` | Público. O RH publica e divulga um link por canal (`?origem=linkedin`, `whatsapp`, `instagram`…) |

Depois do login cada pessoa cai no portal certo (RH e admin no Admin; os demais no Colaborador). Gestores alternam entre os dois pelo seletor no topo do menu.

```
TypeScript de ponta a ponta
├─ apps/api          Fastify 5 · Prisma 6 · PostgreSQL 16 · Socket.io · node-cron · Claude (Anthropic SDK)
├─ apps/web          React 18 · Vite 6 · Tailwind · React Query · dnd-kit · Recharts
└─ packages/shared   enums, rótulos em PT-BR, perfis comportamentais, regras de desempenho
```

## Rodando local

Pré-requisitos: **Node 20+** e **Docker** (ou um Postgres 16 instalado).

```bash
npm install
npm run db:up        # Postgres no Docker, porta 5433
npm run secrets      # cria apps/api/.env e gera as chaves (JWT e criptografia)
npm run setup        # cria as tabelas e o banco de demonstração
npm run dev          # API (3333) + front (5173)
```

Abra **http://localhost:5173**. Senha de todos os usuários de demonstração: `dumax123`.

| E-mail | Perfil | Cai em |
|---|---|---|
| `admin@dumax.com.br` | Diretoria | Portal admin, vê a empresa toda |
| `rh@dumax.com.br` | RH | Portal admin |
| `gestor@dumax.com.br` | Gerente Comercial | Portal colaborador, com acesso ao admin do próprio time (Pedro e Camila aparecem com alertas) |
| `luiza@dumax.com.br` | Colaboradora | Portal colaborador |

### Atualizando uma instalação que já existe

```bash
# pare o npm run dev (Ctrl+C)
npm install
npm run secrets                       # só adiciona o que falta no .env; nunca troca a chave de criptografia
npm run db:migrate -- --name <nome>   # aplica mudanças do banco
npm run db:reset                      # opcional: apaga tudo e recria o banco de demonstração
npm run dev
```

## O banco de demonstração

Empresa fictícia em Cascavel/PR com 40 pessoas em 7 áreas e 8 times, e com perfis de produtividade diferentes para o painel de desempenho ter o que mostrar:

- 60 dias de ponto (com atrasos, faltas, contestações e aprovações) e apontamento de horas cruzado com ele
- centenas de demandas (no prazo, atrasadas, bloqueadas), metas do trimestre com check-ins, feedbacks e 1:1
- reuniões semanais, 1:1 quinzenais e daily comercial (contam como tempo ocupado)
- teste de perfil de quase todo mundo (mapa de perfis), 8 vagas com perfil ideal, ~70 candidatos com currículo, origem e aderência
- 14 licenças (vencidas, vencendo e em dia), 11 documentos em várias situações de assinatura
- 12 semanas de pulse (a atual aberta e ainda não respondida pelos 4 usuários de demonstração), chat com grupos, conversas diretas e reações, mural e elogios

## Módulos

| Módulo | Onde | Destaques |
|---|---|---|
| **Desempenho** | `/admin`, `/admin/desempenho/:id`, `/desempenho` | Nota de 0 a 100 por pessoa (prazo, volume, uso do tempo, pontualidade, metas). Mostra **onde a pessoa não está sendo produtiva**: horas trabalhadas sem atividade registrada, demandas atrasadas, retrabalho, atrasos, metas atrás do ritmo. Feedbacks e 1:1 criptografados |
| **Apontamento de horas** | cronômetro nas demandas | Inicia/para por demanda ou atividade (execução, reunião, suporte, retrabalho…) e cruza com o ponto |
| **Metas** | `/metas`, `/admin/metas` | Metas por pessoa e time, progresso contra o tempo decorrido, check-ins |
| **Perfis comportamentais** | `/perfil-comportamental`, `/perfis`, `/admin/perfis` | Teste para todos os colaboradores e mapa em quadrantes com a foto de cada pessoa, posicionada pelos percentuais (Executor, Comunicador, Planejador, Analista) |
| **Recrutamento** | `/admin/recrutamento` · público em `/vagas` | Perfil ideal por vaga, link por canal com origem medida, candidatura com currículo e aceite LGPD, teste de perfil automático, **aderência à vaga** (radar candidato × ideal × time, diferenças e perguntas para a entrevista), kanban e ranking, aprovar, reprovar ou entrar em contato |
| **Documentos** | `/documentos`, `/admin/documentos` | Envio de PDF para assinatura (colaboradores e externos), ordem sequencial, assinatura desenhada ou digitada, trilha de auditoria com IP, certificado e página pública de verificação por SHA-256 |
| **Licenças** | `/licencas`, `/admin/licencas` | Alvarás, AVCB, certificados, contratos e seguros com responsável, substituto, dias de aviso configuráveis e e-mails extras; renovação com histórico |
| **Ponto** | `/ponto`, `/admin/ponto` | Integra com a API do seu sistema de ponto (sync a cada 15 min + webhook). Colaborador confirma ou contesta; gestor aprova ou ajusta |
| **Clima** | `/clima`, `/admin/clima` | Pulse toda sexta, média, participação, recorte por área com anonimato mínimo, comentários |
| **Demandas** | `/demandas` | Enviar com prazo e prioridade, delegar, checklist, comentários, lembrete diário |
| **Chat** | `/chat` | Estilo WhatsApp: tempo real, lido/entregue, responder, reagir pelo menu da mensagem, editar, apagar, anexos, fixar, arquivar, marcar como não lida, seleção múltipla, aviso no canto com som |
| **Assistente IA** | botão no canto superior direito | Responde e executa ações (ponto, demandas, reuniões, desempenho, licenças, documentos) **respeitando a hierarquia** |
| **Agenda, organograma, mural** | `/agenda`, `/organograma`, `/mural` | Dia/semana/mês com conflitos; organograma com zoom, arrastar e tela cheia; comunicados e elogios |

## Segurança

- Dados sensíveis criptografados no banco com **AES-256-GCM**: telefone, mensagem e motivo de reprovação de candidatos, comentários do pulse, feedbacks, CPF e imagem das assinaturas
- **Todos os arquivos** (currículos, documentos, licenças, anexos do chat) gravados criptografados, fora de pasta pública; saem só por rota autenticada ou link assinado temporário
- Senhas com bcrypt, JWT, limite de tentativas de login, cabeçalhos de segurança, permissões por hierarquia em todas as rotas e no assistente
- `.env` com permissão 600 e fora do Git; em produção a API não sobe com chave fraca, sem chave de criptografia ou com a senha padrão do banco
- **Guarde o `DATA_ENCRYPTION_KEY`** num cofre de senhas. Sem ele os dados criptografados não podem ser lidos
- As mensagens de texto do chat ficam em texto no banco para permitir a busca; os anexos são criptografados

## Permissões

| | Colaborador | Gestor | RH | Admin |
|---|:-:|:-:|:-:|:-:|
| Portal colaborador | ✅ | ✅ | ✅ | ✅ |
| Desempenho, ponto e metas de outras pessoas | — | só o time abaixo dele | todos | todos |
| Recrutamento | — | visualizar | ✅ | ✅ |
| Clima, pessoas, estrutura, licenças da empresa | — | — | ✅ | ✅ |

## Ligando no seu sistema de ponto

Veja [`docs/INTEGRACAO_PONTO.md`](docs/INTEGRACAO_PONTO.md). Resumo: `PONTO_PROVIDER="http"`, `PONTO_API_URL`, `PONTO_API_TOKEN`, o **código no ponto** de cada pessoa em Pessoas, e ajuste `mapPunch()` em `apps/api/src/modules/ponto/providers.ts` se os campos tiverem outros nomes.

## Scripts

```bash
npm run dev          # API + front com hot reload
npm run secrets      # cria/completa o .env com chaves fortes
npm run db:migrate   # aplica migrações (use -- --name <nome>)
npm run db:reset     # apaga o banco e recria com dados de demonstração
npm run db:studio    # Prisma Studio
npm run typecheck    # checa tipos de tudo
npm run build        # build de produção
```
