-- Critérios da avaliação de entrevista por vaga
ALTER TABLE "jobs" ADD COLUMN "scorecardCriteria" JSONB;

-- Indicação de colaboradores
ALTER TABLE "applications" ADD COLUMN "referredById" TEXT;
ALTER TABLE "applications" ADD CONSTRAINT "applications_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Avaliação de entrevista
CREATE TABLE "interview_scorecards" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "ratings" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_scorecards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "interview_scorecards_applicationId_authorId_key" ON "interview_scorecards"("applicationId", "authorId");
ALTER TABLE "interview_scorecards" ADD CONSTRAINT "interview_scorecards_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interview_scorecards" ADD CONSTRAINT "interview_scorecards_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 1:1
CREATE TABLE "one_on_ones" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_on_ones_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "one_on_ones_managerId_reportId_scheduledAt_idx" ON "one_on_ones"("managerId", "reportId", "scheduledAt");
ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "one_on_one_items" (
    "id" TEXT NOT NULL,
    "oneOnOneId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TOPIC',
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_on_one_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "one_on_one_items_oneOnOneId_idx" ON "one_on_one_items"("oneOnOneId");
ALTER TABLE "one_on_one_items" ADD CONSTRAINT "one_on_one_items_oneOnOneId_fkey" FOREIGN KEY ("oneOnOneId") REFERENCES "one_on_ones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_on_one_items" ADD CONSTRAINT "one_on_one_items_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_on_one_items" ADD CONSTRAINT "one_on_one_items_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PDI
CREATE TABLE "development_plans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "focus" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "development_plans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "development_plans_userId_idx" ON "development_plans"("userId");
ALTER TABLE "development_plans" ADD CONSTRAINT "development_plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "development_plans" ADD CONSTRAINT "development_plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "development_actions" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PRATICA',
    "dueDate" TIMESTAMP(3),
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "development_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "development_actions_planId_idx" ON "development_actions"("planId");
ALTER TABLE "development_actions" ADD CONSTRAINT "development_actions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "development_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Comunicado de leitura obrigatória
ALTER TABLE "announcements" ADD COLUMN "requiresAck" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "announcement_reads" (
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("announcementId","userId")
);
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
