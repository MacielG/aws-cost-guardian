'use client';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useEffect, useState } from 'react';

interface BillingItem {
  id: string;
  type: 'SAVING' | 'CLAIM';
  amount: number;
  meteredAt: string;
}

export default function Billing() {
  const { t } = useTranslation();
  const [billingHistory, setBillingHistory] = useState<BillingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/billing')
      .then(res => res.ok ? res.json() : Promise.reject('Erro ao buscar histórico de cobrança'))
      .then(data => setBillingHistory(data.billingHistory))
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto py-8">
      <h1 className="heading-2 mb-6">Histórico de Cobrança</h1>
      <Card>
        <CardHeader>
          <CardTitle>Itens Cobrados</CardTitle>
          <CardDescription>
            Histórico dos valores realizados e metrificados para cobrança.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <div className="w-full h-24"><span className="muted">Carregando...</span></div>}
          {error && <p className="text-destructive">Erro: {error}</p>}
          {!loading && !error && billingHistory.length === 0 && (
            <p className="muted">Nenhum item de cobrança encontrado.</p>
          )}
          {!loading && !error && billingHistory.length > 0 && (
            <div className="space-y-4">
              {billingHistory.map(item => (
                <Card key={item.id} className="shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{item.id.replace('SAVING#', '').replace('CLAIM#', '')}</h3>
                      <Badge variant={item.type === 'SAVING' ? 'default' : 'success'}>{item.type}</Badge>
                    </div>
                    <p>Valor: <span className="font-medium">${item.amount?.toFixed(2) || '0.00'}</span></p>
                    <p className="text-sm text-muted">Metrificado em: {new Date(item.meteredAt).toLocaleString()}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
