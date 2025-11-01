'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingSpinner';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { apiClient } from '@/lib/api';

interface SLAClaim {
  sk: string;
  incidentId: string;
  awsAccountId: string;
  service: string;
  region: string;
  startTime: string;
  endTime?: string;
  impact: {
    affectedResources: number;
    estimatedCost: number;
  };
  status: string;
  reportUrl?: string;
  ticketId?: string;
  creditAmount?: number;
  createdAt: string;
  updatedAt: string;
}

export default function SLAClaimsPage() {
  const [claims, setClaims] = useState<SLAClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadClaims();
  }, []);

  const loadClaims = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get('/api/sla-claims');
      setClaims(response.data || []);
    } catch (err: any) {
      console.error('Erro ao carregar claims:', err);
      setError(err.message || 'Erro ao carregar claims de SLA');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReport = async (claimId: string) => {
    try {
      window.open(`/api/sla-reports/${claimId}`, '_blank');
    } catch (err: any) {
      alert(`Erro ao baixar relatório: ${err.message}`);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { variant: 'default' | 'success' | 'warning' | 'danger' | 'info'; label: string }> = {
      DETECTED: { variant: 'info', label: 'Detectado' },
      READY_TO_SUBMIT: { variant: 'warning', label: 'Pronto para Submeter' },
      SUBMITTED: { variant: 'warning', label: 'Submetido' },
      RECOVERED: { variant: 'success', label: 'Recuperado' },
      REFUNDED: { variant: 'success', label: 'Reembolsado' },
      FAILED: { variant: 'danger', label: 'Falhou' },
      NO_VIOLATION: { variant: 'default', label: 'Sem Violação' },
    };

    const config = statusMap[status] || { variant: 'default', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getStatusTimeline = (claim: SLAClaim) => {
    const steps = [
      { key: 'DETECTED', label: 'Detectado', completed: true },
      { key: 'READY_TO_SUBMIT', label: 'Análise Completa', completed: ['READY_TO_SUBMIT', 'SUBMITTED', 'RECOVERED', 'REFUNDED'].includes(claim.status) },
      { key: 'SUBMITTED', label: 'Submetido à AWS', completed: ['SUBMITTED', 'RECOVERED', 'REFUNDED'].includes(claim.status) },
      { key: 'RECOVERED', label: 'Crédito Recuperado', completed: ['RECOVERED', 'REFUNDED'].includes(claim.status) },
    ];

    return steps;
  };

  if (loading) {
    return <LoadingState message="Carregando claims de SLA..." />;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="error">
          <h4 className="font-semibold">Erro ao carregar claims</h4>
          <p className="mt-1 text-sm">{error}</p>
          <button
            onClick={loadClaims}
            className="mt-3 text-sm underline hover:no-underline"
          >
            Tentar novamente
          </button>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">SLA Claims</h1>
          <p className="mt-2 text-gray-600">
            Violações de SLA detectadas e créditos recuperados
          </p>
        </div>
        <Button onClick={loadClaims} variant="secondary">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Atualizar
        </Button>
      </div>

      {/* Lista de Claims */}
      {claims.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                Nenhum claim de SLA encontrado
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Monitoramos continuamente seus serviços AWS. Quando detectamos uma violação de SLA, criamos automaticamente um claim.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {claims.map((claim) => (
            <Card key={claim.sk}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>Incidente AWS Health</CardTitle>
                    <p className="mt-1 text-sm text-gray-600">
                      {claim.service} • {claim.region}
                    </p>
                  </div>
                  {getStatusBadge(claim.status)}
                </div>
              </CardHeader>
              
              <CardContent className="space-y-6">
                {/* Informações do Incidente */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-gray-700">ID do Incidente</h4>
                    <p className="mt-1 text-sm text-gray-900 font-mono">{claim.incidentId}</p>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium text-gray-700">Conta AWS</h4>
                    <p className="mt-1 text-sm text-gray-900 font-mono">{claim.awsAccountId}</p>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium text-gray-700">Início do Incidente</h4>
                    <p className="mt-1 text-sm text-gray-900">
                      {new Date(claim.startTime).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  
                  {claim.endTime && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700">Fim do Incidente</h4>
                      <p className="mt-1 text-sm text-gray-900">
                        {new Date(claim.endTime).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  )}
                </div>

                {/* Impacto */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Impacto</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0">
                        <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Recursos Afetados</p>
                        <p className="text-lg font-semibold text-gray-900">{claim.impact.affectedResources}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0">
                        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Custo Estimado</p>
                        <p className="text-lg font-semibold text-gray-900">
                          {formatCurrency(claim.impact.estimatedCost)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Timeline de Status */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-4">Progresso</h4>
                  <div className="flex items-center justify-between">
                    {getStatusTimeline(claim).map((step, index) => (
                      <div key={step.key} className="flex-1">
                        <div className="flex items-center">
                          <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
                            step.completed ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'
                          }`}>
                            {step.completed ? (
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              <span className="text-xs">{index + 1}</span>
                            )}
                          </div>
                          {index < getStatusTimeline(claim).length - 1 && (
                            <div className={`flex-1 h-1 mx-2 ${
                              step.completed ? 'bg-green-600' : 'bg-gray-200'
                            }`} />
                          )}
                        </div>
                        <p className="mt-2 text-xs text-center text-gray-600">{step.label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Crédito Recuperado */}
                {claim.creditAmount && (
                  <Alert variant="success">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold">Crédito Recuperado!</h4>
                        <p className="mt-1 text-sm">
                          A AWS concedeu um crédito de {formatCurrency(claim.creditAmount)} para sua conta.
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-green-700">
                          {formatCurrency(claim.creditAmount)}
                        </p>
                      </div>
                    </div>
                  </Alert>
                )}

                {/* Ações */}
                <div className="flex items-center gap-3">
                  {claim.reportUrl && (
                    <Button
                      onClick={() => handleDownloadReport(claim.sk)}
                      variant="secondary"
                      size="sm"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Baixar Relatório PDF
                    </Button>
                  )}
                  
                  {claim.ticketId && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                      </svg>
                      <span>Ticket AWS: <span className="font-mono">{claim.ticketId}</span></span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
