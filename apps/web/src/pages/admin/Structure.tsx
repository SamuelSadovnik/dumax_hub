import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useUsers } from '@/lib/hooks';
import type { Department, Team } from '@/lib/types';
import { Avatar, AvatarStack, Button, Field, Input, Modal, PageHeader, PageLoader, Panel, Select, UserPicker } from '@/components/ui';

const COLORS = ['#2D3FE0', '#1F9254', '#C77700', '#7C3AED', '#D93036', '#0E8C9C', '#DB2777', '#0D1330'];

function DeptModal({ dept, depts, onClose }: { dept: Department | null; depts: Department[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: users = [] } = useUsers();
  const [f, setF] = useState({ name: dept?.name ?? '', description: dept?.description ?? '', color: dept?.color ?? COLORS[0], parentId: dept?.parentId ?? '', headId: dept?.headId ?? null });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, parentId: f.parentId || null, description: f.description || null };
      return dept ? api.patch(`/org/departments/${dept.id}`, body) : api.post('/org/departments', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      qc.invalidateQueries({ queryKey: ['org-chart'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={dept ? 'Editar área' : 'Nova área'} footer={<Button loading={save.isPending} disabled={f.name.length < 2} onClick={() => save.mutate()}>Salvar</Button>}>
      <div className="space-y-4">
        <Field label="Nome">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Descrição">
          <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Responsável pela área">
          <UserPicker users={users} value={f.headId} onChange={(v) => setF({ ...f, headId: v as string })} />
        </Field>
        <Field label="Área superior">
          <Select value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
            <option value="">—</option>
            {depts.filter((d) => d.id !== dept?.id).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cor">
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setF({ ...f, color: c })} className={`h-7 w-7 rounded-md ${f.color === c ? 'ring-2 ring-ink-900 ring-offset-2' : ''}`} style={{ background: c }} />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function TeamModal({ team, depts, onClose }: { team: Team | null; depts: Department[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: users = [] } = useUsers();
  const [f, setF] = useState({
    name: team?.name ?? '',
    description: team?.description ?? '',
    departmentId: team?.departmentId ?? '',
    leadId: team?.leadId ?? null,
    memberIds: team?.members.map((m) => m.user.id) ?? [],
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, departmentId: f.departmentId || null, description: f.description || null };
      return team ? api.patch(`/org/teams/${team.id}`, body) : api.post('/org/teams', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['org-chart'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={team ? 'Editar time' : 'Novo time'} footer={<Button loading={save.isPending} disabled={f.name.length < 2} onClick={() => save.mutate()}>Salvar</Button>}>
      <div className="space-y-4">
        <Field label="Nome do time">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Área">
          <Select value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>
            <option value="">—</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Líder">
          <UserPicker users={users} value={f.leadId} onChange={(v) => setF({ ...f, leadId: v as string })} />
        </Field>
        <Field label="Membros">
          <UserPicker multiple users={users} value={f.memberIds} onChange={(v) => setF({ ...f, memberIds: v as string[] })} placeholder="Adicionar pessoas" />
        </Field>
      </div>
    </Modal>
  );
}

export default function Structure() {
  const qc = useQueryClient();
  const { data: depts, isLoading } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/org/departments') });
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => api.get<Team[]>('/org/teams') });
  const [deptEdit, setDeptEdit] = useState<Department | null | undefined>(undefined);
  const [teamEdit, setTeamEdit] = useState<Team | null | undefined>(undefined);

  const removeDept = async (d: Department) => {
    if (!confirm(`Excluir a área ${d.name}? As pessoas ficam sem área.`)) return;
    await api.del(`/org/departments/${d.id}`);
    qc.invalidateQueries({ queryKey: ['departments'] });
  };
  const removeTeam = async (t: Team) => {
    if (!confirm(`Excluir o time ${t.name}?`)) return;
    await api.del(`/org/teams/${t.id}`);
    qc.invalidateQueries({ queryKey: ['teams'] });
  };

  if (isLoading || !depts) return <PageLoader />;
  return (
    <div className="space-y-5">
      <PageHeader title="Áreas e times" subtitle="Quem responde a quem é definido no cadastro de cada pessoa." />
      <Panel
        title="Áreas"
        subtitle={`${depts.length} áreas`}
        actions={
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setDeptEdit(null)}>
            Nova área
          </Button>
        }
      >
        <table className="tbl">
          <thead>
            <tr>
              <th>Área</th>
              <th>Responsável</th>
              <th>Dentro de</th>
              <th className="text-right">Pessoas</th>
              <th className="text-right">Times</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {depts.map((d) => (
              <tr key={d.id}>
                <td>
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
                    <span className="font-medium">{d.name}</span>
                  </span>
                  {d.description && <span className="block pl-[18px] text-xs text-ink-500">{d.description}</span>}
                </td>
                <td>
                  {d.head ? (
                    <span className="flex items-center gap-2">
                      <Avatar user={d.head} size={22} /> {d.head.name}
                    </span>
                  ) : (
                    <span className="text-ink-400">—</span>
                  )}
                </td>
                <td className="text-ink-600">{depts.find((p) => p.id === d.parentId)?.name ?? '—'}</td>
                <td className="num text-right">{d._count.members}</td>
                <td className="num text-right">{d._count.teams}</td>
                <td className="w-20 text-right">
                  <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setDeptEdit(d)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => removeDept(d)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title="Times"
        subtitle={`${teams.length} times`}
        actions={
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setTeamEdit(null)}>
            Novo time
          </Button>
        }
      >
        <table className="tbl">
          <thead>
            <tr>
              <th>Time</th>
              <th>Área</th>
              <th>Líder</th>
              <th>Membros</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.name}</td>
                <td className="text-ink-600">{t.department?.name ?? 'Sem área'}</td>
                <td>
                  {t.lead ? (
                    <span className="flex items-center gap-2">
                      <Avatar user={t.lead} size={22} /> {t.lead.name}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <span className="flex items-center gap-2">
                    <AvatarStack users={t.members.map((m) => m.user)} max={6} size={22} />
                    <span className="num text-xs text-ink-500">{t.members.length}</span>
                  </span>
                </td>
                <td className="w-20 text-right">
                  <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setTeamEdit(t)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => removeTeam(t)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {deptEdit !== undefined && <DeptModal dept={deptEdit} depts={depts} onClose={() => setDeptEdit(undefined)} />}
      {teamEdit !== undefined && <TeamModal team={teamEdit} depts={depts} onClose={() => setTeamEdit(undefined)} />}
    </div>
  );
}
