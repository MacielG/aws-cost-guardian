'use client';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';

interface Claim {
  id: string; // customerId
  sk: string; // CLAIM#... ou INCIDENT#...
  // Status possíveis para uma claim (inclui REPORT_FAILED para compatibilidade)
  status: 'READY_TO_SUBMIT' | 'SUBMITTED' | 'SUBMISSION_FAILED' | 'REPORT_FAILED' | 'PAID' | 'REFUNDED' | 'NO_VIOLATION' | 'NO_RESOURCES_LISTED' | 'PENDING_MANUAL_SUBMISSION';
  creditAmount: number;
  reportUrl?: string;
  incidentId: string;
  awsAccountId: string;
  stripeInvoiceId?: string;
  caseId?: string; // AWS Support Case ID
  submissionError?: string;
  commissionAmount?: number;
}

const getStatusVariant = (status: Claim['status']) => {
  switch (status) { // Mapeamento de cor para o Badge
    case 'PAID': case 'REFUNDED': return 'success';
    case 'SUBMITTED': return 'default';
    case 'READY_TO_SUBMIT': case 'PENDING_MANUAL_SUBMISSION': return 'secondary';
    case 'SUBMISSION_FAILED': case 'REPORT_FAILED': return 'destructive';
    case 'NO_VIOLATION': case 'NO_RESOURCES_LISTED': return 'outline';
    default: return 'default';
  }
};

export default function SLAClaims() {
  const { t } = useTranslation();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/sla-claims')
      .then(res => res.ok ? res.json() : Promise.reject('Erro ao buscar claims'))
      .then(data => setClaims(data))
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto py-8">
      <h1 className="heading-2 mb-6">Reivindicações de Crédito SLA</h1>
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Claims</CardTitle>
          <CardDescription>
            Visualize o status e os detalhes das suas reivindicações de crédito SLA.
            <Link href="/docs/como-funciona.md" target="_blank" className="text-primary underline ml-2">
              Como calculamos isso?
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <div className="w-full h-24"><span className="muted">Carregando...</span></div>}
          {error && <p className="text-destructive">Erro: {error}</p>}
          {!loading && !error && claims.length === 0 && (
            <p className="muted">Nenhuma reivindicação encontrada.</p>
          )}
          {!loading && !error && claims.length > 0 && (
            <div className="space-y-4">
              {claims.map(claim => (
                <Card key={claim.sk} className="shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">Claim: {claim.sk.replace('CLAIM#', '')}</h3>
                      <Badge variant={getStatusVariant(claim.status)}>{claim.status}</Badge>
                    </div>
                    <p className="text-sm text-muted">Incidente: {claim.incidentId.replace('INCIDENT#', '')}</p>
                    <p className="mt-2">Conta AWS: {claim.awsAccountId}</p>
                    <p>Crédito Estimado: <span className="font-medium">${claim.creditAmount?.toFixed(2) || '0.00'}</span></p>
                    {claim.commissionAmount && <p>Comissão Paga: <span className="font-medium">${claim.commissionAmount.toFixed(2)}</span></p>}
                    {claim.caseId && <p>ID do Caso AWS: <span className="font-medium">{claim.caseId}</span></p>}
                    {claim.stripeInvoiceId && <p>ID da Fatura Stripe: <span className="font-medium">{claim.stripeInvoiceId}</span></p>}
                    {claim.submissionError && <p className="text-destructive">Erro no Envio: {claim.submissionError}</p>}

                    {claim.status === 'PENDING_MANUAL_SUBMISSION' && (
                      <Card className="mt-4 bg-yellow-50 border-yellow-300">
                        <CardHeader>
                          <CardTitle>Ação Requerida</CardTitle>
                          <CardDescription>
                            Seu plano AWS Support não permite abertura automática de tickets. Siga os passos abaixo para enviar manualmente:
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="font-mono text-sm bg-gray-100 rounded p-4 space-y-2">
                          <p>1. Abra o Console AWS e navegue até AWS Support Center</p>
                          <p>2. Clique em "Criar Caso" e selecione "Faturamento"</p>
                          <p>3. Use o assunto e descrição abaixo:</p>
                          <div className="mt-2 p-3 bg-white rounded">
                            <p className="font-bold">Assunto:</p>
                            <p>[Cost Guardian] Reivindicação de Crédito SLA - {claim.incidentId.replace('INCIDENT#', '')}</p>
                            <p className="font-bold mt-2">Descrição:</p>
                            <p>Solicito crédito de SLA no valor de ${claim.creditAmount?.toFixed(2)} para o incidente: {claim.incidentId.replace('INCIDENT#', '')}</p>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    <div className="mt-4 space-x-2">
                      {claim.reportUrl && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={claim.reportUrl} target="_blank" rel="noopener noreferrer">
                            <Download className="mr-2 h-4 w-4" /> Baixar Relatório
                          </a>
                        </Button>
                      )}
                      {claim.caseId && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={`https://console.aws.amazon.com/support/cases/#/case/${claim.caseId}`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="mr-2 h-4 w-4" /> Ver Caso AWS
                          </a>
                        </Button>
                      )}
                    </div>
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