import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { DOCUMENT_STATUS_LABEL } from '@dumax/shared';
import { api } from '@/lib/api';
import type { DocumentItem } from '@/lib/types';
import { fmtDateTime } from '@/lib/format';
import { Button, PageLoader } from '@/components/ui';
import { Logo } from '@/components/brand';

/** Certificado de assinaturas — página limpa para imprimir ou salvar em PDF */
export default function Certificate() {
  const { id } = useParams();
  const { data: doc, isLoading } = useQuery({ queryKey: ['document', id], queryFn: () => api.get<DocumentItem>(`/documents/${id}`) });
  if (isLoading || !doc) return <PageLoader />;
  const verifyUrl = `${window.location.origin}/verificar/${doc.id}`;

  return (
    <div className="min-h-screen bg-ink-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[800px] justify-end print:hidden">
        <Button icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
          Imprimir ou salvar PDF
        </Button>
      </div>
      <article className="mx-auto max-w-[800px] bg-white p-12 shadow-sm print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b border-ink-200 pb-6">
          <Logo />
          <div className="text-right text-xs text-ink-500">
            <p className="font-semibold text-ink-900">Certificado de assinaturas eletrônicas</p>
            <p className="num">Código: {doc.id}</p>
          </div>
        </header>

        <section className="py-6">
          <h1 className="text-xl font-semibold">{doc.title}</h1>
          <dl className="mt-4 grid grid-cols-[160px_1fr] gap-y-1.5 text-sm">
            <dt className="text-ink-500">Tipo</dt>
            <dd>{doc.category}</dd>
            <dt className="text-ink-500">Arquivo</dt>
            <dd>{doc.fileName}</dd>
            <dt className="text-ink-500">SHA-256</dt>
            <dd className="break-all font-mono text-xs">{doc.fileHash}</dd>
            <dt className="text-ink-500">Enviado por</dt>
            <dd>
              {doc.createdBy.name} em {fmtDateTime(doc.createdAt)}
            </dd>
            <dt className="text-ink-500">Situação</dt>
            <dd>
              {DOCUMENT_STATUS_LABEL[doc.status]}
              {doc.completedAt && ` em ${fmtDateTime(doc.completedAt)}`}
            </dd>
          </dl>
        </section>

        <section className="border-t border-ink-200 py-6">
          <h2 className="mb-4 text-sm font-semibold">Signatários</h2>
          <div className="space-y-4">
            {doc.signers.map((s) => (
              <div key={s.id} className="grid grid-cols-[1fr_200px] gap-4 rounded-lg border border-ink-200 p-4 text-sm break-inside-avoid">
                <dl className="grid grid-cols-[110px_1fr] gap-y-1">
                  <dt className="text-ink-500">Nome</dt>
                  <dd className="font-medium">{s.name}</dd>
                  <dt className="text-ink-500">Papel</dt>
                  <dd>{s.role}</dd>
                  <dt className="text-ink-500">E-mail</dt>
                  <dd>{s.email}</dd>
                  {s.cpf && (
                    <>
                      <dt className="text-ink-500">CPF</dt>
                      <dd>{s.cpf}</dd>
                    </>
                  )}
                  <dt className="text-ink-500">Assinado em</dt>
                  <dd className="num">{s.signedAt ? fmtDateTime(s.signedAt) : '—'}</dd>
                  <dt className="text-ink-500">IP</dt>
                  <dd className="num">{s.ip ?? '—'}</dd>
                  <dt className="text-ink-500">Navegador</dt>
                  <dd className="truncate text-xs text-ink-600">{s.userAgent ?? '—'}</dd>
                </dl>
                <div className="flex flex-col items-center justify-end border-l border-ink-100 pl-4">
                  {s.signatureImage ? <img src={s.signatureImage} alt="Assinatura" className="max-h-20" /> : <p className="font-[cursive] text-2xl">{s.signatureText}</p>}
                  <p className="mt-1 w-full border-t border-ink-300 pt-1 text-center text-xs text-ink-500">{s.signatureText ?? s.name}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="border-t border-ink-200 pt-5 text-xs leading-relaxed text-ink-500">
          Assinaturas eletrônicas realizadas na plataforma Dumax Hub, com identificação por e-mail/login, registro de IP, data e hora, e vinculadas ao arquivo pelo hash SHA-256 acima
          (Lei 14.063/2020 e MP 2.200-2/2001, art. 10, §2º). Para conferir a autenticidade, acesse <span className="font-medium text-ink-800">{verifyUrl}</span> e compare o arquivo.
        </footer>
      </article>
    </div>
  );
}
