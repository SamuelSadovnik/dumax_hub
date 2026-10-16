import type Anthropic from '@anthropic-ai/sdk';
import type { Prisma, TaskStatus } from '@prisma/client';
import { DAY_STATUS_LABEL, ROLE_LABEL, STAGE_LABEL, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, formatMinutes } from '@dumax/shared';
import { prisma } from '../../lib/prisma';
import { canSeeUser, isHR, visibleUserIds, type AuthUser } from '../../lib/auth';
import { addDays, brDateKey, brDateTimeLabel, brTime, dateOnly } from '../../lib/dates';
import { computeDay, dayBounds } from '../ponto/service';
import { createTask } from '../tasks';
import { createMeeting, findConflicts } from '../meetings';
import { peopleTaskMetrics } from '../metrics';
import { emitToUsers } from '../../lib/realtime';
import { buildFlags, computePerformance } from '../performance/engine';
import { LICENSE_CATEGORY_LABEL, daysUntil, licenseState, scoreLevel } from '@dumax/shared';

/**
 * Ferramentas que o assistente pode usar. TODAS respeitam a hierarquia:
 *   colaborador → só os próprios dados · gestor → ele + time abaixo · RH/admin → todos.
 * O modelo nunca acessa o banco diretamente — só através destas funções.
 */

type Input = Record<string, unknown>;
type Handler = (user: AuthUser, input: Input) => Promise<unknown>;

const OPEN: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'];
const fmtDate = (d: Date | null | undefined) => (d ? brDateTimeLabel(d) : null);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

class ToolError extends Error {}

async function assertCanSee(user: AuthUser, targetId: string) {
  if (!(await canSeeUser(user, targetId))) {
    throw new ToolError(
      'Sem permissão: esta pessoa não está na sua hierarquia. Colaboradores só veem os próprios dados; gestores veem o próprio time; RH vê todos.',
    );
  }
}

export const TOOL_DEFS: Anthropic.Messages.Tool[] = [
  {
    name: 'buscar_pessoas',
    description:
      'Procura colaboradores pelo nome, e-mail, cargo ou área. Use SEMPRE antes de qualquer ferramenta que precise de pessoa_id. Retorna id, nome, cargo, área, gestor.',
    input_schema: { type: 'object', properties: { busca: { type: 'string', description: 'Nome ou parte do nome, cargo, área' } }, required: ['busca'] },
  },
  {
    name: 'ponto_do_dia',
    description:
      'Situação do ponto eletrônico num dia: quem chegou atrasado, quem faltou/não bateu ponto, quem está trabalhando, horários de entrada. Padrão = hoje.',
    input_schema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'YYYY-MM-DD (padrão: hoje)' },
        filtro: { type: 'string', enum: ['todos', 'atrasados', 'faltas', 'presentes'], description: 'padrão: todos' },
      },
    },
  },
  {
    name: 'resumo_ponto',
    description:
      'Resumo do ponto num período: horas trabalhadas, banco de horas (saldo), nº de atrasos, faltas, dias pendentes de validação. Sem pessoa_id = todas as pessoas que o usuário pode ver.',
    input_schema: {
      type: 'object',
      properties: {
        pessoa_id: { type: 'string' },
        de: { type: 'string', description: 'YYYY-MM-DD (padrão: 30 dias atrás)' },
        ate: { type: 'string', description: 'YYYY-MM-DD (padrão: hoje)' },
      },
    },
  },
  {
    name: 'demandas_da_pessoa',
    description: 'Lista as demandas (tarefas) atribuídas a uma pessoa, com status, prioridade e prazo.',
    input_schema: {
      type: 'object',
      properties: {
        pessoa_id: { type: 'string', description: 'Se omitido, usa o próprio usuário' },
        situacao: { type: 'string', enum: ['abertas', 'atrasadas', 'concluidas', 'todas'], description: 'padrão: abertas' },
      },
    },
  },
  {
    name: 'ranking_pendencias',
    description:
      'Visão geral de pendências por pessoa: abertas, atrasadas, em andamento, bloqueadas, concluídas em 30 dias, % no prazo e atrasos de ponto. Use para "quem está com coisa pendente", "quem está em dia".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'criar_demanda',
    description: 'Cria uma demanda/tarefa e envia para alguém (ou para o próprio usuário). Só use quando o usuário pedir explicitamente.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        descricao: { type: 'string' },
        responsavel_id: { type: 'string', description: 'Se omitido, a demanda é do próprio usuário' },
        prazo: { type: 'string', description: 'ISO 8601 com fuso, ex.: 2026-10-16T18:00:00-03:00' },
        prioridade: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
      },
      required: ['titulo'],
    },
  },
  {
    name: 'agendar_reuniao',
    description:
      'Marca uma reunião na agenda do Hub e convida participantes (eles recebem notificação). Verifica conflitos de agenda. Só use quando o usuário pedir.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        inicio: { type: 'string', description: 'ISO 8601 com fuso de Brasília, ex.: 2026-10-16T10:00:00-03:00' },
        duracao_minutos: { type: 'number', description: 'padrão 30' },
        participantes_ids: { type: 'array', items: { type: 'string' } },
        local: { type: 'string' },
        link_video: { type: 'string' },
        descricao: { type: 'string' },
      },
      required: ['titulo', 'inicio'],
    },
  },
  {
    name: 'agenda',
    description: 'Lista as reuniões do usuário (ou de alguém do time dele) num período.',
    input_schema: {
      type: 'object',
      properties: {
        pessoa_id: { type: 'string' },
        de: { type: 'string', description: 'YYYY-MM-DD (padrão hoje)' },
        ate: { type: 'string', description: 'YYYY-MM-DD (padrão +7 dias)' },
      },
    },
  },
  {
    name: 'enviar_mensagem_chat',
    description: 'Envia uma mensagem no chat interno, em nome do usuário, para outra pessoa. Só use quando o usuário pedir explicitamente para mandar mensagem.',
    input_schema: {
      type: 'object',
      properties: { pessoa_id: { type: 'string' }, texto: { type: 'string' } },
      required: ['pessoa_id', 'texto'],
    },
  },
  {
    name: 'resumo_clima',
    description: 'Resultados do pulse semanal de felicidade (média 1-5, participação, tendência). Apenas RH/admin; gestores recebem só a média geral.',
    input_schema: { type: 'object', properties: { semanas: { type: 'number', description: 'padrão 8' } } },
  },
  {
    name: 'resumo_recrutamento',
    description: 'Vagas abertas, candidatos por etapa do funil e candidatos recentes. Apenas RH/admin/gestores.',
    input_schema: { type: 'object', properties: { busca_vaga: { type: 'string' } } },
  },
  {
    name: 'desempenho',
    description:
      'Nota de desempenho (0-100) e métricas de produtividade: entregas, % no prazo, horas trabalhadas vs. horas com atividade registrada (tempo improdutivo/sem registro), pontualidade, metas e alertas. Sem pessoa_id = todas as pessoas que o usuário pode ver, ordenadas da pior para a melhor nota. Use para "quem não está produzindo", "como está o desempenho da Luiza".',
    input_schema: {
      type: 'object',
      properties: {
        pessoa_id: { type: 'string' },
        dias: { type: 'number', description: 'Período em dias (padrão 30)' },
      },
    },
  },
  {
    name: 'licencas',
    description: 'Licenças e documentos da empresa com vencimento (alvarás, AVCB, certificados, softwares): situação, dias para vencer e responsável.',
    input_schema: { type: 'object', properties: { apenas_vencendo: { type: 'boolean', description: 'padrão true' } } },
  },
  {
    name: 'documentos_assinatura',
    description: 'Documentos enviados para assinatura: quais estão pendentes, quem falta assinar.',
    input_schema: { type: 'object', properties: {} },
  },
];

const handlers: Record<string, Handler> = {
  async desempenho(user, input) {
    const dias = Math.min(Math.max(Number(input.dias) || 30, 1), 180);
    const pid = str(input.pessoa_id);
    let ids: string[];
    if (pid) {
      await assertCanSee(user, pid);
      ids = [pid];
    } else {
      const scope = await visibleUserIds(user);
      ids = scope ?? (await prisma.user.findMany({ where: { active: true }, select: { id: true } })).map((u) => u.id);
    }
    const to = new Date();
    const from = new Date(to.getTime() - dias * 86400000);
    const prevFrom = new Date(from.getTime() - dias * 86400000);
    const [cur, prev, users] = await Promise.all([
      computePerformance(ids, from, to),
      computePerformance(ids, prevFrom, from),
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    ]);
    return {
      periodo_dias: dias,
      pessoas: users
        .map((u) => {
          const r = cur.get(u.id)!;
          const m = r.metrics;
          return {
            nome: u.name,
            nota: r.score,
            nivel: scoreLevel(r.score)?.label ?? 'sem dados',
            nota_periodo_anterior: prev.get(u.id)!.score,
            entregas: m.tasksDone,
            no_prazo: m.onTimeRate === null ? null : `${Math.round(m.onTimeRate * 100)}%`,
            atrasadas_em_aberto: m.overdueOpen,
            horas_trabalhadas: formatMinutes(m.workedMinutes),
            horas_com_atividade: formatMinutes(m.loggedMinutes + m.activity.AGENDA),
            horas_sem_registro: formatMinutes(m.untrackedMinutes),
            aproveitamento: m.utilization === null ? null : `${Math.round(m.utilization * 100)}%`,
            pontualidade: m.punctuality === null ? null : `${Math.round(m.punctuality * 100)}%`,
            metas: m.goalProgress === null ? null : `${Math.round(m.goalProgress * 100)}% de progresso médio`,
            alertas: buildFlags(m, r.score, prev.get(u.id)!.score).map((f) => f.message),
          };
        })
        .sort((a, b) => (a.nota ?? 101) - (b.nota ?? 101)),
      link: pid ? `/admin/desempenho/${pid}` : '/admin',
    };
  },

  async licencas(user, input) {
    const only = input.apenas_vencendo !== false;
    const hr = isHR(user);
    const list = await prisma.license.findMany({
      where: { archived: false, ...(hr ? {} : { OR: [{ responsibleId: user.id }, { backupId: user.id }] }) },
      include: { responsible: { select: { name: true } } },
      orderBy: { expiresAt: 'asc' },
    });
    const today = brDateKey();
    return list
      .map((l) => {
        const d = daysUntil(l.expiresAt, today);
        return { nome: l.name, tipo: LICENSE_CATEGORY_LABEL[l.category], vence_em: l.expiresAt.toISOString().slice(0, 10), dias: d, situacao: licenseState(d, l.alertDays), responsavel: l.responsible.name, link: `/licencas?id=${l.id}` };
      })
      .filter((l) => !only || l.situacao !== 'VALID');
  },

  async documentos_assinatura(user) {
    const docs = await prisma.document.findMany({
      where: { status: 'PENDING', ...(isHR(user) ? {} : { OR: [{ createdById: user.id }, { signers: { some: { userId: user.id } } }] }) },
      include: { signers: { orderBy: { order: 'asc' } }, createdBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return docs.map((d) => ({
      titulo: d.title,
      enviado_por: d.createdBy.name,
      faltam: d.signers.filter((s) => s.status === 'PENDING').map((s) => s.name),
      assinaram: d.signers.filter((s) => s.status === 'SIGNED').map((s) => s.name),
      prazo: d.dueAt ? fmtDate(d.dueAt) : null,
      link: `/documentos/${d.id}`,
    }));
  },

  async buscar_pessoas(_user, input) {
    const q = str(input.busca) ?? '';
    const users = await prisma.user.findMany({
      where: {
        active: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { jobTitle: { contains: q, mode: 'insensitive' } },
          { department: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      select: { id: true, name: true, jobTitle: true, role: true, department: { select: { name: true } }, manager: { select: { name: true } } },
      take: 15,
    });
    return users.map((u) => ({ id: u.id, nome: u.name, cargo: u.jobTitle, perfil: ROLE_LABEL[u.role], area: u.department?.name, gestor: u.manager?.name }));
  },

  async ponto_do_dia(user, input) {
    const key = str(input.data) ?? brDateKey();
    const filtro = str(input.filtro) ?? 'todos';
    const scope = await visibleUserIds(user);
    const users = await prisma.user.findMany({
      where: { active: true, ...(scope ? { id: { in: scope } } : {}) },
      select: { id: true, name: true, workSchedule: { select: { startTime: true } } },
    });
    for (const u of users) await computeDay(u.id, key);
    const days = await prisma.timeDay.findMany({ where: { date: dateOnly(key), userId: { in: users.map((u) => u.id) } } });
    const { start, end } = dayBounds(key);
    const entries = await prisma.timeEntry.findMany({ where: { userId: { in: users.map((u) => u.id) }, at: { gte: start, lt: end } }, orderBy: { at: 'asc' } });

    let rows = users.map((u) => {
      const d = days.find((x) => x.userId === u.id);
      const es = entries.filter((e) => e.userId === u.id);
      return {
        nome: u.name,
        horario_previsto: u.workSchedule?.startTime ?? '09:00',
        entrada: es[0] ? brTime(es[0].at) : null,
        batidas: es.map((e) => `${brTime(e.at)} (${e.type})`),
        status: d ? DAY_STATUS_LABEL[d.status] : 'Ainda no horário / sem registro',
        status_code: d?.status ?? null,
        atraso: d?.lateMinutes ? formatMinutes(d.lateMinutes) : null,
        trabalhando_agora: es.length % 2 === 1,
      };
    });
    if (filtro === 'atrasados') rows = rows.filter((r) => r.status_code === 'LATE');
    if (filtro === 'faltas') rows = rows.filter((r) => r.status_code === 'ABSENT');
    if (filtro === 'presentes') rows = rows.filter((r) => r.entrada);
    return {
      data: key,
      escopo: scope ? `${scope.length} pessoa(s) visíveis para você` : 'empresa toda',
      total: rows.length,
      pessoas: rows,
    };
  },

  async resumo_ponto(user, input) {
    const ate = str(input.ate) ?? brDateKey();
    const de = str(input.de) ?? addDays(dateOnly(ate), -29).toISOString().slice(0, 10);
    let ids: string[];
    const pid = str(input.pessoa_id);
    if (pid) {
      await assertCanSee(user, pid);
      ids = [pid];
    } else {
      const scope = await visibleUserIds(user);
      ids = scope ?? (await prisma.user.findMany({ where: { active: true }, select: { id: true } })).map((u) => u.id);
    }
    const [users, days] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      prisma.timeDay.findMany({ where: { userId: { in: ids }, date: { gte: dateOnly(de), lte: dateOnly(ate) } } }),
    ]);
    return {
      periodo: `${de} a ${ate}`,
      pessoas: users.map((u) => {
        const ds = days.filter((d) => d.userId === u.id);
        const saldo = ds.reduce((a, d) => a + (d.adjustedWorkedMinutes != null ? d.adjustedWorkedMinutes - d.expectedMinutes : d.balanceMinutes), 0);
        return {
          nome: u.name,
          horas_trabalhadas: formatMinutes(ds.reduce((a, d) => a + (d.adjustedWorkedMinutes ?? d.workedMinutes), 0)),
          banco_de_horas: formatMinutes(saldo),
          atrasos: ds.filter((d) => d.status === 'LATE').length,
          minutos_de_atraso: ds.reduce((a, d) => a + d.lateMinutes, 0),
          faltas: ds.filter((d) => d.status === 'ABSENT').length,
          dias_incompletos: ds.filter((d) => d.status === 'INCOMPLETE').length,
          pendentes_validacao: ds.filter((d) => d.validation === 'PENDING' && d.status !== 'OFF').length,
          contestados: ds.filter((d) => d.validation === 'CONTESTED').length,
        };
      }),
    };
  },

  async demandas_da_pessoa(user, input) {
    const pid = str(input.pessoa_id) ?? user.id;
    if (pid !== user.id) await assertCanSee(user, pid);
    const situacao = str(input.situacao) ?? 'abertas';
    const where: Prisma.TaskWhereInput = { assigneeId: pid };
    if (situacao === 'abertas') where.status = { in: OPEN };
    if (situacao === 'atrasadas') Object.assign(where, { status: { in: OPEN }, dueAt: { lt: new Date() } });
    if (situacao === 'concluidas') Object.assign(where, { status: 'DONE', completedAt: { gte: addDays(new Date(), -30) } });
    const [person, tasks] = await Promise.all([
      prisma.user.findUnique({ where: { id: pid }, select: { name: true } }),
      prisma.task.findMany({ where, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }], take: 50, include: { createdBy: { select: { name: true } } } }),
    ]);
    const now = Date.now();
    return {
      pessoa: person?.name,
      situacao,
      total: tasks.length,
      demandas: tasks.map((t) => ({
        id: t.id,
        titulo: t.title,
        status: TASK_STATUS_LABEL[t.status],
        prioridade: TASK_PRIORITY_LABEL[t.priority],
        prazo: fmtDate(t.dueAt),
        atrasada: Boolean(t.dueAt && t.dueAt.getTime() < now && OPEN.includes(t.status)),
        enviada_por: t.createdBy.name,
        link: `/demandas?task=${t.id}`,
      })),
    };
  },

  async ranking_pendencias(user) {
    const rows = await peopleTaskMetrics(user);
    return rows.map((r) => ({
      nome: r.user.name,
      area: r.user.department?.name,
      abertas: r.open,
      atrasadas: r.overdue,
      em_andamento: r.inProgress,
      bloqueadas: r.blocked,
      concluidas_30d: r.doneLast30,
      no_prazo: r.onTimeRate === null ? null : `${Math.round(r.onTimeRate * 100)}%`,
      atrasos_ponto_30d: r.lateArrivals30,
    }));
  },

  async criar_demanda(user, input) {
    const responsavel = str(input.responsavel_id);
    const task = await createTask(user, {
      title: String(input.titulo),
      description: str(input.descricao),
      assigneeId: responsavel,
      dueAt: str(input.prazo) ? new Date(String(input.prazo)) : undefined,
      priority: (str(input.prioridade) as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT') ?? 'MEDIUM',
    });
    return { criada: true, id: task.id, titulo: task.title, responsavel: task.assignee.name, prazo: fmtDate(task.dueAt), link: `/demandas?task=${task.id}` };
  },

  async agendar_reuniao(user, input) {
    const startsAt = new Date(String(input.inicio));
    if (Number.isNaN(startsAt.getTime())) throw new ToolError('Data/hora de início inválida');
    if (startsAt.getTime() < Date.now() - 5 * 60000) throw new ToolError('Esse horário já passou');
    const duration = Number(input.duracao_minutos) || 30;
    const participantIds = Array.isArray(input.participantes_ids) ? (input.participantes_ids as string[]) : [];
    const endsAt = new Date(startsAt.getTime() + duration * 60000);
    const conflicts = await findConflicts([user.id, ...participantIds], startsAt, endsAt);
    const meeting = await createMeeting(
      user,
      {
        title: String(input.titulo),
        description: str(input.descricao),
        startsAt,
        durationMinutes: duration,
        location: str(input.local),
        videoUrl: str(input.link_video),
        participantIds,
      },
      'AI',
    );
    return {
      agendada: true,
      id: meeting.id,
      titulo: meeting.title,
      quando: `${fmtDate(meeting.startsAt)} – ${brTime(meeting.endsAt)}`,
      participantes: meeting.participants.map((p) => p.user.name),
      conflitos: conflicts.map((c) => ({ titulo: c.title, quando: fmtDate(c.startsAt), organizador: c.organizer.name })),
      link: `/agenda?meeting=${meeting.id}`,
    };
  },

  async agenda(user, input) {
    const pid = str(input.pessoa_id) ?? user.id;
    if (pid !== user.id) await assertCanSee(user, pid);
    const de = str(input.de) ?? brDateKey();
    const ate = str(input.ate) ?? addDays(dateOnly(de), 7).toISOString().slice(0, 10);
    const meetings = await prisma.meeting.findMany({
      where: {
        canceledAt: null,
        startsAt: { gte: dayBounds(de).start, lt: dayBounds(ate).end },
        participants: { some: { userId: pid } },
      },
      orderBy: { startsAt: 'asc' },
      include: { organizer: { select: { name: true } }, participants: { include: { user: { select: { name: true } } } } },
    });
    return meetings.map((m) => ({
      titulo: m.title,
      quando: `${fmtDate(m.startsAt)} – ${brTime(m.endsAt)}`,
      organizador: m.organizer.name,
      participantes: m.participants.map((p) => `${p.user.name} (${p.rsvp})`),
      local: m.location ?? m.videoUrl,
    }));
  },

  async enviar_mensagem_chat(user, input) {
    const pid = String(input.pessoa_id);
    if (pid === user.id) throw new ToolError('Não dá para mandar mensagem para si mesmo');
    const target = await prisma.user.findUnique({ where: { id: pid }, select: { id: true, name: true, active: true } });
    if (!target?.active) throw new ToolError('Pessoa não encontrada');
    const directKey = [user.id, pid].sort().join(':');
    const conv =
      (await prisma.conversation.findUnique({ where: { directKey } })) ??
      (await prisma.conversation.create({
        data: { type: 'DIRECT', directKey, createdById: user.id, members: { create: [{ userId: user.id }, { userId: pid }] } },
      }));
    const msg = await prisma.message.create({
      data: { conversationId: conv.id, senderId: user.id, body: String(input.texto) },
      include: { sender: { select: { id: true, name: true, email: true, avatarUrl: true, jobTitle: true, role: true } }, replyTo: true, reactions: true },
    });
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: msg.createdAt } });
    emitToUsers([user.id, pid], 'chat:message', msg);
    return { enviada: true, para: target.name, link: `/chat?c=${conv.id}` };
  },

  async resumo_clima(user, input) {
    const semanas = Math.min(Number(input.semanas) || 8, 26);
    const surveys = await prisma.pulseSurvey.findMany({ orderBy: { weekStart: 'desc' }, take: semanas, include: { responses: { select: { score: true } } } });
    const headcount = await prisma.user.count({ where: { active: true } });
    const series = surveys.map((s) => ({
      semana: s.weekStart.toISOString().slice(0, 10),
      media: s.responses.length ? Number((s.responses.reduce((a, r) => a + r.score, 0) / s.responses.length).toFixed(2)) : null,
      respostas: s.responses.length,
      participacao: headcount ? `${Math.round((s.responses.length / headcount) * 100)}%` : null,
    }));
    if (!isHR(user)) return { aviso: 'Detalhes de clima são restritos ao RH. Média geral:', semanas: series.map(({ semana, media }) => ({ semana, media })) };
    return { semanas: series };
  },

  async resumo_recrutamento(user, input) {
    if (user.role === 'EMPLOYEE') throw new ToolError('Recrutamento é restrito a RH e gestores.');
    const busca = str(input.busca_vaga);
    const jobs = await prisma.job.findMany({
      where: { status: { in: ['OPEN', 'PAUSED'] }, ...(busca ? { title: { contains: busca, mode: 'insensitive' } } : {}) },
      include: { applications: { select: { stage: true, createdAt: true, candidate: { select: { name: true } } }, orderBy: { createdAt: 'desc' } } },
    });
    return jobs.map((j) => ({
      vaga: j.title,
      status: j.status,
      total_candidatos: j.applications.length,
      por_etapa: Object.fromEntries(
        Object.entries(STAGE_LABEL).map(([k, label]) => [label, j.applications.filter((a) => a.stage === k).length]),
      ),
      recentes: j.applications.slice(0, 5).map((a) => `${a.candidate.name} (${STAGE_LABEL[a.stage]})`),
      link: `/admin/recrutamento/vagas/${j.id}`,
    }));
  },
};

export async function runTool(user: AuthUser, name: string, input: Input): Promise<{ content: string; isError: boolean }> {
  const handler = handlers[name];
  if (!handler) return { content: `Ferramenta desconhecida: ${name}`, isError: true };
  try {
    const result = await handler(user, input ?? {});
    return { content: JSON.stringify(result), isError: false };
  } catch (err) {
    const msg = err instanceof ToolError ? err.message : (err as Error).message || 'Erro ao executar';
    return { content: msg, isError: true };
  }
}
