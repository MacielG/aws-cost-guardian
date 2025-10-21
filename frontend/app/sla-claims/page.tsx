'use client';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Claim {
  id: string;
  amount: number;
  status: string;
  reportUrl?: string;
}

export default function SLAClaims() {
  const { t } = useTranslation();
  const [claims, setClaims] = useState<Claim[]>([]);

  useEffect(() => {
    fetch('/api/sla-claims')
      .then(res => res.json())
      .then(setClaims);
  }, []);

  return (
    <div className="p-8">
      <h1>Reivindicações de Crédito SLA</h1>
      {claims.map(claim => (
        <Card key={claim.id} className="mt-4">
          <CardContent className="p-4">
            <p>Valor Estimado: ${claim.amount}</p>
            <p>Status: {claim.status}</p>
            {claim.reportUrl && <Button><Download className="mr-2" /> Baixar Relatório</Button>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}