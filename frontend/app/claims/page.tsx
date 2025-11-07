'use client';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageAnimator } from '@/components/layout/PageAnimator';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner'; // Assuming you have sonner for toasts
import { apiFetch } from '@/lib/api';

interface Claim {
  id: string; // customerId
  sk: string; // CLAIM#... ou INCIDENT#...
  status: 'READY_TO_SUBMIT' | 'SUBMITTED' | 'SUBMISSION_FAILED' | 'PAID' | 'REFUNDED' | 'NO_VIOLATION' | 'NO_RESOURCES_LISTED' | 'REPORT_FAILED';
  creditAmount: number;
  reportUrl?: string;
  incidentId: string;
  awsAccountId: string;
  stripeInvoiceId?: string;
  caseId?: string; // AWS Support Case ID
  submissionError?: string;
  commissionAmount?: number;
  details?: any; // Full event details
}

const getStatusVariant = (status: Claim['status']) => {
  switch (status) {
    case 'PAID': case 'REFUNDED': return 'success';
    case 'SUBMITTED': return 'default';
    case 'READY_TO_SUBMIT': return 'secondary';
    case 'SUBMISSION_FAILED': case 'REPORT_FAILED': return 'destructive';
    case 'NO_VIOLATION': case 'NO_RESOURCES_LISTED': return 'outline';
    default: return 'default';
  }
};

const allStatuses = [
  'ALL',
  'READY_TO_SUBMIT',
  'SUBMITTED',
  'SUBMISSION_FAILED',
  'PAID',
  'REFUNDED',
  'NO_VIOLATION',
  'NO_RESOURCES_LISTED',
  'REPORT_FAILED'
];

export default function AdminClaims() {
  const { t } = useTranslation();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [filteredClaims, setFilteredClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const fetchClaims = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data: Claim[] = await apiFetch('/admin/claims');
      setClaims(data);
      setFilteredClaims(data); // Initialize filtered claims
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClaims();
  }, [fetchClaims]);

  useEffect(() => {
    let currentClaims = claims;

    // Filter by status
    if (filterStatus !== 'ALL') {
      currentClaims = currentClaims.filter(claim => claim.status === filterStatus);
    }

    // Filter by search term
    if (searchTerm) {
      const lowerCaseSearchTerm = searchTerm.toLowerCase();
      currentClaims = currentClaims.filter(claim =>
        claim.sk.toLowerCase().includes(lowerCaseSearchTerm) ||
        claim.incidentId.toLowerCase().includes(lowerCaseSearchTerm) ||
        claim.awsAccountId.toLowerCase().includes(lowerCaseSearchTerm) ||
        claim.id.toLowerCase().includes(lowerCaseSearchTerm)
      );
    }

    setFilteredClaims(currentClaims);
  }, [claims, filterStatus, searchTerm]);

  const handleUpdateClaimStatus = async (customerId: string, claimSk: string, newStatus: Claim['status']) => {
    if (!confirm(`Tem certeza que deseja mudar o status da reivindicação ${claimSk.replace('CLAIM#', '')} para ${newStatus}?`)) {
      return;
    }

    try {
      await apiFetch(`/admin/claims/${customerId}/${claimSk.replace('CLAIM#', '')}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });

      toast.success(`Status da reivindicação ${claimSk.replace('CLAIM#', '')} atualizado para ${newStatus}.`);
      fetchClaims(); // Re-fetch claims to update the UI
    } catch (err) {
      toast.error(`Erro ao atualizar status: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
    }
  };

  return (
    <PageAnimator>
      <div className="space-y-6">
        <PageHeader title="Claims" description="Gerenciamento de Reivindicações">
        </PageHeader>
        <Card>
        <CardHeader>
          <CardTitle>{t('adminClaims.title', 'Gerenciamento de Reivindicações (Admin)')}</CardTitle>
          <CardDescription>{t('adminClaims.description', 'Visualize e gerencie todas as reivindicações de crédito SLA do sistema.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <Input
              placeholder={t('adminClaims.searchPlaceholder', 'Buscar por ID, incidente, conta AWS...')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-grow"
            />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t('adminClaims.filterByStatus', 'Filtrar por Status')} />
              </SelectTrigger>
              <SelectContent>
                {allStatuses.map(status => (
                  <SelectItem key={status} value={status}>
                    {t(`statuses.${status}`, status.replace(/_/g, ' '))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={fetchClaims} variant="outline" size="icon">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {loading && <p>{t('loading', 'Carregando...')}</p>}
          {error && <p className="text-red-500">{t('error', 'Erro')}: {error}</p>}
          {!loading && !error && filteredClaims.length === 0 && (
            <p>{t('adminClaims.noClaims', 'Nenhuma reivindicação encontrada com os filtros aplicados.')}</p>
          )}
          {!loading && !error && filteredClaims.length > 0 && (
            <div className="space-y-4">
              {filteredClaims.map(claim => (
                <Card key={claim.sk}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{t('adminClaims.claimId', 'Reivindicação ID')}: {claim.sk.replace('CLAIM#', '')}</h3>
                      <Badge variant={getStatusVariant(claim.status)}>{t(`statuses.${claim.status}`, claim.status)}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{t('adminClaims.customerId', 'Cliente ID')}: {claim.id}</p>
                    <p className="text-sm text-muted-foreground">{t('adminClaims.incidentId', 'Incidente Associado')}: {claim.incidentId.replace('INCIDENT#', '')}</p>
                    <p className="mt-2">{t('adminClaims.awsAccount', 'Conta AWS')}: {claim.awsAccountId}</p>
                    <p>{t('adminClaims.estimatedCredit', 'Crédito Estimado')}: <span className="font-medium">${claim.creditAmount?.toFixed(2) || '0.00'}</span></p>
                    {claim.commissionAmount && <p>{t('adminClaims.commissionPaid', 'Comissão Paga')}: <span className="font-medium">${claim.commissionAmount.toFixed(2)}</span></p>}
                    {claim.caseId && <p>{t('adminClaims.supportCaseId', 'ID do Caso de Suporte AWS')}: <span className="font-medium">{claim.caseId}</span></p>}
                    {claim.stripeInvoiceId && <p>{t('adminClaims.stripeInvoiceId', 'ID da Fatura Stripe')}: <span className="font-medium">{claim.stripeInvoiceId}</span></p>}
                    {claim.submissionError && <p className="text-red-500">{t('adminClaims.submissionError', 'Erro no Envio')}: {claim.submissionError}</p>}

                    <div className="mt-4 space-x-2 flex flex-wrap gap-2">
                      {claim.reportUrl && (
                        <a href={claim.reportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center">
                          <Button variant="outline" size="sm">
                            <Download className="mr-2 h-4 w-4" /> {t('adminClaims.downloadReport', 'Baixar Relatório')}
                          </Button>
                        </a>
                      )}
                      {claim.caseId && (
                        <a href={`https://console.aws.amazon.com/support/cases/#/case/${claim.caseId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center">
                          <Button variant="outline" size="sm">
                            <ExternalLink className="mr-2 h-4 w-4" /> {t('adminClaims.viewSupportCase', 'Ver Caso de Suporte')}
                          </Button>
                        </a>
                      )}
                      {/* Botão para marcar como reembolsado e gerar fatura */}
                      {claim.status === 'READY_TO_SUBMIT' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleMarkAsRefunded(claim.id, claim.sk)}
                        >
                          {t('adminClaims.markAsRefundedAndInvoice', 'Marcar como Reembolsado (Gerar Fatura)')}
                        </Button>
                      )}

                      {/* Seletor de status para atualizações manuais (emergência) */}
                      <Select
                        value={claim.status}
                        onValueChange={(newStatus) => handleUpdateClaimStatus(claim.id, claim.sk, newStatus as Claim['status'])}
                      >
                        <SelectTrigger className="w-[200px]">
                          <SelectValue placeholder={t('adminClaims.changeStatus', 'Mudar Status (Emergência)')} />
                        </SelectTrigger>
                        <SelectContent>
                          {allStatuses.filter(s => s !== 'ALL').map(status => (
                            <SelectItem key={status} value={status}>
                              {t(`statuses.${status}`, status.replace(/_/g, ' '))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
        </Card>
      </div>
    </PageAnimator>
    );
}

// Novo handler para marcar como reembolsado e gerar fatura
const handleMarkAsRefunded = async (customerId: string, claimSk: string) => {
  const claimId = claimSk.replace('CLAIM#', '');
  if (!confirm(`Isso marcará a claim ${claimId} como REEMBOLSADA e GERARÁ A FATURA de comissão para o cliente. Continuar?`)) {
    return;
  }

  try {
    const data = await apiFetch(`/admin/claims/${customerId}/${claimId}/create-invoice`, {
      method: 'POST',
    });
    toast.success(`Fatura ${data.invoiceId} criada! Claim marcada como REFUNDED.`);
    // Re-fetch claims to update the UI
    // This assumes fetchClaims is available in the scope, which it is in the component.
    // For a standalone function, you might need to pass fetchClaims as an argument.
    // However, since this is within the component's scope, it can access fetchClaims.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    fetchClaims(); 
  } catch (err) {
    toast.error(`Erro: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
  }
};