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

Empresa fictícia em Cascavel/PR com 46 pessoas em 7 áreas e 8 times (do estágio à diretoria, com coordenações intermediárias), e com perfis de produtividade diferentes para o painel de desempenho ter o que mostrar:

- 60 dias de ponto vindos da API de demonstração (com atrasos, faltas e dias incompletos)
- centenas de demandas (no prazo, atrasadas, bloqueadas), metas do trimestre com check-ins, feedbacks e 1:1
- reuniões semanais, 1:1 quinzenais e daily comercial (contam como tempo ocupado)
- teste de perfil de quase todo mundo (mapa de perfis), 8 vagas com perfil ideal, ~70 candidatos com currículo, origem e aderência
- 14 licenças (vencidas, vencendo e em dia), 11 documentos em várias situações de assinatura
- 12 semanas de pulse (a atual aberta e ainda não respondida pelos 4 usuários de demonstração), chat com grupos, conversas diretas e reações, mural e elogios

## Módulos

| Módulo | Onde | Destaques |
|---|---|---|
| **Desempenho** | `/admin`, `/admin/desempenho/:id`, `/desempenho` | Nota de 0 a 100 por pessoa: entregas no prazo (30%), volume (25%), metas (25%) e pontualidade (20%). Mostra demandas atrasadas, retrabalho, atrasos e metas atrás do ritmo. Feedbacks e 1:1 criptografados |
| **Metas** | `/metas`, `/admin/metas` | Metas por pessoa e time, progresso contra o tempo decorrido, check-ins |
| **Perfis comportamentais** | `/perfil-comportamental`, `/perfis`, `/admin/perfis` | Teste para todos (convite automático para quem entra e lembrete toda segunda a quem falta). Mapa em bússola com a foto de cada pessoa, cartões por perfil e visão em colunas |
| **Recrutamento** | `/admin/recrutamento` · público em `/vagas` | Perfil ideal por vaga, link por canal com origem medida, candidatura com currículo e aceite LGPD, **perguntas eliminatórias** de sim/não, múltipla escolha ou número (CNH, carro próprio, anos de experiência, pretensão salarial) que descartam na hora ou só sinalizam, **avaliação de entrevista padronizada** (critérios de 1 a 4 e recomendação, notas dos outros só aparecem depois que você avalia), **banco de talentos** (`/admin/talentos`) para trazer quem já se candidatou para uma vaga nova, **indicação de colaboradores** (`/indicar`, link pessoal por vaga), teste de perfil automático com lembrete e vencimento, ida automática para a triagem com a aderência calculada, leitura do teste por IA, **aderência à vaga** (radar candidato × ideal × time, diferenças e perguntas para a entrevista), kanban e ranking, aprovar, reprovar ou entrar em contato |
| **Documentos** | `/documentos`, `/admin/documentos` | Envio de PDF para assinatura (colaboradores e externos), ordem sequencial, assinatura desenhada ou digitada, trilha de auditoria com IP, certificado e página pública de verificação por SHA-256 |
| **Licenças** | `/licencas`, `/admin/licencas` | Alvarás, AVCB, certificados, contratos e seguros com responsável, substituto, dias de aviso configuráveis e e-mails extras; renovação com histórico |
| **Ponto** | `/ponto`, `/admin/ponto` | Somente leitura: tudo vem da API do seu sistema de ponto (sync a cada 15 min + webhook). Batidas, horas, banco de horas, atrasos e faltas |
| **Clima** | `/clima`, `/admin/clima` | Pulse toda sexta, média, participação, recorte por área com anonimato mínimo, comentários |
| **Demandas** | `/demandas` | Lista "Meu trabalho" por urgência ou quadro. Alguém envia para a pessoa ou ela cria para si. Prazo definido por outra pessoa fica travado: quem recebeu pede **prorrogação** e quem enviou aprova ou recusa. Delegar, checklist, comentários, lembrete diário |
| **Chat** | `/chat` | Estilo WhatsApp: tempo real, lido/entregue, responder, reagir pelo menu da mensagem, editar, apagar, anexos, fixar, arquivar, marcar como não lida, seleção múltipla, aviso no canto com som |
| **Assistente IA** | botão no canto superior direito | Responde e executa ações (ponto, demandas, reuniões, desempenho, licenças, documentos) **respeitando a hierarquia**. Funciona com Claude (`ANTHROPIC_API_KEY`) ou Gemini (`GEMINI_API_KEY`, tem plano grátis no AI Studio); escolha com `AI_PROVIDER` no `apps/api/.env` |
| **Agenda, organograma, mural** | `/agenda`, `/organograma`, `/mural` | Dia/semana/mês com conflitos; organograma com foto, nível do cargo (estágio à diretoria), zoom, arrastar e tela cheia; comunicados (com **leitura obrigatória**: "Li e entendi", pendência na Dashboard e lista de quem falta) e elogios |

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
