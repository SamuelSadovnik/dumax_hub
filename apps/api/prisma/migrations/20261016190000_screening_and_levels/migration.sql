-- Perguntas eliminatórias nas vagas e respostas na candidatura
ALTER TABLE "jobs" ADD COLUMN "screeningQuestions" JSONB;
ALTER TABLE "applications" ADD COLUMN "screeningAnswers" JSONB;

-- Nível do cargo
ALTER TABLE "users" ADD COLUMN "level" TEXT;

-- Preenche o nível de quem já existe a partir do cargo (pode ser ajustado depois em Pessoas)
UPDATE "users" SET "level" = CASE
  WHEN "jobTitle" ILIKE '%estagi%' THEN 'ESTAGIO'
  WHEN "jobTitle" ~* '(^|\s)(ceo|cfo|cto|coo)(\s|$)' OR "jobTitle" ILIKE 'diretor%' THEN 'DIRETORIA'
  WHEN "jobTitle" ILIKE 'gerente%' OR "jobTitle" ILIKE 'head %' OR "jobTitle" ILIKE 'controller%' THEN 'GERENCIA'
  WHEN "jobTitle" ILIKE 'coordenador%' OR "jobTitle" ILIKE 'tech lead%' OR "jobTitle" ILIKE 'supervisor%' THEN 'COORDENACAO'
  WHEN "jobTitle" ILIKE '%especialista%' OR "jobTitle" ILIKE 'key account%' THEN 'ESPECIALISTA'
  WHEN "jobTitle" ~* '(sênior|senior|\msr\M)' THEN 'SENIOR'
  WHEN "jobTitle" ~* '(júnior|junior|\mjr\M)' OR "jobTitle" ILIKE 'assistente%' OR "jobTitle" ILIKE 'auxiliar%' OR "jobTitle" ILIKE 'atendente%' OR "jobTitle" ILIKE 'recepcionista%' THEN 'JUNIOR'
  ELSE 'PLENO'
END
WHERE "level" IS NULL;

-- Pedidos de prorrogação de prazo das demandas
CREATE TABLE "task_extension_requests" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "previousDueAt" TIMESTAMP(3),
    "requestedDueAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_extension_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_extension_requests_taskId_status_idx" ON "task_extension_requests"("taskId", "status");

ALTER TABLE "task_extension_requests" ADD CONSTRAINT "task_extension_requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_extension_requests" ADD CONSTRAINT "task_extension_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_extension_requests" ADD CONSTRAINT "task_extension_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
