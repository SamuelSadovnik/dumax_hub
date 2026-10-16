import { useState } from 'react';
import { toast } from 'sonner';
import { ROLE_LABEL } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { Button, Field, Input, PageHeader } from '@/components/ui';
import { AvatarUpload } from '@/components/AvatarUpload';

export default function Profile() {
  const me = useMe();
  const { refresh } = useAuth();
  const [form, setForm] = useState({ name: me.name, phone: me.phone ?? '' });
  const [pwd, setPwd] = useState({ current: '', next: '' });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/auth/me', { name: form.name, phone: form.phone || null });
      await refresh();
      toast.success('Perfil atualizado');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const changePwd = async () => {
    try {
      await api.post('/auth/me/password', pwd);
      setPwd({ current: '', next: '' });
      toast.success('Senha alterada');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Meus dados" />
      <div className="card p-6">
        <div className="mb-6 border-b border-ink-100 pb-6">
          <p className="text-lg font-semibold">{me.name}</p>
          <p className="mb-4 text-sm text-ink-500">
            {me.jobTitle} · {ROLE_LABEL[me.role]} {me.department && `· ${me.department.name}`}
          </p>
          <AvatarUpload user={me} endpoint="/auth/me/avatar" onChange={refresh} />
        </div>
        <div className="space-y-4">
          <Field label="Nome">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Telefone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Button loading={saving} onClick={save}>
            Salvar
          </Button>
        </div>
      </div>
      <div className="card p-6">
        <h2 className="mb-4 font-semibold">Trocar senha</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Senha atual">
            <Input type="password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} />
          </Field>
          <Field label="Nova senha (8+ caracteres)">
            <Input type="password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} />
          </Field>
        </div>
        <Button className="mt-4" variant="secondary" disabled={!pwd.current || pwd.next.length < 8} onClick={changePwd}>
          Alterar senha
        </Button>
      </div>
    </div>
  );
}
