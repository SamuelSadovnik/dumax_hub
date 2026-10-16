import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { UserLite } from '@/lib/types';
import { Avatar } from './ui';

/** Recorta no centro, reduz para 384×384 e converte para JPEG — fotos leves em todo o app */
async function squareJpeg(file: File, size = 384): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Imagem inválida'))), 'image/jpeg', 0.88));
}

/**
 * Foto de perfil clicável. `endpoint` é /auth/me/avatar (a própria pessoa)
 * ou /users/:id/avatar (RH/admin).
 */
export function AvatarUpload({ user, endpoint, size = 88, onChange }: { user: Pick<UserLite, 'name' | 'avatarUrl'> & { id?: string }; endpoint: string; size?: number; onChange?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Escolha uma imagem (JPG, PNG ou WEBP)');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', await squareJpeg(file), 'foto.jpg');
      await api.upload(endpoint, fd);
      toast.success('Foto atualizada');
      onChange?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(endpoint);
      toast.success('Foto removida');
      onChange?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="group relative shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-brand-400"
        aria-label="Trocar foto de perfil"
        disabled={busy}
      >
        <Avatar user={user} size={size} />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-ink-900/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        </span>
      </button>
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="text-sm font-medium text-brand-600 hover:underline" onClick={() => input.current?.click()} disabled={busy}>
            {user.avatarUrl ? 'Trocar foto' : 'Adicionar foto'}
          </button>
          {user.avatarUrl && (
            <button type="button" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-bad" onClick={remove} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5" /> Remover
            </button>
          )}
        </div>
        <p className="text-xs text-ink-500">JPG, PNG ou WEBP. A foto aparece no chat, no organograma e no mapa de perfis.</p>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
    </div>
  );
}
