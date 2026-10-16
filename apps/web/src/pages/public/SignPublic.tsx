import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, Eraser, ShieldCheck, XCircle } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Button, Checkbox, Field, Input, Modal, PageLoader, Tabs, Textarea } from '@/components/ui';
import { PublicHeader } from './Careers';

interface SignData {
  document: {
    id: string;
    title: string;
    message: string | null;
    category: string;
    status: string;
    fileName: string;
    fileHash: string;
    sequential: boolean;
    dueAt: string | null;
    createdBy: string;
    signers: { id: string; name: string; role: string; order: number; status: string; signedAt: string | null }[];
  };
  me: { id: string; name: string; email: string; cpf: string | null; role: string; status: string; signedAt: string | null };
  canSign: boolean;
}

/** Área de desenho da assinatura (mouse, toque ou caneta) */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0D1330';
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={canvas}
        className="h-40 w-full touch-none rounded-lg border border-dashed border-ink-300 bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          const p = pos(e);
          const ctx = canvas.current!.getContext('2d')!;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          canvas.current!.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = pos(e);
          const ctx = canvas.current!.getContext('2d')!;
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (dirty.current) onChange(canvas.current!.toDataURL('image/png'));
        }}
      />
      <div className="mt-1.5 flex justify-between text-xs text-ink-500">
        <span>Assine com o mouse ou o dedo</span>
        <button onClick={clear} className="flex items-center gap-1 hover:text-ink-800">
          <Eraser className="h-3.5 w-3.5" /> Limpar
        </button>
      </div>
    </div>
  );
}

/** Gera a imagem da assinatura a partir do nome digitado */
function typedSignature(name: string) {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 220;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0D1330';
  ctx.font = 'italic 84px "Brush Script MT", "Segoe Script", "Apple Chancery", cursive';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 30, 115, 840);
  return c.toDataURL('image/png');
}

export default function SignPublic() {
  const { token } = useParams();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['sign', token], queryFn: () => api.get<SignData>(`/public/sign/${token}`) });
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [drawn, setDrawn] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [accept, setAccept] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (data) {
      setName((n) => n || data.me.name);
      setCpf((c) => c || (data.me.cpf ?? ''));
    }
  }, [data]);

  if (isLoading || !data) return <PageLoader />;
  const { document: doc, me } = data;

  const sign = async () => {
    setError(null);
    const image = mode === 'draw' ? drawn : name.trim() ? typedSignature(name.trim()) : null;
    if (!image) return setError(mode === 'draw' ? 'Desenhe sua assinatura' : 'Digite seu nome');
    if (!accept) return setError('Confirme que leu e concorda com o documento');
    setSending(true);
    try {
      await api.post(`/public/sign/${token}`, { signatureText: name.trim(), signatureImage: image, cpf: cpf || undefined, accept: true });
      await refetch();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };
  const decline = async () => {
    try {
      await api.post(`/public/sign/${token}/decline`, { reason });
      setDeclining(false);
      await refetch();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <PublicHeader />
      <main className="mx-auto grid max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <h1 className="text-xl font-semibold">{doc.title}</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {doc.category} · enviado por {doc.createdBy}
            {doc.dueAt && ` · prazo ${fmtDateTime(doc.dueAt)}`}
          </p>
          {doc.message && <p className="mt-3 rounded-lg border border-ink-200 bg-white p-3 text-sm text-ink-700">{doc.message}</p>}
          <div className="card mt-4 overflow-hidden">
            <iframe title="Documento" src={`/api/public/sign/${token}/file`} className="h-[78vh] w-full" />
          </div>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="card p-5">
            {me.status === 'SIGNED' ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-ok" />
                <p className="mt-3 font-semibold">Você assinou este documento</p>
                <p className="num text-sm text-ink-500">{me.signedAt && fmtDateTime(me.signedAt)}</p>
                <a href={`/verificar/${doc.id}`} className="mt-4 inline-block text-sm text-brand-600 hover:underline">
                  Ver situação das assinaturas
                </a>
              </div>
            ) : me.status === 'DECLINED' ? (
              <div className="py-6 text-center">
                <XCircle className="mx-auto h-10 w-10 text-bad" />
                <p className="mt-3 font-semibold">Você recusou este documento</p>
              </div>
            ) : !data.canSign ? (
              <div className="py-6 text-center text-sm text-ink-600">
                {doc.status !== 'PENDING' ? 'Este documento não está mais aguardando assinaturas.' : 'Ainda não é a sua vez: este documento é assinado em ordem. Você receberá um aviso.'}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="font-semibold">Assinar como {me.name}</p>
                  <p className="text-xs text-ink-500">
                    {me.role} · {me.email}
                  </p>
                </div>
                <Tabs
                  size="sm"
                  value={mode}
                  onChange={setMode}
                  items={[
                    { value: 'draw', label: 'Desenhar' },
                    { value: 'type', label: 'Digitar' },
                  ]}
                />
                {mode === 'draw' ? (
                  <SignaturePad onChange={setDrawn} />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-ink-300 bg-white px-4">
                    <span className="truncate text-4xl italic text-ink-900" style={{ fontFamily: '"Brush Script MT", "Segoe Script", "Apple Chancery", cursive' }}>
                      {name || 'Seu nome'}
                    </span>
                  </div>
                )}
                <Field label="Nome completo">
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="CPF" hint="Opcional, aparece no certificado">
                  <Input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
                </Field>
                <Checkbox checked={accept} onChange={setAccept} label="Li o documento e concordo em assiná-lo eletronicamente." />
                {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
                <Button className="w-full" loading={sending} onClick={sign}>
                  Assinar documento
                </Button>
                <button onClick={() => setDeclining(true)} className="w-full text-center text-xs text-ink-500 hover:text-bad">
                  Não concordo, quero recusar
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 rounded-lg border border-ink-200 bg-white p-4 text-xs text-ink-500">
            <p className="mb-1 flex items-center gap-1.5 font-medium text-ink-700">
              <ShieldCheck className="h-4 w-4 text-ok" /> Assinatura com registro de auditoria
            </p>
            Ao assinar, registramos data, hora, IP e navegador, vinculados ao arquivo pelo código <span className="break-all font-mono">{doc.fileHash.slice(0, 16)}…</span>
          </div>

          <ul className="mt-4 space-y-1.5 text-sm">
            {doc.signers.map((s) => (
              <li key={s.id} className={clsx('flex items-center gap-2', s.id === me.id && 'font-medium')}>
                <span className={clsx('h-2 w-2 rounded-full', s.status === 'SIGNED' ? 'bg-ok' : s.status === 'DECLINED' ? 'bg-bad' : 'bg-ink-300')} />
                {s.name} <span className="text-xs text-ink-400">· {s.role}</span>
              </li>
            ))}
          </ul>
        </aside>
      </main>

      <Modal
        open={declining}
        onClose={() => setDeclining(false)}
        title="Recusar assinatura"
        size="sm"
        footer={
          <Button variant="danger" disabled={reason.trim().length < 3} onClick={decline}>
            Recusar
          </Button>
        }
      >
        <Field label="Motivo">
          <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: a cláusula 4 não foi o que combinamos" />
        </Field>
      </Modal>
    </div>
  );
}
