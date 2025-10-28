'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MainLayout } from '@/components/layouts/main-layout';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { apiFetch } from '@/lib/api';
import { Users, TrendingUp, DollarSign, Activity, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface AdminMetrics {
  customers: {
    total: number;
    trial: number;
    active: number;
    churnedThisMonth: number;
  };
  revenue: {
    thisMonth: number;
    lastMonth: number;
    growth: number;
  };
  leads: {
    newThisWeek: number;
    conversionRate: number;
    highValueCount: number;
  };
  recommendations: {
    totalGenerated: number;
    executed: number;
    executionRate: number;
  };
  sla: {
    claimsDetected: number;
    claimsSubmitted: number;
    creditsRecovered: number;
  };
}

function AdminContent() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/api/admin/metrics');
      setMetrics(data);
    } catch (err: any) {
      console.error('Erro ao carregar métricas:', err);
      toast.error('Erro ao carregar métricas admin');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <MainLayout title="Admin Dashboard">
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Admin Dashboard">
      <div className="space-y-6">
        {/* KPIs Principais */}
        <div className="grid md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="w-4 h-4" />
                Total Clientes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics?.customers.total || 0}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {metrics?.customers.active || 0} Active | {metrics?.customers.trial || 0} Trial
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Receita (Mês)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                ${metrics?.revenue.thisMonth.toFixed(2) || '0.00'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {metrics && metrics.revenue.growth > 0 ? '+' : ''}
                {metrics?.revenue.growth.toFixed(1) || 0}% vs último mês
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Taxa Conversão
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {metrics?.leads.conversionRate.toFixed(1) || 0}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {metrics?.leads.newThisWeek || 0} novos leads esta semana
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Execuções
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">
                {metrics?.recommendations.executionRate.toFixed(1) || 0}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {metrics?.recommendations.executed || 0} de {metrics?.recommendations.totalGenerated || 0}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detalhes */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Funil de Conversão</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Leads (Trial)</span>
                <span className="font-bold">{metrics?.customers.trial || 0}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full" 
                  style={{ width: '100%' }}
                />
              </div>

              <div className="flex justify-between items-center mt-4">
                <span className="text-sm text-muted-foreground">Convertidos (Active)</span>
                <span className="font-bold text-green-600">{metrics?.customers.active || 0}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-green-500 h-2 rounded-full" 
                  style={{ 
                    width: `${metrics?.leads.conversionRate || 0}%` 
                  }}
                />
              </div>

              <div className="flex justify-between items-center mt-4">
                <span className="text-sm text-muted-foreground">Churn (Este Mês)</span>
                <span className="font-bold text-red-600">{metrics?.customers.churnedThisMonth || 0}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Créditos SLA</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Claims Detectados</span>
                <span className="font-bold">{metrics?.sla.claimsDetected || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Claims Submetidos</span>
                <span className="font-bold text-blue-600">{metrics?.sla.claimsSubmitted || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Total Recuperado</span>
                <span className="font-bold text-green-600">
                  ${metrics?.sla.creditsRecovered.toFixed(2) || '0.00'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Nossa Comissão (30%)</span>
                <span className="font-bold text-purple-600">
                  ${((metrics?.sla.creditsRecovered || 0) * 0.3).toFixed(2)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Leads de Alto Valor */}
        {metrics && metrics.leads.highValueCount > 0 && (
          <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950">
            <CardHeader>
              <CardTitle className="text-orange-900 dark:text-orange-100 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                Leads de Alto Valor
              </CardTitle>
            </CardHeader>
            <CardContent className="text-orange-800 dark:text-orange-200">
              <p>
                🔥 <strong>{metrics.leads.highValueCount} leads</strong> com economia potencial &gt; $500/mês detectados.
                Ação recomendada: Contato proativo para conversão.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}

export default function AdminPage() {
  return (
    <ProtectedRoute>
      <AdminContent />
    </ProtectedRoute>
  );
}
