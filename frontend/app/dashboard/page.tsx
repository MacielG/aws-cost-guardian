'use client';
import { useTranslation } from 'react-i18next';
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

  useEffect(() => {
    fetch('/api/incidents')
      .then(res => res.json())
      .then(setIncidents);
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
      <Link href="/sla-claims" className="block mt-4 text-blue-500">Ver Reivindicações SLA</Link>
    </div>
  );
}