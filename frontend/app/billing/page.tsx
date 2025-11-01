'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { LoadingState } from '@/components/ui/LoadingSpinner';
import { Alert } from '@/components/ui/Alert';
import { apiClient } from '@/lib/api';

interface BillingData {
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

export default function BillingPage() {
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBillingData();
  }, []);

  const loadBillingData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get('/api/billing/summary');
      setBillingData(response.data);
    } catch (err: any) {
      console.error('Erro ao carregar billing:', err);
      setError(err.message || 'Erro ao carregar dados de billing');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  if (loading) return <LoadingState message="Carregando billing..." />;

  if (error) {
    return (
      <Alert variant="error">
        <h4 className="font-semibold">Erro ao carregar billing</h4>
        <p className="mt-1 text-sm">{error}</p>
        <button onClick={loadBillingData} className="mt-3 text-sm underline">
          Tentar novamente
        </button>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Billing</h1>
        <p className="mt-2 text-gray-600">
          Transparência total sobre suas economias e nossa comissão
        </p>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium text-gray-600">Total Economizado</h3>
            <p className="mt-2 text-3xl font-bold text-green-600">
              {formatCurrency(billingData?.summary.totalValue || 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium text-gray-600">Nossa Comissão (30%)</h3>
            <p className="mt-2 text-3xl font-bold text-gray-900">
              {formatCurrency(billingData?.summary.ourCommission || 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium text-gray-600">Suas Economias (70%)</h3>
            <p className="mt-2 text-3xl font-bold text-blue-600">
              {formatCurrency(billingData?.summary.yourSavings || 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Detalhamento</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-3 border-b">
              <div>
                <h4 className="font-medium">Recomendações Executadas</h4>
                <p className="text-sm text-gray-600">{billingData?.recommendations.executed} recomendações</p>
              </div>
              <p className="text-lg font-semibold">
                {formatCurrency(billingData?.recommendations.totalSavings || 0)}
              </p>
            </div>

            <div className="flex justify-between items-center py-3">
              <div>
                <h4 className="font-medium">Créditos SLA Recuperados</h4>
                <p className="text-sm text-gray-600">{billingData?.sla.refunded} claims</p>
              </div>
              <p className="text-lg font-semibold">
                {formatCurrency(billingData?.sla.totalCredits || 0)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Explicação */}
      <Alert variant="info">
        <h4 className="font-semibold">Como Funciona</h4>
        <div className="mt-2 text-sm space-y-2">
          <p>• Você só paga pelo que economiza (modelo baseado em sucesso)</p>
          <p>• Nossa comissão é de 30% sobre as economias realizadas</p>
          <p>• Você fica com 70% de todas as economias</p>
          <p>• Sem custos fixos ou mensalidades</p>
        </div>
      </Alert>
    </div>
  );
}
