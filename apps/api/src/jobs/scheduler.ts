import cron from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../env';
import { openWeeklyPulse } from '../modules/pulse';
import { syncPonto } from '../modules/ponto/service';
import { addDays, todayDateOnly } from '../lib/dates';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { runLicenseAlerts } from '../modules/licenses';
import { documentHousekeeping } from '../modules/documents';
import { assessmentHousekeeping } from '../modules/recruitment';
import { remindPendingProfiles } from '../modules/profiles';

/** Rotinas agendadas (rodam dentro do processo da API) */
export function startScheduler(log: FastifyBaseLogger) {
  // Pulse de felicidade — toda sexta
  cron.schedule(
    env.PULSE_CRON,
    async () => {
      try {
        const { created } = await openWeeklyPulse();
        log.info({ created }, 'pulse semanal');
      } catch (err) {
        log.error(err, 'falha ao abrir pulse');
      }
    },
    { timezone: env.TZ },
  );

  // Sync do ponto — busca de ontem até agora
  cron.schedule(
    env.PONTO_SYNC_CRON,
    async () => {
      try {
        const r = await syncPonto(addDays(todayDateOnly(), -1));
        log.info(r, 'sync ponto');
      } catch (err) {
        log.error(err, 'falha no sync do ponto');
      }
    },
    { timezone: env.TZ },
  );

  // Lembrete diário (08:30): demandas que vencem hoje + atrasadas
  cron.schedule(
    '30 8 * * 1-5',
    async () => {
      const endOfDay = addDays(todayDateOnly(), 1);
      const tasks = await prisma.task.groupBy({
        by: ['assigneeId'],
        where: { status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] }, dueAt: { lt: new Date(endOfDay.getTime() + 3 * 3600000) } },
        _count: true,
      });
      for (const t of tasks) {
        await notify([t.assigneeId], {
          type: 'task.reminder',
          title: `☀️ Bom dia! Você tem ${t._count} demanda(s) vencendo hoje ou atrasada(s)`,
          link: '/demandas',
        });
      }
    },
    { timezone: env.TZ },
  );

  // Licenças: avisos de vencimento todo dia às 08:00
  cron.schedule(
    '0 8 * * *',
    async () => {
      try {
        log.info(await runLicenseAlerts(), 'alertas de licença');
      } catch (err) {
        log.error(err, 'falha nos alertas de licença');
      }
    },
    { timezone: env.TZ },
  );

  // Documentos: lembrete a quem não assinou (a cada 2 dias) e expiração por prazo
  cron.schedule(
    '0 10 * * *',
    async () => {
      try {
        log.info(await documentHousekeeping(), 'documentos');
      } catch (err) {
        log.error(err, 'falha na rotina de documentos');
      }
    },
    { timezone: env.TZ },
  );

  // Testes de candidatos: lembrete após 2 dias e vencimento — todo dia às 09:30
  cron.schedule(
    '30 9 * * *',
    async () => {
      try {
        log.info(await assessmentHousekeeping(), 'testes de candidatos');
      } catch (err) {
        log.error(err, 'falha na rotina de testes');
      }
    },
    { timezone: env.TZ },
  );

  // Teste de perfil dos colaboradores: lembra quem ainda não fez — toda segunda às 09:15
  cron.schedule(
    '15 9 * * 1',
    async () => {
      try {
        log.info(await remindPendingProfiles(), 'lembrete de teste de perfil');
      } catch (err) {
        log.error(err, 'falha no lembrete de teste de perfil');
      }
    },
    { timezone: env.TZ },
  );

  // Lembrete de reunião 10 min antes
  cron.schedule('* * * * *', async () => {
    const from = new Date(Date.now() + 9 * 60000);
    const to = new Date(Date.now() + 10 * 60000);
    const meetings = await prisma.meeting.findMany({
      where: { canceledAt: null, startsAt: { gte: from, lt: to } },
      include: { participants: { where: { rsvp: { not: 'DECLINED' } } } },
    });
    for (const m of meetings) {
      await notify(m.participants.map((p) => p.userId), {
        type: 'meeting.reminder',
        title: `⏰ Em 10 min: ${m.title}`,
        body: m.location ?? m.videoUrl ?? undefined,
        link: `/agenda?meeting=${m.id}`,
      });
    }
  });
}
