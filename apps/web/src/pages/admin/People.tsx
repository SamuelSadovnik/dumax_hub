import { useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Pencil, Plus, Search, UserX } from 'lucide-react';
import { PROFILES, ROLES, ROLE_LABEL, type ProfileKey, type Role, LEVELS, LEVEL_LABEL } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import type { Department, DirectoryUser, UserDetail } from '@/lib/types';
import { fromNow } from '@/lib/format';
import { Avatar, Badge, Button, Checkbox, Field, Input, Modal, PageHeader, PageLoader, Select, UserPicker } from '@/components/ui';
import { AvatarUpload } from '@/components/AvatarUpload';
import { confirmDialog } from '@/components/ConfirmDialog';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function PersonModal({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({ queryKey: ['users-all'], queryFn: () => api.get<DirectoryUser[]>('/users', { includeInactive: true }) });
  const { data: depts = [] } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/org/departments') });
  const { data: existing, isLoading } = useQuery({ queryKey: ['user', userId], queryFn: () => api.get<UserDetail>(`/users/${userId}`), enabled: Boolean(userId) });

  if (userId && (isLoading || !existing)) return null;
  return <PersonForm key={userId ?? 'new'} existing={existing ?? null} users={users} depts={depts} meRole={me.role} onClose={onClose} onSaved={() => qc.invalidateQueries()} />;
}

function PersonForm({ existing, users, depts, meRole, onClose, onSaved }: { existing: UserDetail | null; users: DirectoryUser[]; depts: Department[]; meRole: Role; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: existing?.name ?? '',
    email: existing?.email ?? '',
    role: existing?.role ?? ('EMPLOYEE' as Role),
    jobTitle: existing?.jobTitle ?? '',
    level: existing?.level ?? '',
    phone: existing?.phone ?? '',
    managerId: existing?.managerId ?? null,
    departmentId: existing?.departmentId ?? '',
    pontoCode: existing?.pontoCode ?? '',
    hiredAt: existing?.hiredAt?.slice(0, 10) ?? '',
    active: existing?.active ?? true,
  });
  const [schedule, setSchedule] = useState(existing?.workSchedule ?? { startTime: '09:00', endTime: '18:00', breakMinutes: 60, toleranceMinutes: 10, workDays: [1, 2, 3, 4, 5] });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...f,
        jobTitle: f.jobTitle || null,
        level: f.level || null,
        phone: f.phone || null,
        departmentId: f.departmentId || null,
        pontoCode: f.pontoCode || null,
        hiredAt: f.hiredAt || null,
      };
      if (existing) {
        await api.patch(`/users/${existing.id}`, body);
        await api.put(`/users/${existing.id}/schedule`, { ...schedule });
        return null;
      }
      const { active: _a, ...create } = body;
      const res = await api.post<{ user: { id: string }; temporaryPassword?: string }>('/users', create);
      await api.put(`/users/${res.user.id}/schedule`, { ...schedule });
      return res.temporaryPassword ?? null;
    },
    onSuccess: (pwd) => {
      if (pwd) toast.success(`Usuário criado. Senha provisória: ${pwd}`, { duration: 20000 });
      else toast.success('Salvo');
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = async () => {
    if (existing?.active && !f.active) {
      const ok = await confirmDialog({
        title: `Desligar ${existing.name.split(' ')[0]}?`,
        description: 'A pessoa perde o acesso ao Hub na hora e sai das listas, do organograma e dos indicadores. O histórico fica guardado e dá para reativar depois.',
        confirmLabel: 'Desligar',
        tone: 'danger',
      });
      if (!ok) return;
    }
    save.mutate();
  };

  const resetPwd = async () => {
    const ok = await confirmDialog({
      title: 'Gerar uma nova senha?',
      description: `A senha atual de ${existing!.name.split(' ')[0]} para de funcionar. A nova aparece aqui para você repassar.`,
      confirmLabel: 'Gerar senha',
      tone: 'warn',
    });
    if (!ok) return;
    const r = await api.post<{ temporaryPassword: string }>(`/users/${existing!.id}/reset-password`);
    toast.success(`Nova senha provisória: ${r.temporaryPassword}`, { duration: 20000 });
  };

  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={existing ? existing.name : 'Nova pessoa'}
      footer={
        <>
          {existing && (
            <Button variant="ghost" icon={<KeyRound className="h-4 w-4" />} onClick={resetPwd}>
              Resetar senha
            </Button>
          )}
          <Button loading={save.isPending} disabled={f.name.length < 2 || !f.email} onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      {existing && (
        <div className="mb-5 border-b border-ink-100 pb-5">
          <AvatarUpload user={existing} endpoint={`/users/${existing.id}/avatar`} size={72} onChange={onSaved} />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome">
          <Input value={f.name} onChange={set('name')} />
        </Field>
        <Field label="E-mail">
          <Input type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Cargo">
          <Input value={f.jobTitle} onChange={set('jobTitle')} />
        </Field>
        <Field label="Nível" hint="Aparece no organograma">
          <Select value={f.level} onChange={set('level')}>
            <option value="">Definir pelo cargo</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABEL[l]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Perfil de acesso">
          <Select value={f.role} onChange={set('role')}>
            {ROLES.filter((r) => r !== 'ADMIN' || meRole === 'ADMIN').map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Área">
          <Select value={f.departmentId} onChange={set('departmentId')}>
            <option value="">—</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responde a (gestor)">
          <UserPicker users={users.filter((u) => u.id !== existing?.id && u.active)} value={f.managerId} onChange={(v) => setF({ ...f, managerId: v as string })} placeholder="Sem gestor" />
        </Field>
        <Field label="Telefone">
          <Input value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Admissão">
          <Input type="date" value={f.hiredAt} onChange={set('hiredAt')} />
        </Field>
        <Field label="Código no sistema de ponto" hint="Matrícula/PIS usado pela API de ponto">
          <Input value={f.pontoCode} onChange={set('pontoCode')} />
        </Field>
        {existing && (
          <Checkbox className="self-end pb-2" checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Ativo (desmarque para desligar)" />
        )}
      </div>
      <div className="mt-6 rounded-lg border border-ink-200 p-4">
        <p className="mb-3 text-sm font-medium">Jornada de trabalho</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Entrada">
            <Input type="time" value={schedule.startTime} onChange={(e) => setSchedule({ ...schedule, startTime: e.target.value })} />
          </Field>
          <Field label="Saída">
            <Input type="time" value={schedule.endTime} onChange={(e) => setSchedule({ ...schedule, endTime: e.target.value })} />
          </Field>
          <Field label="Intervalo (min)">
            <Input type="number" value={schedule.breakMinutes} onChange={(e) => setSchedule({ ...schedule, breakMinutes: Number(e.target.value) })} />
          </Field>
          <Field label="Tolerância (min)">
            <Input type="number" value={schedule.toleranceMinutes} onChange={(e) => setSchedule({ ...schedule, toleranceMinutes: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="mt-3 flex gap-1">
          {WEEKDAYS.map((d, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSchedule({ ...schedule, workDays: schedule.workDays.includes(i) ? schedule.workDays.filter((x) => x !== i) : [...schedule.workDays, i].sort() })}
              className={`h-8 w-8 rounded-md text-xs font-medium ${schedule.workDays.includes(i) ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-500'}`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export default function People() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const { data: users, isLoading } = useQuery({ queryKey: ['users-all'], queryFn: () => api.get<DirectoryUser[]>('/users', { includeInactive: true }) });
  const { data: depts = [] } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/org/departments') });
  const { data: map } = useQuery({ queryKey: ['profile-map', ''], queryFn: () => api.get<{ people: { user: { id: string }; primary: ProfileKey }[] }>('/profiles/map') });
  const profileOf = new Map((map?.people ?? []).map((p) => [p.user.id, p.primary]));
  const list = (users ?? []).filter((u) => (showInactive || u.active) && (!dept || u.departmentId === dept) && `${u.name} ${u.email} ${u.jobTitle ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const nameOf = (id: string | null) => users?.find((u) => u.id === id)?.name ?? '—';
  const active = users?.filter((u) => u.active).length ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pessoas"
        subtitle={`${active} ativas · ${profileOf.size} com teste de perfil`}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>
            Nova pessoa
          </Button>
        }
      />
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-4 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input className="h-8 w-64 pl-8" placeholder="Buscar nome, e-mail ou cargo" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={dept} onChange={(e) => setDept(e.target.value)} className="h-8 w-48">
            <option value="">Todas as áreas</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <span className="text-xs text-ink-500">{list.length} pessoas</span>
          <Checkbox className="ml-auto" checked={showInactive} onChange={setShowInactive} label="Mostrar desligados" />
        </div>
        {isLoading ? (
          <PageLoader />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[860px]">
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>Área</th>
                  <th>Responde a</th>
                  <th>Perfil</th>
                  <th>Acesso</th>
                  <th>Visto</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((u) => {
                  const p = profileOf.get(u.id);
                  return (
                    <tr key={u.id} className={clsx('cursor-pointer', !u.active && 'opacity-60')} onClick={() => navigate(`/admin/desempenho/${u.id}`)}>
                      <td>
                        <span className="flex items-center gap-2.5">
                          <Avatar user={u} size={30} online={u.online} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-medium">
                              {u.name} {!u.active && <UserX className="h-3.5 w-3.5 text-bad" />}
                            </span>
                            <span className="block truncate text-xs text-ink-500">{[u.jobTitle, u.email].filter(Boolean).join(' · ')}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        {u.department ? (
                          <span className="flex items-center gap-1.5 text-ink-700">
                            <span className="h-2 w-2 rounded-full" style={{ background: u.department.color }} />
                            {u.department.name}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-ink-600">{nameOf(u.managerId)}</td>
                      <td>
                        {p ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ background: PROFILES[p].color }} />
                            {PROFILES[p].label}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-400">sem teste</span>
                        )}
                      </td>
                      <td>
                        <Badge>{ROLE_LABEL[u.role]}</Badge>
                      </td>
                      <td className="text-xs text-ink-500">{u.online ? <span className="font-medium text-ok">online</span> : u.lastSeenAt ? fromNow(u.lastSeenAt) : '—'}</td>
                      <td className="text-right">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Editar cadastro"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(u.id);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing !== undefined && <PersonModal userId={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
