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
    const fetchClaims = async () => {
      try {
        const response = await fetch('/api/sla-claims');
        if (!response.ok) {
          throw new Error('Failed to fetch SLA claims');
        }
        const data: Claim[] = await response.json();
        setClaims(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchClaims();
  }, []);

  return (
    <div className="p-8">
      <Card>
        <CardHeader>
          <CardTitle>{t('slaClaims.title', 'Reivindicações de Crédito SLA')}</CardTitle>
          <CardDescription>
            {t('slaClaims.description', 'Visualize o status e os detalhes das suas reivindicações de crédito SLA.')}
            <Link href="/docs/como-funciona.md" target="_blank" className="text-blue-500 hover:underline ml-2">
              Como calculamos isso?
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p>{t('loading', 'Carregando...')}</p>}
          {error && <p className="text-red-500">{t('error', 'Erro')}: {error}</p>}
          {!loading && !error && claims.length === 0 && (
            <p>{t('slaClaims.noClaims', 'Nenhuma reivindicação de crédito SLA encontrada.')}</p>
          )}
          {!loading && !error && claims.length > 0 && (
            <div className="space-y-4">
              {claims.map(claim => (
                <Card key={claim.sk}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{t('slaClaims.claimId', 'Reivindicação ID')}: {claim.sk.replace('CLAIM#', '')}</h3>
                      <Badge variant={getStatusVariant(claim.status)}>{t(`statuses.${claim.status}`, claim.status)}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{t('slaClaims.incidentId', 'Incidente Associado')}: {claim.incidentId.replace('INCIDENT#', '')}</p>
                    <p className="mt-2">{t('slaClaims.awsAccount', 'Conta AWS')}: {claim.awsAccountId}</p>
                    <p>{t('slaClaims.estimatedCredit', 'Crédito Estimado')}: <span className="font-medium">${claim.creditAmount?.toFixed(2) || '0.00'}</span></p>
                    {claim.commissionAmount && <p>{t('slaClaims.commissionPaid', 'Comissão Paga')}: <span className="font-medium">${claim.commissionAmount.toFixed(2)}</span></p>}
                    {claim.caseId && <p>{t('slaClaims.supportCaseId', 'ID do Caso de Suporte AWS')}: <span className="font-medium">{claim.caseId}</span></p>}
                    {claim.stripeInvoiceId && <p>{t('slaClaims.stripeInvoiceId', 'ID da Fatura Stripe')}: <span className="font-medium">{claim.stripeInvoiceId}</span></p>}
                    {claim.submissionError && <p className="text-red-500">{t('slaClaims.submissionError', 'Erro no Envio')}: {claim.submissionError}</p>}
                    
                    {claim.status === 'PENDING_MANUAL_SUBMISSION' && (
                      <Card className="mt-4 bg-yellow-50 border-yellow-300">
                        <CardHeader>
                          <CardTitle>{t('slaClaims.actionRequired', 'Ação Requerida')}</CardTitle>
                          <CardDescription>
                            {t('slaClaims.manualSubmissionInstructions', 'Seu plano AWS Support não permite a abertura automática de tickets. Por favor, siga os passos abaixo para enviar manualmente:')}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="font-mono text-sm bg-gray-100 rounded p-4 space-y-2">
                          <p>1. {t('slaClaims.manualStep1', 'Abra o Console AWS e navegue até AWS Support Center')}</p>
                          <p>2. {t('slaClaims.manualStep2', 'Clique em "Criar Caso" e selecione "Faturamento"')}</p>
                          <p>3. {t('slaClaims.manualStep3', 'Use o assunto e descrição abaixo:')}</p>
                          <div className="mt-2 p-3 bg-white rounded">
                            <p className="font-bold">{t('slaClaims.subject', 'Assunto')}:</p>
                            <p>[Cost Guardian] {t('slaClaims.slaClaimTitle', `Reivindicação de Crédito SLA - ${claim.incidentId.replace('INCIDENT#', '')}`)}</p>
                            <p className="font-bold mt-2">{t('slaClaims.description', 'Descrição')}:</p>
                            <p>{t('slaClaims.requestCredit', 'Solicito crédito de SLA no valor de')} ${claim.creditAmount?.toFixed(2)} {t('slaClaims.forIncident', 'para o incidente')}: {claim.incidentId.replace('INCIDENT#', '')}</p>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    <div className="mt-4 space-x-2">
                      {claim.reportUrl && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={claim.reportUrl} target="_blank" rel="noopener noreferrer">
                            <Download className="mr-2 h-4 w-4" /> {t('slaClaims.downloadReport', 'Baixar Relatório')}
                          </a>
                        </Button>
                      )}
                      {claim.caseId && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={`https://console.aws.amazon.com/support/cases/#/case/${claim.caseId}`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="mr-2 h-4 w-4" /> {t('slaClaims.viewSupportCase', 'Ver Caso de Suporte')}
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