import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Archive, BellRing, FileText, Paperclip, Pencil, Plus, RefreshCw, Search, X } from 'lucide-react';
import {
  LICENSE_CATEGORIES,
  LICENSE_CATEGORY_LABEL,
  LICENSE_DEFAULT_ALERTS,
  LICENSE_STATE_COLOR,
  LICENSE_STATE_LABEL,
  type LicenseCategory,
  type LicenseState,
} from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useUsers } from '@/lib/hooks';
import type { License } from '@/lib/types';
import { fmtDateTime, fmtDayKey, fmtMoney } from '@/lib/format';
import { Avatar, Badge, Button, Checkbox, Drawer, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Select, Tabs, Textarea, UserPicker } from '@/components/ui';

type Filter = 'all' | LicenseState;

function daysText(l: License) {
  if (l.daysLeft < 0) return `vencida há ${-l.daysLeft} dia${l.daysLeft === -1 ? '' : 's'}`;
  if (l.daysLeft === 0) return 'vence hoje';
  return `${l.daysLeft} dia${l.daysLeft === 1 ? '' : 's'}`;
}

// ───────────── Formulário (nova / editar) ─────────────
function LicenseForm({ license, onClose }: { license?: License; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: users = [] } = useUsers();
  const [f, setF] = useState({
    name: license?.name ?? '',
    category: (license?.category ?? 'ALVARA') as LicenseCategory,
    number: license?.number ?? '',
    issuer: license?.issuer ?? '',
    description: license?.description ?? '',
    issuedAt: license?.issuedAt?.slice(0, 10) ?? '',
    expiresAt: license?.expiresAt.slice(0, 10) ?? '',
    responsibleId: license?.responsibleId ?? '',
    backupId: license?.backupId ?? '',
    alertDays: license?.alertDays ?? LICENSE_DEFAULT_ALERTS,
    notifyEmails: (license?.notifyEmails ?? []).join(', '),
    notifyAdmins: license?.notifyAdmins ?? true,
    cost: license?.cost?.toString() ?? '',
  });
  const [newDay, setNewDay] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const errors = {
    name: f.name.trim().length < 2 ? 'Informe o nome' : null,
    expiresAt: !f.expiresAt ? 'Informe a validade' : null,
    responsibleId: !f.responsibleId ? 'Escolha quem cuida desta licença' : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const save = async () => {
    setTried(true);
    if (invalid) return;
    setSaving(true);
    const data = {
      name: f.name.trim(),
      category: f.category,
      number: f.number || null,
      issuer: f.issuer || null,
      description: f.description || null,
      issuedAt: f.issuedAt || null,
      expiresAt: f.expiresAt,
      responsibleId: f.responsibleId,
      backupId: f.backupId || null,
      alertDays: f.alertDays,
      notifyEmails: f.notifyEmails.split(/[,;\s]+/).filter(Boolean),
      notifyAdmins: f.notifyAdmins,
      cost: f.cost ? Number(f.cost.replace(',', '.')) : null,
    };
    const form = new FormData();
    form.append('data', JSON.stringify(data));
    if (file) form.append('file', file);
    try {
      if (license) await api.patchForm(`/licenses/${license.id}`, form);
      else await api.upload('/licenses', form);
      toast.success(license ? 'Licença atualizada' : 'Licença cadastrada');
      qc.invalidateQueries({ queryKey: ['licenses'] });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={license ? `Editar ${license.name}` : 'Nova licença'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={save}>
            {license ? 'Salvar alterações' : 'Cadastrar licença'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" required error={tried ? errors.name : null} className="sm:col-span-2">
          <Input autoFocus value={f.name} invalid={tried && !!errors.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Alvará de funcionamento — matriz" />
        </Field>
        <Field label="Tipo">
          <Select value={f.category} onChange={(e) => set('category', e.target.value as LicenseCategory)}>
            {LICENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {LICENSE_CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Número / protocolo">
          <Input value={f.number} onChange={(e) => set('number', e.target.value)} />
        </Field>
        <Field label="Órgão emissor">
          <Input value={f.issuer} onChange={(e) => set('issuer', e.target.value)} placeholder="Ex.: Prefeitura de Cascavel" />
        </Field>
        <Field label="Custo da renovação (R$)">
          <Input inputMode="decimal" value={f.cost} onChange={(e) => set('cost', e.target.value)} />
        </Field>
        <Field label="Emitida em">
          <Input type="date" value={f.issuedAt} onChange={(e) => set('issuedAt', e.target.value)} />
        </Field>
        <Field label="Vence em" required error={tried ? errors.expiresAt : null}>
          <Input type="date" value={f.expiresAt} invalid={tried && !!errors.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
        </Field>
        <Field label="Responsável" required error={tried ? errors.responsibleId : null}>
          <UserPicker users={users} value={f.responsibleId || null} invalid={tried && !!errors.responsibleId} onChange={(v) => set('responsibleId', (v as string) ?? '')} />
        </Field>
        <Field label="Substituto" hint="Recebe os mesmos avisos">
          <UserPicker users={users} value={f.backupId || null} onChange={(v) => set('backupId', (v as string) ?? '')} placeholder="Ninguém" />
        </Field>

        <Field label="Avisar quantos dias antes" className="sm:col-span-2" hint="Cada aviso é enviado uma vez, por notificação e e-mail">
          <div className="flex flex-wrap items-center gap-1.5">
            {[...f.alertDays].sort((a, b) => b - a).map((d) => (
              <span key={d} className="num inline-flex items-center gap-1 rounded-md bg-brand-50 py-1 pl-2 pr-1 text-xs font-medium text-brand-700">
                {d === 0 ? 'no dia' : `${d} dias`}
                <button onClick={() => set('alertDays', f.alertDays.filter((x) => x !== d))} className="rounded p-0.5 hover:bg-brand-100">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(newDay);
                if (Number.isInteger(n) && n >= 0 && n <= 730 && !f.alertDays.includes(n)) set('alertDays', [...f.alertDays, n]);
                setNewDay('');
              }}
            >
              <Input value={newDay} onChange={(e) => setNewDay(e.target.value.replace(/\D/g, ''))} placeholder="dias" className="h-7 w-16 text-xs" />
              <Button type="submit" size="sm" variant="secondary">
                Adicionar
              </Button>
            </form>
          </div>
        </Field>
        <Field label="E-mails extras" hint="Contador, despachante… separados por vírgula" className="sm:col-span-2">
          <Input value={f.notifyEmails} onChange={(e) => set('notifyEmails', e.target.value)} placeholder="contabilidade@escritorio.com.br" />
        </Field>
        <Checkbox className="sm:col-span-2" checked={f.notifyAdmins} onChange={(v) => set('notifyAdmins', v)} label="Avisar também RH e diretoria" />
        <Field label="Observações" className="sm:col-span-2">
          <Textarea value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="O que precisa para renovar, onde fica o original…" />
        </Field>
        <Field label="Arquivo da licença" className="sm:col-span-2" hint={license?.fileName ? `Atual: ${license.fileName}` : 'PDF ou imagem, até 10 MB'}>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-ink-300 px-3 py-2.5 text-sm text-ink-600 hover:border-brand-300">
            <Paperclip className="h-4 w-4" /> {file ? file.name : 'Escolher arquivo'}
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </Field>
      </div>
    </Modal>
  );
}

// ───────────── Renovar ─────────────
function RenewModal({ license, onClose }: { license: License; onClose: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState('');
  const [number, setNumber] = useState(license.number ?? '');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const invalid = !date || date <= license.expiresAt.slice(0, 10);

  const save = async () => {
    setSaving(true);
    const form = new FormData();
    form.append('data', JSON.stringify({ newExpiresAt: date, note: note || undefined, number: number || undefined }));
    if (file) form.append('file', file);
    try {
      await api.upload(`/licenses/${license.id}/renew`, form);
      toast.success('Renovação registrada');
      qc.invalidateQueries({ queryKey: ['licenses'] });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Renovar ${license.name}`}
      footer={
        <Button loading={saving} disabled={invalid} onClick={save}>
          Registrar renovação
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Validade atual: <span className="num font-medium">{fmtDayKey(license.expiresAt, 'dd/MM/yyyy')}</span>
        </p>
        <Field label="Nova validade" required error={date && invalid ? 'Precisa ser depois da validade atual' : null}>
          <Input type="date" autoFocus value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Número / protocolo novo">
          <Input value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field label="Observação">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-ink-300 px-3 py-2.5 text-sm text-ink-600 hover:border-brand-300">
          <Paperclip className="h-4 w-4" /> {file ? file.name : 'Anexar nova licença'}
          <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
    </Modal>
  );
}

// ───────────── Detalhe ─────────────
function LicenseDrawer({ license, onClose, onEdit, onRenew, canEdit }: { license: License; onClose: () => void; onEdit: () => void; onRenew: () => void; canEdit: boolean }) {
  const qc = useQueryClient();
  const archive = async () => {
    await api.patchForm(`/licenses/${license.id}`, (() => {
      const f = new FormData();
      f.append('data', JSON.stringify({ archived: !license.archived }));
      return f;
    })());
    qc.invalidateQueries({ queryKey: ['licenses'] });
    onClose();
  };
  const color = LICENSE_STATE_COLOR[license.state];

  return (
    <Drawer open onClose={onClose} width={520}>
      <div className="flex h-full flex-col">
        <header className="border-b border-ink-100 px-6 py-5">
          <p className="text-xs text-ink-500">{LICENSE_CATEGORY_LABEL[license.category]}</p>
          <h2 className="mt-0.5 text-lg font-semibold">{license.name}</h2>
          <div className="mt-3 flex items-center gap-3">
            <Badge color={color} dot>
              {LICENSE_STATE_LABEL[license.state]}
            </Badge>
            <span className="num text-sm" style={{ color }}>
              {fmtDayKey(license.expiresAt, 'dd/MM/yyyy')} · {daysText(license)}
            </span>
          </div>
          {canEdit && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRenew}>
                Renovar
              </Button>
              <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>
                Editar
              </Button>
              {license.fileName && (
                <Button size="sm" variant="secondary" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => api.openFile(`/licenses/${license.id}/file`).catch((e) => toast.error(errorMessage(e)))}>
                  Ver arquivo
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Archive className="h-3.5 w-3.5" />} onClick={archive}>
                {license.archived ? 'Restaurar' : 'Arquivar'}
              </Button>
            </div>
          )}
        </header>
        <div className="scroll-thin flex-1 space-y-6 overflow-y-auto px-6 py-5 text-sm">
          <dl className="grid grid-cols-[140px_1fr] gap-y-2">
            <dt className="text-ink-500">Responsável</dt>
            <dd className="flex items-center gap-2">
              <Avatar user={license.responsible} size={22} /> {license.responsible.name}
            </dd>
            <dt className="text-ink-500">Substituto</dt>
            <dd className="flex items-center gap-2">
              {license.backup ? (
                <>
                  <Avatar user={license.backup} size={22} /> {license.backup.name}
                </>
              ) : (
                '—'
              )}
            </dd>
            <dt className="text-ink-500">Número</dt>
            <dd className="num">{license.number ?? '—'}</dd>
            <dt className="text-ink-500">Órgão</dt>
            <dd>{license.issuer ?? '—'}</dd>
            <dt className="text-ink-500">Emitida em</dt>
            <dd className="num">{license.issuedAt ? fmtDayKey(license.issuedAt, 'dd/MM/yyyy') : '—'}</dd>
            <dt className="text-ink-500">Custo</dt>
            <dd className="num">{license.cost != null ? fmtMoney(license.cost) : '—'}</dd>
            <dt className="text-ink-500">Avisos</dt>
            <dd className="num">
              {[...license.alertDays].sort((a, b) => b - a).map((d) => (d === 0 ? 'no dia' : `${d}d`)).join(' · ')}
              <span className="block text-xs text-ink-500">
                {[license.notifyAdmins && 'RH e diretoria', ...license.notifyEmails].filter(Boolean).join(', ') || 'só responsáveis'}
              </span>
            </dd>
          </dl>
          {license.description && <p className="whitespace-pre-wrap rounded-md bg-ink-50 p-3 text-ink-700">{license.description}</p>}
          <section>
            <h3 className="mb-2 font-medium">Histórico de renovações</h3>
            {license.renewals.length ? (
              <ol className="space-y-3 border-l border-ink-200 pl-4">
                {license.renewals.map((r) => (
                  <li key={r.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-ok" />
                    <p className="num">
                      {fmtDayKey(r.previousExpiresAt, 'dd/MM/yy')} → <span className="font-medium">{fmtDayKey(r.newExpiresAt, 'dd/MM/yyyy')}</span>
                    </p>
                    <p className="text-xs text-ink-500">
                      {r.renewedBy.name} · {fmtDateTime(r.createdAt)}
                    </p>
                    {r.note && <p className="mt-1 text-ink-700">{r.note}</p>}
                    {r.fileName && (
                      <button className="mt-1 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline" onClick={() => api.openFile(`/licenses/${license.id}/file?renewalId=${r.id}`)}>
                        <Paperclip className="h-3 w-3" /> {r.fileName}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-ink-500">Nenhuma renovação registrada ainda.</p>
            )}
          </section>
        </div>
      </div>
    </Drawer>
  );
}

// ───────────── Página ─────────────
export default function Licenses({ admin }: { admin?: boolean }) {
  const { isHR, user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<License | 'new' | null>(null);
  const [renewing, setRenewing] = useState<License | null>(null);
  const { data: list, isLoading } = useQuery({ queryKey: ['licenses', archived], queryFn: () => api.get<License[]>('/licenses', { archived }) });

  const openId = params.get('id');
  const open = list?.find((l) => l.id === openId) ?? null;
  const setOpen = (id: string | null) => setParams(id ? { id } : {}, { replace: true });
  const canCreate = isHR || user?.role === 'MANAGER';
  const canEdit = (l: License) => isHR || l.responsibleId === user?.id || l.backupId === user?.id;

  useEffect(() => {
    if (editing && editing !== 'new') setEditing(list?.find((l) => l.id === editing.id) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const counts = useMemo(() => {
    const c = { all: list?.length ?? 0, EXPIRED: 0, EXPIRING: 0, VALID: 0 };
    list?.forEach((l) => c[l.state]++);
    return c;
  }, [list]);
  const rows = (list ?? []).filter((l) => (filter === 'all' || l.state === filter) && `${l.name} ${l.number ?? ''} ${l.issuer ?? ''} ${l.responsible.name}`.toLowerCase().includes(q.toLowerCase()));

  const runAlerts = async () => {
    const r = await api.post<{ checked: number; sent: number }>('/licenses/run-alerts');
    toast.success(r.sent ? `${r.sent} aviso(s) enviados` : 'Nenhum aviso pendente hoje');
    qc.invalidateQueries({ queryKey: ['licenses'] });
  };

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Licenças e vencimentos"
        subtitle={admin || isHR ? 'Alvarás, certificados, contratos e seguros da empresa' : 'Licenças sob a sua responsabilidade'}
        actions={
          <>
            {isHR && (
              <Button variant="secondary" icon={<BellRing className="h-4 w-4" />} onClick={runAlerts}>
                Disparar avisos
              </Button>
            )}
            {canCreate && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                Nova licença
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-ink-200 bg-white">
        {(['EXPIRED', 'EXPIRING', 'VALID'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(filter === s ? 'all' : s)}
            className={clsx('border-r border-ink-100 px-5 py-4 text-left last:border-0 hover:bg-ink-50', filter === s && 'bg-ink-50')}
          >
            <p className="flex items-center gap-2 text-[13px] text-ink-500">
              <span className="h-2 w-2 rounded-full" style={{ background: LICENSE_STATE_COLOR[s] }} />
              {LICENSE_STATE_LABEL[s]}
            </p>
            <p className="num mt-1 text-2xl font-semibold" style={{ color: s === 'VALID' ? undefined : counts[s] ? LICENSE_STATE_COLOR[s] : undefined }}>
              {counts[s]}
            </p>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-4 py-2.5">
          <Tabs
            size="sm"
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all', label: 'Todas', count: counts.all },
              { value: 'EXPIRED', label: 'Vencidas', count: counts.EXPIRED },
              { value: 'EXPIRING', label: 'Vencendo', count: counts.EXPIRING },
              { value: 'VALID', label: 'Em dia', count: counts.VALID },
            ]}
          />
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" className="h-8 w-56 pl-8" />
          </div>
          <Checkbox checked={archived} onChange={setArchived} label="Arquivadas" />
        </div>
        {rows.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Licença</th>
                <th>Tipo</th>
                <th>Responsável</th>
                <th className="text-right">Vencimento</th>
                <th className="text-right">Prazo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} onClick={() => setOpen(l.id)} className="cursor-pointer">
                  <td>
                    <span className="flex items-center gap-2.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LICENSE_STATE_COLOR[l.state] }} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{l.name}</span>
                        <span className="block truncate text-xs text-ink-500">{[l.number, l.issuer].filter(Boolean).join(' · ') || '—'}</span>
                      </span>
                    </span>
                  </td>
                  <td className="text-ink-600">{LICENSE_CATEGORY_LABEL[l.category]}</td>
                  <td>
                    <span className="flex items-center gap-2">
                      <Avatar user={l.responsible} size={22} />
                      <span className="truncate">{l.responsible.name}</span>
                    </span>
                  </td>
                  <td className="num text-right">{fmtDayKey(l.expiresAt, 'dd/MM/yyyy')}</td>
                  <td className="num text-right font-medium" style={{ color: l.state === 'VALID' ? undefined : LICENSE_STATE_COLOR[l.state] }}>
                    {daysText(l)}
                  </td>
                  <td className="w-24 text-right">
                    {canEdit(l) && l.state !== 'VALID' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenewing(l);
                        }}
                      >
                        Renovar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState compact title={list?.length ? 'Nada com esse filtro' : 'Nenhuma licença cadastrada'} text={list?.length ? undefined : 'Cadastre alvarás, AVCB, certificados e contratos para receber os avisos de vencimento.'} />
        )}
      </div>

      {open && <LicenseDrawer license={open} canEdit={canEdit(open)} onClose={() => setOpen(null)} onEdit={() => setEditing(open)} onRenew={() => setRenewing(open)} />}
      {editing && <LicenseForm license={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {renewing && <RenewModal license={renewing} onClose={() => setRenewing(null)} />}
    </div>
  );
}
