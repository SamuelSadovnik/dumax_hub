import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { FileSignature, FileUp, GripVertical, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { DOCUMENT_CATEGORIES, DOCUMENT_STATUS_COLOR, DOCUMENT_STATUS_LABEL } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useUsers } from '@/lib/hooks';
import type { DocumentItem } from '@/lib/types';
import { fmtBytes, fmtDate, fromNow, isoToLocalInput, localInputToIso } from '@/lib/format';
import { Avatar, AvatarStack, Badge, Button, Checkbox, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Select, Tabs, Textarea, UserPicker } from '@/components/ui';

type Box = 'to_sign' | 'sent' | 'signed' | 'all';
interface SignerDraft {
  key: string;
  userId?: string;
  name: string;
  email: string;
  cpf: string;
  role: string;
}

function NewDocumentModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: users = [] } = useUsers();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>(DOCUMENT_CATEGORIES[0]);
  const [message, setMessage] = useState('');
  const [dueAt, setDueAt] = useState(isoToLocalInput(new Date(Date.now() + 7 * 86400000).toISOString()));
  const [sequential, setSequential] = useState(false);
  const [signers, setSigners] = useState<SignerDraft[]>([]);
  const [pick, setPick] = useState<string[]>([]);
  const [tried, setTried] = useState(false);

  const addInternal = () => {
    const add = pick.filter((id) => !signers.some((s) => s.userId === id)).map((id) => {
      const u = users.find((x) => x.id === id)!;
      return { key: id, userId: id, name: u.name, email: u.email, cpf: '', role: 'Colaborador' };
    });
    setSigners((s) => [...s, ...add]);
    setPick([]);
  };
  const addExternal = () => setSigners((s) => [...s, { key: crypto.randomUUID(), name: '', email: '', cpf: '', role: 'Signatário' }]);
  const upd = (key: string, patch: Partial<SignerDraft>) => setSigners((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setSigners((s) => {
      const n = [...s];
      const j = i + d;
      if (j < 0 || j >= n.length) return s;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const errors = {
    file: !file ? 'Anexe o PDF' : null,
    title: title.trim().length < 3 ? 'Dê um título' : null,
    signers: !signers.length ? 'Adicione pelo menos uma pessoa' : signers.some((s) => !s.userId && (s.name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(s.email))) ? 'Preencha nome e e-mail de quem é de fora' : null,
  };

  const send = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('title', title.trim());
      fd.append('category', category);
      if (message) fd.append('message', message);
      if (dueAt) fd.append('dueAt', localInputToIso(dueAt));
      fd.append('sequential', String(sequential));
      fd.append('signers', JSON.stringify(signers.map((s) => (s.userId ? { userId: s.userId, role: s.role } : { name: s.name, email: s.email, cpf: s.cpf || undefined, role: s.role }))));
      fd.append('file', file!);
      return api.upload<DocumentItem>('/documents', fd);
    },
    onSuccess: (d) => {
      toast.success('Documento enviado para assinatura');
      qc.invalidateQueries({ queryKey: ['documents'] });
      onClose();
      navigate(`/documentos/${d.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Enviar documento para assinatura"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={send.isPending}
            icon={<FileSignature className="h-4 w-4" />}
            onClick={() => {
              setTried(true);
              if (!errors.file && !errors.title && !errors.signers) send.mutate();
            }}
          >
            Enviar para assinatura
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Arquivo (PDF)" required error={tried ? errors.file : null}>
          <label className={clsx('flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-4 text-sm transition hover:border-brand-300 hover:bg-brand-50/40', tried && errors.file ? 'border-bad' : 'border-ink-300')}>
            <FileUp className="h-5 w-5 text-brand-500" />
            {file ? (
              <span>
                <span className="font-medium">{file.name}</span> <span className="text-ink-500">· {fmtBytes(file.size)}</span>
              </span>
            ) : (
              <span className="text-ink-600">Clique para escolher o PDF</span>
            )}
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.pdf$/i, ''));
              }}
            />
          </label>
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
          <Field label="Título" required error={tried ? errors.title : null}>
            <Input invalid={tried && !!errors.title} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Tipo">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="label mb-0">Quem assina {tried && errors.signers && <span className="ml-2 text-xs font-normal text-bad">{errors.signers}</span>}</span>
            <Checkbox checked={sequential} onChange={setSequential} label="Assinar na ordem" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <UserPicker multiple users={users.filter((u) => !signers.some((s) => s.userId === u.id))} value={pick} onChange={(v) => setPick(v as string[])} placeholder="Colaboradores" />
            </div>
            <Button variant="secondary" icon={<Users className="h-4 w-4" />} disabled={!pick.length} onClick={addInternal}>
              Adicionar
            </Button>
            <Button variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={addExternal}>
              Pessoa de fora
            </Button>
          </div>
          {signers.length > 0 && (
            <ul className="mt-3 divide-y divide-ink-100 rounded-lg border border-ink-200">
              {signers.map((s, i) => (
                <li key={s.key} className="flex items-center gap-2 px-2 py-2">
                  {sequential ? (
                    <span className="flex flex-col">
                      <button onClick={() => move(i, -1)} className="text-ink-400 hover:text-ink-800" aria-label="Subir">
                        ▲
                      </button>
                      <button onClick={() => move(i, 1)} className="text-ink-400 hover:text-ink-800" aria-label="Descer">
                        ▼
                      </button>
                    </span>
                  ) : (
                    <GripVertical className="h-4 w-4 text-ink-300" />
                  )}
                  {sequential && <span className="num w-5 text-center text-xs font-semibold text-ink-500">{i + 1}</span>}
                  {s.userId ? (
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <Avatar user={{ id: s.userId, name: s.name, avatarUrl: null }} size={26} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{s.name}</span>
                        <span className="block truncate text-xs text-ink-500">{s.email}</span>
                      </span>
                    </span>
                  ) : (
                    <span className="grid flex-1 gap-1.5 sm:grid-cols-3">
                      <Input className="h-8" placeholder="Nome completo" value={s.name} onChange={(e) => upd(s.key, { name: e.target.value })} />
                      <Input className="h-8" placeholder="E-mail" value={s.email} onChange={(e) => upd(s.key, { email: e.target.value })} />
                      <Input className="h-8" placeholder="CPF (opcional)" value={s.cpf} onChange={(e) => upd(s.key, { cpf: e.target.value })} />
                    </span>
                  )}
                  <Select value={s.role} onChange={(e) => upd(s.key, { role: e.target.value })} className="w-36">
                    {['Colaborador', 'Signatário', 'Representante da empresa', 'Testemunha', 'Contratante', 'Contratado'].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </Select>
                  <Button variant="ghost" size="icon-sm" onClick={() => setSigners((x) => x.filter((y) => y.key !== s.key))} aria-label="Remover">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
          <Field label="Mensagem para quem assina">
            <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <Field label="Prazo">
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export default function Documents({ admin }: { admin?: boolean }) {
  const { isHR } = useAuth();
  const navigate = useNavigate();
  const [box, setBox] = useState<Box>(admin ? 'all' : 'to_sign');
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState('');
  const { data: docs, isLoading } = useQuery({ queryKey: ['documents', box], queryFn: () => api.get<DocumentItem[]>('/documents', { box }) });
  const { data: counts } = useQuery({ queryKey: ['documents', 'counts'], queryFn: () => api.get<{ toSign: number; waiting: number }>('/documents/counts') });
  const list = (docs ?? []).filter((d) => !status || d.status === status);
  const base = admin ? '/admin/documentos' : '/documentos';

  return (
    <div>
      <PageHeader
        title="Documentos"
        subtitle="Envie contratos, termos e políticas para assinatura eletrônica"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Enviar documento
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs
          size="sm"
          value={box}
          onChange={setBox}
          items={[
            { value: 'to_sign', label: 'Para eu assinar', count: counts?.toSign },
            { value: 'sent', label: 'Enviados por mim', count: counts?.waiting },
            { value: 'signed', label: 'Assinados por mim' },
            ...(isHR ? [{ value: 'all' as Box, label: 'Todos' }] : []),
          ]}
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-52">
          <option value="">Qualquer situação</option>
          {Object.entries(DOCUMENT_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <PageLoader />
      ) : !list.length ? (
        <div className="card">
          <EmptyState icon={<FileSignature />} title={box === 'to_sign' ? 'Nada para você assinar' : 'Nenhum documento'} />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl min-w-[820px]">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Assinaturas</th>
                <th>Situação</th>
                <th>Prazo</th>
                <th>Enviado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((d) => {
                const signed = d.signers.filter((s) => s.status === 'SIGNED').length;
                return (
                  <tr key={d.id} className="clickable" onClick={() => navigate(`${base}/${d.id}`)}>
                    <td>
                      <span className="block font-medium">{d.title}</span>
                      <span className="text-xs text-ink-500">{d.category}</span>
                    </td>
                    <td>
                      <span className="flex items-center gap-2">
                        <AvatarStack users={d.signers.map((s) => ({ id: s.userId ?? s.id, name: s.name, email: s.email, avatarUrl: null, jobTitle: null, role: 'EMPLOYEE' as const }))} size={22} />
                        <span className="num text-xs text-ink-600">
                          {signed}/{d.signers.length}
                        </span>
                      </span>
                    </td>
                    <td>
                      <Badge color={DOCUMENT_STATUS_COLOR[d.status]} dot>
                        {DOCUMENT_STATUS_LABEL[d.status]}
                      </Badge>
                    </td>
                    <td className="num text-[13px] text-ink-600">{d.dueAt ? fmtDate(d.dueAt) : '—'}</td>
                    <td className="text-[13px] text-ink-600">
                      {d.createdBy.name.split(' ')[0]} · {fromNow(d.createdAt)}
                    </td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      {d.myTurn && (
                        <Button size="sm" onClick={() => navigate(`/assinar/${d.signers.find((s) => s.myToken)?.myToken}`)}>
                          Assinar
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewDocumentModal onClose={() => setCreating(false)} />}
    </div>
  );
}
