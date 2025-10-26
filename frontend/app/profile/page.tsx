import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotify } from '@/hooks/useNotify';

interface Profile {
  email: string;
  preferences?: {
    language?: string;
    notifications?: boolean;
  };
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const notify = useNotify();

  useEffect(() => {
    fetch('/api/profile')
      .then(res => res.ok ? res.json() : Promise.reject('Erro ao buscar perfil'))
      .then(data => setProfile(data))
      .catch(err => {
        setError(String(err));
        notify.error('Erro ao buscar perfil');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = () => {
    // Exemplo de PUT para salvar preferências
    fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: profile?.preferences })
    })
      .then(res => res.ok ? notify.success('Preferências salvas!') : notify.error('Erro ao salvar'));
  };

  if (loading) return <Skeleton className="w-full h-32" />;
  if (error) return <div className="text-destructive">{error}</div>;

  return (
    <div className="max-w-xl mx-auto py-8">
      <h1 className="heading-2 mb-6">Perfil</h1>
      <Card className="p-6">
        <div className="mb-4">
          <span className="font-semibold">E-mail:</span> {profile?.email}
        </div>
        <div className="mb-4">
          <span className="font-semibold">Idioma:</span>
          <select
            value={profile?.preferences?.language || 'pt-BR'}
            onChange={e => setProfile(p => p ? { ...p, preferences: { ...p.preferences, language: e.target.value } } : p)}
            className="ml-2 border rounded px-2 py-1"
          >
            <option value="pt-BR">Português</option>
            <option value="en-US">English</option>
          </select>
        </div>
        <div className="mb-4">
          <label className="font-semibold mr-2">Notificações:</label>
          <input
            type="checkbox"
            checked={!!profile?.preferences?.notifications}
            onChange={e => setProfile(p => p ? { ...p, preferences: { ...p.preferences, notifications: e.target.checked } } : p)}
          />
        </div>
  <Button onClick={handleSave as any}>{'Salvar'}</Button>
      </Card>
      <div className="mt-6">
  <Button variant="outline">{'Alterar Senha'}</Button>
      </div>
    </div>
  );
}
