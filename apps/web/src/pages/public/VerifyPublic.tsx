import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileSearch, XCircle } from 'lucide-react';
import { DOCUMENT_STATUS_COLOR, DOCUMENT_STATUS_LABEL, SIGNER_STATUS_LABEL } from '@dumax/shared';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Badge, EmptyState, PageLoader } from '@/components/ui';
import { PublicHeader } from './Careers';

interface Verify {
  id: string;
  title: string;
  category: string;
  status: keyof typeof DOCUMENT_STATUS_LABEL;
  fileName: string;
  fileHash: string;
  createdAt: string;
  completedAt: string | null;
  createdBy: string;
  signers: { id: string; name: string; role: string; status: keyof typeof SIGNER_STATUS_LABEL; signedAt: string | null }[];
}

async function sha256(file: File) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Verificação pública: confere se um PDF é exatamente o que foi assinado */
export default function VerifyPublic() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuery({ queryKey: ['verify', id], queryFn: () => api.get<Verify>(`/public/documents/${id}/verify`), retry: false });
  const [match, setMatch] = useState<boolean | null>(null);

  if (isLoading) return <PageLoader />;
  if (error || !data)
    return (
      <div className="min-h-screen bg-canvas">
        <PublicHeader />
        <EmptyState title="Documento não encontrado" text="Confira o código de verificação." />
      </div>
    );

  return (
    <div className="min-h-screen bg-canvas">
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-5 py-10">
        <p className="text-sm text-ink-500">Verificação de documento</p>
        <h1 className="mt-1 text-2xl font-semibold">{data.title}</h1>
        <p className="mt-2 flex items-center gap-2 text-sm text-ink-600">
          <Badge color={DOCUMENT_STATUS_COLOR[data.status]} dot>
            {DOCUMENT_STATUS_LABEL[data.status]}
          </Badge>
          enviado por {data.createdBy} em {fmtDateTime(data.createdAt)}
        </p>

        <div className="card mt-6 divide-y divide-ink-100">
          {data.signers.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              {s.status === 'SIGNED' ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <span className="h-4 w-4 rounded-full border border-ink-300" />}
              <span className="flex-1">
                <span className="font-medium">{s.name}</span> <span className="text-ink-500">· {s.role}</span>
              </span>
              <span className="num text-xs text-ink-500">{s.signedAt ? fmtDateTime(s.signedAt) : SIGNER_STATUS_LABEL[s.status]}</span>
            </div>
          ))}
        </div>

        <div className="card mt-6 p-5">
          <p className="font-semibold">Conferir um arquivo</p>
          <p className="mt-1 text-sm text-ink-600">Selecione o PDF que você recebeu. Ele é conferido no seu navegador e não é enviado para lugar nenhum.</p>
          <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-ink-300 px-4 py-4 text-sm hover:border-brand-300">
            <FileSearch className="h-5 w-5 text-brand-500" />
            Escolher PDF
            <input type="file" accept="application/pdf" className="hidden" onChange={async (e) => e.target.files?.[0] && setMatch((await sha256(e.target.files[0])) === data.fileHash)} />
          </label>
          {match === true && (
            <p className="mt-3 flex items-center gap-2 text-sm font-medium text-ok">
              <CheckCircle2 className="h-4 w-4" /> Arquivo autêntico: é exatamente o documento enviado para assinatura.
            </p>
          )}
          {match === false && (
            <p className="mt-3 flex items-center gap-2 text-sm font-medium text-bad">
              <XCircle className="h-4 w-4" /> Este arquivo é diferente do original (foi alterado ou é outro documento).
            </p>
          )}
          <p className="mt-4 break-all font-mono text-2xs text-ink-500">SHA-256: {data.fileHash}</p>
        </div>
      </main>
    </div>
  );
}
