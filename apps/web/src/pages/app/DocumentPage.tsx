import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ArrowLeft, Award, Bell, Check, Copy, Download, Eye, Mail, X } from 'lucide-react';
import { DOCUMENT_STATUS_COLOR, DOCUMENT_STATUS_LABEL, SIGNER_STATUS_LABEL } from '@dumax/shared';
import { api, errorMessage, tokenStore } from '@/lib/api';
import type { DocumentItem } from '@/lib/types';
import { fmtBytes, fmtDateTime } from '@/lib/format';
import { Avatar, Badge, Button, PageLoader, Panel } from '@/components/ui';

const EVENT_LABEL: Record<string, string> = {
  CREATED: 'criou o documento',
  SENT: 'enviou para assinatura',
  VIEWED: 'abriu o documento',
  SIGNED: 'assinou',
  DECLINED: 'recusou assinar',
  COMPLETED: 'Todas as assinaturas concluídas',
  CANCELED: 'cancelou o documento',
  REMINDED: 'enviou lembrete',
};

/** PDF protegido: baixa com o token e mostra num iframe */
export function useProtectedPdf(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let revoked: string | null = null;
    fetch(`/api${path}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => {
        revoked = URL.createObjectURL(b);
        setUrl(revoked);
      })
      .catch(() => setUrl(null));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [path]);
  return url;
}

export default function DocumentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: doc, isLoading } = useQuery({ queryKey: ['document', id], queryFn: () => api.get<DocumentItem>(`/documents/${id}`) });
  const pdf = useProtectedPdf(doc ? `/documents/${doc.id}/file` : null);

  if (isLoading || !doc) return <PageLoader />;
  const signed = doc.signers.filter((s) => s.status === 'SIGNED').length;
  const mine = doc.signers.find((s) => s.myToken);
  const canSignNow = doc.status === 'PENDING' && mine?.status === 'PENDING' && (!doc.sequential || doc.signers.filter((s) => s.status === 'PENDING')[0]?.id === mine.id);

  const remind = async () => {
    try {
      const r = await api.post<{ reminded: number }>(`/documents/${doc.id}/remind`);
      toast.success(`Lembrete enviado para ${r.reminded} pessoa(s)`);
      qc.invalidateQueries({ queryKey: ['document', id] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const cancel = async () => {
    if (!confirm('Cancelar este documento? Quem ainda não assinou não poderá mais assinar.')) return;
    await api.post(`/documents/${doc.id}/cancel`);
    qc.invalidateQueries({ queryKey: ['document', id] });
    qc.invalidateQueries({ queryKey: ['documents'] });
  };

  return (
    <div className="space-y-5">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Documentos
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold">{doc.title}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-500">
            <Badge color={DOCUMENT_STATUS_COLOR[doc.status]} dot>
              {DOCUMENT_STATUS_LABEL[doc.status]}
            </Badge>
            {doc.category} · enviado por {doc.createdBy.name} em {fmtDateTime(doc.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSignNow && mine?.myToken && <Button onClick={() => navigate(`/assinar/${mine.myToken}`)}>Revisar e assinar</Button>}
          {doc.status === 'COMPLETED' && (
            <Link to={`/documentos/${doc.id}/certificado`} target="_blank">
              <Button variant="secondary" icon={<Award className="h-4 w-4" />}>
                Certificado de assinaturas
              </Button>
            </Link>
          )}
          {pdf && (
            <a href={pdf} download={doc.fileName}>
              <Button variant="secondary" icon={<Download className="h-4 w-4" />}>
                Baixar PDF
              </Button>
            </a>
          )}
          {doc.canManage && doc.status === 'PENDING' && (
            <>
              <Button variant="secondary" icon={<Bell className="h-4 w-4" />} onClick={remind}>
                Lembrar quem falta
              </Button>
              <Button variant="ghost" icon={<X className="h-4 w-4" />} onClick={cancel}>
                Cancelar
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="card overflow-hidden">
          {pdf ? <iframe title="Documento" src={pdf} className="h-[75vh] w-full" /> : <div className="flex h-[60vh] items-center justify-center text-sm text-ink-500">Carregando PDF…</div>}
        </div>

        <div className="space-y-5">
          <Panel title="Assinaturas" subtitle={`${signed} de ${doc.signers.length}${doc.sequential ? ' · em ordem' : ''}`}>
            <ul>
              {doc.signers.map((s, i) => (
                <li key={s.id} className="flex items-center gap-3 border-b border-ink-100 px-4 py-3 last:border-0">
                  {doc.sequential && <span className="num w-4 text-xs text-ink-400">{i + 1}</span>}
                  <Avatar user={{ id: s.userId ?? s.id, name: s.name, avatarUrl: null }} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-ink-500">
                      {s.role} · {s.userId ? 'colaborador' : s.email}
                    </span>
                    {s.signedAt && <span className="num block text-2xs text-ok">assinou em {fmtDateTime(s.signedAt)}</span>}
                    {s.declineReason && <span className="block text-2xs text-bad">recusou: {s.declineReason}</span>}
                    {!s.signedAt && s.viewedAt && (
                      <span className="flex items-center gap-1 text-2xs text-ink-400">
                        <Eye className="h-3 w-3" /> visualizou {fmtDateTime(s.viewedAt)}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    {s.status === 'SIGNED' ? (
                      <Check className="h-4 w-4 text-ok" />
                    ) : (
                      <Badge tone={s.status === 'DECLINED' ? 'bad' : 'neutral'}>{SIGNER_STATUS_LABEL[s.status]}</Badge>
                    )}
                    {doc.canManage && s.status === 'PENDING' && s.signUrl && !s.userId && (
                      <button
                        title="Copiar link de assinatura"
                        onClick={async () => {
                          await navigator.clipboard.writeText(s.signUrl!);
                          toast.success('Link copiado — envie para a pessoa');
                        }}
                        className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Trilha de auditoria">
            <ol className="space-y-2.5 px-4 py-3">
              {(doc.events ?? []).map((e) => (
                <li key={e.id} className="flex gap-2 text-[13px]">
                  <span className={clsx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', e.type === 'SIGNED' || e.type === 'COMPLETED' ? 'bg-ok' : e.type === 'DECLINED' || e.type === 'CANCELED' ? 'bg-bad' : 'bg-ink-300')} />
                  <span>
                    {e.type !== 'COMPLETED' && <span className="font-medium">{e.actorName} </span>}
                    {EVENT_LABEL[e.type] ?? e.type}
                    <span className="num block text-2xs text-ink-400">
                      {fmtDateTime(e.createdAt)}
                      {e.ip ? ` · IP ${e.ip}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Integridade do arquivo">
            <div className="space-y-1.5 px-4 py-3 text-[13px]">
              <p className="text-ink-600">
                {doc.fileName} · {fmtBytes(doc.fileSize)}
              </p>
              <p className="text-ink-500">SHA-256 do original</p>
              <p className="break-all font-mono text-2xs text-ink-700">{doc.fileHash}</p>
              <a href={`/verificar/${doc.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                <Mail className="h-3.5 w-3.5" /> Página pública de verificação
              </a>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
