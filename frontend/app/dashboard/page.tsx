'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { LoadingState } from '@/components/ui/loadingspinner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { SavingsChart } from '@/components/charts/SavingsChart';
import { RecommendationsChart } from '@/components/charts/RecommendationsChart';
import PageShell from '@/components/layout/PageShell';

interface BillingSummary {
  summary: {
    totalSavingsRealized: number;
    totalCreditsRecovered: number;
    totalValue: number;
    ourCommission: number;
    yourSavings: number;
  };
  recommendations: {
    executed: number;
    totalSavings: number;
  };
  sla: {
    refunded: number;
    totalCredits: number;
  };
}

interface Recommendation {
  sk: string;
  type: string;
  status: string;
  potentialSavings: number;
  createdAt: string;
}

export default function DashboardPage() {
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [recentRecommendations, setRecentRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Carregar dados em paralelo
      const [summaryRes, recsRes] = await Promise.all([
        apiClient.get('/api/billing/summary'),
        apiClient.get('/api/recommendations?limit=5'),
      ]);

      setBillingSummary(summaryRes.data);
      setRecentRecommendations(recsRes.data || []);
    } catch (err: any) {
      console.error('Erro ao carregar dashboard:', err);
      setError(err.message || 'Erro ao carregar dados do dashboard');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingState message="Carregando dashboard..." />;
  }

  if (error) {
    return (
      <PageShell title="Dashboard" subtitle="Visão geral das suas economias e recomendações AWS">
        <Alert variant="error">
          <h4 className="font-semibold">Erro ao carregar dashboard</h4>
          <p className="mt-1 text-sm">{error}</p>
          <button
            onClick={loadDashboardData}
            className="mt-3 text-sm underline hover:no-underline"
          >
            Tentar novamente
          </button>
        </Alert>
      </PageShell>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { variant: 'default' | 'success' | 'warning' | 'danger' | 'info'; label: string }> = {
      RECOMMENDED: { variant: 'info', label: 'Recomendado' },
      EXECUTING: { variant: 'warning', label: 'Executando' },
      EXECUTED: { variant: 'success', label: 'Executado' },
      FAILED: { variant: 'danger', label: 'Falhou' },
      DISMISSED: { variant: 'default', label: 'Dispensado' },
    };

    const config = statusMap[status] || { variant: 'default', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getTypeLabel = (type: string) => {
    const typeMap: Record<string, string> = {
      IDLE_INSTANCE: 'Instância Ociosa',
      UNUSED_EBS: 'Volume EBS Não Utilizado',
      IDLE_RDS: 'RDS Ocioso',
      RESERVED_INSTANCE: 'Instância Reservada',
    };
    return typeMap[type] || type;
  };

  return (
    <PageShell title="Dashboard" subtitle="Visão geral das suas economias e recomendações AWS">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-2 text-gray-600">
          Visão geral das suas economias e recomendações AWS
        </p>
      </div>

      {/* Métricas Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total de Economias */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Economias Totais
                </p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {formatCurrency(billingSummary?.summary.totalValue || 0)}
                </p>
              </div>
              <div className="p-3 bg-green-100 rounded-full">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Recomendações + SLA Credits
            </p>
          </CardContent>
        </Card>

        {/* Suas Economias */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Suas Economias
                </p>
                <p className="mt-2 text-3xl font-bold text-blue-600">
                  {formatCurrency(billingSummary?.summary.yourSavings || 0)}
                </p>
              </div>
              <div className="p-3 bg-blue-100 rounded-full">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Após nossa comissão de 30%
            </p>
          </CardContent>
        </Card>

        {/* Recomendações Executadas */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Recomendações
                </p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {billingSummary?.recommendations.executed || 0}
                </p>
              </div>
              <div className="p-3 bg-purple-100 rounded-full">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Executadas com sucesso
            </p>
          </CardContent>
        </Card>

        {/* SLA Credits */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Créditos SLA
                </p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {formatCurrency(billingSummary?.sla.totalCredits || 0)}
                </p>
              </div>
              <div className="p-3 bg-yellow-100 rounded-full">
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                </svg>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {billingSummary?.sla.refunded || 0} claims recuperados
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recomendações Recentes */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recomendações Recentes</CardTitle>
            <Link
              href="/recommendations"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Ver todas →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recentRecommendations.length === 0 ? (
            <div className="text-center py-8">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                Nenhuma recomendação ainda
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Conecte sua conta AWS para receber recomendações de economia.
              </p>
              <div className="mt-6">
                <Link href="/onboard">
                  <button className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700">
                    Conectar AWS
                  </button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {recentRecommendations.map((rec) => (
                <div key={rec.sk} className="py-4 flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h4 className="text-sm font-medium text-gray-900">
                        {getTypeLabel(rec.type)}
                      </h4>
                      {getStatusBadge(rec.status)}
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      Economia potencial: {formatCurrency(rec.potentialSavings)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {new Date(rec.createdAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <Link href="/recommendations">
                    <button className="ml-4 text-sm text-blue-600 hover:text-blue-700 font-medium">
                      Ver detalhes
                    </button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico de Economias ao Longo do Tempo */}
        <Card>
          <CardHeader>
            <CardTitle>Economias ao Longo do Tempo</CardTitle>
          </CardHeader>
          <CardContent>
            <SavingsChart data={generateMockSavingsData()} />
          </CardContent>
        </Card>

        {/* Gráfico de Recomendações por Tipo */}
        <Card>
          <CardHeader>
            <CardTitle>Economias por Tipo de Recomendação</CardTitle>
          </CardHeader>
          <CardContent>
            <RecommendationsChart data={generateMockRecommendationsData()} />
          </CardContent>
        </Card>
      </div>

      {/* Call to Action */}
      {(billingSummary?.recommendations.executed || 0) === 0 && (
        <Alert variant="info">
          <h4 className="font-semibold">Comece a economizar agora!</h4>
          <p className="mt-1 text-sm">
            Conecte sua conta AWS e receba recomendações automáticas de economia.
            Nossa IA analisa continuamente seus recursos e identifica oportunidades.
          </p>
          <Link href="/onboard" className="mt-3 inline-block">
            <button className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
              Conectar Conta AWS
            </button>
          </Link>
        </Alert>
      )}
    </PageShell>
  );
}

// Funções auxiliares para gerar dados mock dos gráficos
// TODO: Substituir por dados reais da API quando disponível
function generateMockSavingsData() {
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'];
  return months.map((month, i) => ({
    month,
    savings: Math.floor(Math.random() * 500) + 100 * (i + 1),
    slaCredits: Math.floor(Math.random() * 200) + 50 * (i + 1),
  }));
}

function generateMockRecommendationsData() {
  return [
    { type: 'Instâncias Ociosas', count: 12, savings: 1200 },
    { type: 'Volumes EBS', count: 8, savings: 450 },
    { type: 'RDS Ocioso', count: 3, savings: 800 },
    { type: 'Instâncias Reservadas', count: 5, savings: 2100 },
  ];
}
