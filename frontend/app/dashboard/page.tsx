'use client';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'; // Assuma shadcn
import { AlertCircle, DollarSign } from 'lucide-react';

interface Incident {
  id: string;
  service: string;
  impact: number;
  confidence: number;
  status: 'detected' | 'submitted' | 'refunded';
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [costs, setCosts] = useState<any[]>([]);
  const [loadingCosts, setLoadingCosts] = useState(true);

  useEffect(() => {
    fetch('/api/incidents')
      .then(res => res.json())
      .then(setIncidents);
  }, []);

  useEffect(() => {
    fetch('/api/dashboard/costs', { credentials: 'same-origin' })
      .then(res => {
        if (!res.ok) return [];
        return res.json();
      })
      .then((d) => {
        setCosts(Array.isArray(d) ? d : []);
      })
      .catch(() => setCosts([]))
      .finally(() => setLoadingCosts(false));
  }, []);

  const totalEarnings = incidents.reduce((sum, inc) => sum + (inc.status === 'refunded' ? inc.impact * 0.7 : 0), 0);

  return (
    <div className="p-8">
      <h1 className="text-2xl">{t('dashboard')}</h1>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t('earnings')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DollarSign className="inline" /> ${totalEarnings.toFixed(2)}
        </CardContent>
      </Card>
      <h2 className="mt-8">{t('incidents')}</h2>
      {incidents.map(inc => (
        <Card key={inc.id} className="mt-2">
          <CardContent className="p-4">
            <AlertCircle className="inline text-red-500" /> {inc.service}: Impacto ${inc.impact} (Confiança: {inc.confidence}%)
            <p>Status: {inc.status}</p>
          </CardContent>
        </Card>
      ))}
      <div className="mt-6 flex space-x-4">
        <Link href="/sla-claims" className="text-blue-500 hover:underline">Ver Reivindicações SLA</Link>
        <Link href="/billing" className="text-blue-500 hover:underline">Ver Histórico de Faturamento</Link>
      </div>

      <h2 className="mt-8">Custos — Últimos 30 dias</h2>
      {loadingCosts ? (
        <div>Carregando dados de custo...</div>
      ) : costs.length === 0 ? (
        <div>Nenhum dado de custo disponível.</div>
      ) : (
        <table className="w-full text-left border-collapse mt-2">
          <thead>
            <tr>
              <th className="border-b py-2">Serviço</th>
              <th className="border-b py-2">Custo (USD)</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const rows: { service: string; amount: number }[] = [];
              try {
                for (const day of costs) {
                  if (day && day.Groups) {
                    for (const g of day.Groups) {
                      rows.push({ service: g.Keys?.[0] || 'Unknown', amount: parseFloat(g.Metrics.UnblendedCost.Amount) });
                    }
                  }
                }
              } catch (e) {}
              return rows.map((r, idx) => (
                <tr key={idx}>
                  <td className="py-2">{r.service}</td>
                  <td className="py-2">${r.amount.toFixed(2)}</td>
                </tr>
              ));
            })()}
          </tbody>
        </table>
      )}
    </div>
  );
}