"use client";

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotify } from '@/hooks/useNotify';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageAnimator } from '@/components/layout/PageAnimator';

interface Alert {
  id: string;
  sk: string;
  date: string;
  detail: string;
  status: string;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const notify = useNotify();

  useEffect(() => {
    fetch('/api/alerts')
      .then(res => res.ok ? res.json() : Promise.reject('Erro ao buscar alertas'))
      .then(data => setAlerts(data))
      .catch(err => {
        setError(String(err));
        notify.error('Erro ao buscar alertas');
      })
      .finally(() => setLoading(false));
  }, [notify]);

  if (loading) return <Skeleton className="w-full h-32" />;
  if (error) return <div className="text-destructive">{error}</div>;

  return (
    <PageAnimator>
      <div className="space-y-6">
        <PageHeader title="Alertas" description="Notificações e eventos importantes" />

        {alerts.length === 0 ? (
          <div className="muted">Nenhum alerta encontrado.</div>
        ) : (
          <div className="space-y-4">
            {alerts.map(alert => (
              <Card key={alert.sk} className="flex items-center justify-between p-4">
                <div>
                  <div className="font-semibold text-lg">{alert.detail}</div>
                  <div className="muted text-sm">{new Date(alert.date).toLocaleString()}</div>
                </div>
                <Badge variant={alert.status === 'active' ? 'destructive' : 'secondary'}>
                  {alert.status === 'active' ? 'Ativo' : 'Resolvido'}
                </Badge>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageAnimator>
  );
}
