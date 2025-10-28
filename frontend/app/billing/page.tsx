'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MainLayout } from '@/components/layouts/main-layout';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { apiFetch } from '@/lib/api';
import { DollarSign, TrendingUp, Award, CreditCard } from 'lucide-react';
import { toast } from 'sonner';

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

function BillingContent() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBilling();
  }, []);

  const loadBilling = async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/api/billing/summary');
      setSummary(data);
    } catch (err: any) {
      console.error('Erro ao carregar billing:', err);
      toast.error('Erro ao carregar dados de billing');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <MainLayout title="Billing">
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Billing & Economias">
      <div className="space-y-6">
        {/* Resumo Geral */}
        <div className="grid md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Valor Total Gerado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                ${summary?.summary.totalValue.toFixed(2) || '0.00'}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Suas Economias
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                ${summary?.summary.yourSavings.toFixed(2) || '0.00'}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Você mantém 70%
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CreditCard className="w-4 h-4" />
                Nossa Comissão
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${summary?.summary.ourCommission.toFixed(2) || '0.00'}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                30% sobre valor realizado
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Award className="w-4 h-4" />
                Créditos SLA
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">
                ${summary?.summary.totalCreditsRecovered.toFixed(2) || '0.00'}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {summary?.sla.refunded || 0} claims recuperados
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Detalhamento */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Recomendações Executadas</CardTitle>
              <CardDescription>
                Economias realizadas através de otimizações
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total Executadas</span>
                  <span className="font-bold">{summary?.recommendations.executed || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Economia Mensal</span>
                  <span className="font-bold text-green-600">
                    ${summary?.recommendations.totalSavings.toFixed(2) || '0.00'}/mês
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Economia Anual</span>
                  <span className="font-bold text-green-600">
                    ${((summary?.recommendations.totalSavings || 0) * 12).toFixed(2)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Créditos SLA</CardTitle>
              <CardDescription>
                Créditos recuperados de incidentes AWS
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Claims Processados</span>
                  <span className="font-bold">{summary?.sla.refunded || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total Recuperado</span>
                  <span className="font-bold text-purple-600">
                    ${summary?.sla.totalCredits.toFixed(2) || '0.00'}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  Créditos aplicados automaticamente na sua fatura AWS
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Explicação de Cobrança */}
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950">
          <CardHeader>
            <CardTitle className="text-blue-900 dark:text-blue-100">
              Como Funciona a Cobrança
            </CardTitle>
          </CardHeader>
          <CardContent className="text-blue-800 dark:text-blue-200 space-y-2">
            <p>
              ✅ Você só paga 30% sobre o valor <strong>realizado</strong> (não potencial)
            </p>
            <p>
              ✅ Economia em recomendações é calculada mensalmente
            </p>
            <p>
              ✅ Créditos SLA são cobrados uma única vez quando recuperados
            </p>
            <p>
              ✅ Nenhum custo fixo, nenhuma surpresa
            </p>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

export default function BillingPage() {
  return (
    <ProtectedRoute>
      <BillingContent />
    </ProtectedRoute>
  );
}
