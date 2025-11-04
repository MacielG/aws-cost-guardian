// frontend/app/billing/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { useNotify } from '@/hooks/useNotify';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import AnimatedCounter from '@/components/ui/AnimatedCounter';
import { DollarSign, TrendingUp, ShieldCheck, Info, Crown, ExternalLink, CheckCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';



const StatCard = ({ title, value, icon: Icon, color, prefix = "R$ ", decimals = 2 }: any) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      <Icon className={`w-5 h-5 ${color}`} />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">
        <AnimatedCounter value={value} formatValue={(v) => `${prefix}${v.toFixed(decimals)}`} />
      </div>
    </CardContent>
  </Card>
);

export default function BillingPage() {
  const [summary, setSummary] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const notify = useNotify();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [summaryData, historyData] = await Promise.all([
          apiClient.get('/billing/summary'),
          apiClient.get('/billing/history')
        ]);
        setSummary(summaryData);
        setHistory(historyData?.history || []);
      } catch (error: any) {
        console.error('Erro ao carregar dados de billing:', error);
        notify.error(error?.message || 'Erro ao carregar dados de faturamento');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [notify]);

  const handleUpgrade = async (priceId: string) => {
    try {
      const response = await apiClient.post('/api/create-checkout-session', {
        priceId,
        successUrl: `${window.location.origin}/dashboard?upgrade=success`,
        cancelUrl: `${window.location.origin}/billing?canceled=true`
      });

      if (response.data?.url) {
        window.location.href = response.data.url;
      } else {
        notify.error('Erro ao iniciar checkout');
      }
    } catch (error) {
      console.error('Erro no upgrade:', error);
      notify.error('Erro ao processar upgrade. Tente novamente.');
    }
  };

  const handleCustomerPortal = async () => {
    try {
      const response = await apiClient.get('/api/customer-portal');

      if (response.data?.url) {
        window.open(response.data.url, '_blank');
      } else {
        notify.error('Erro ao abrir portal de pagamentos');
      }
    } catch (error) {
      console.error('Erro no portal:', error);
      notify.error('Erro ao acessar portal de pagamentos');
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader
          title="Faturamento e Economias"
          description="Carregando seus dados de faturamento..."
        />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="h-4 bg-gray-200 rounded w-20 animate-pulse"></div>
                <div className="h-5 w-5 bg-gray-200 rounded animate-pulse"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-gray-200 rounded w-16 animate-pulse"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </>
    );
  }

  if (!summary) {
    return (
      <>
        <PageHeader
          title="Faturamento e Economias"
          description="Nenhum dado de faturamento encontrado."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Faturamento e Economias"
        description="Acompanhe suas economias, entenda nossa cobrança e veja seu histórico."
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard title="Total Economizado no Período" value={summary?.totalValue || 0} icon={DollarSign} color="text-green-500" />
        <StatCard title="Sua Economia Líquida (70%)" value={summary?.yourSavings || 0} icon={TrendingUp} color="text-blue-500" />
        <StatCard title="Nossa Comissão (30%)" value={summary?.ourCommission || 0} icon={ShieldCheck} color="text-purple-500" />
        <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Recomendações Executadas</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{summary?.recommendations?.executed || 0}</div>
            </CardContent>
        </Card>
      </div>

      <Alert className="mb-8">
        <Info className="h-4 w-4" />
        <AlertTitle>Como Funciona Nosso Modelo de Cobrança</AlertTitle>
        <AlertDescription>
          Nós cobramos uma comissão de 30% sobre o valor que **realmente** economizamos para você. Se não gerarmos economia, você não paga nada. Simples e transparente.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de Faturamento</CardTitle>
          <CardDescription>Veja o detalhamento de suas economias e faturas mensais.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Economia (Recomendações)</TableHead>
                <TableHead className="text-right">Economia (Créditos SLA)</TableHead>
                <TableHead className="text-right font-semibold">Total Economizado</TableHead>
                <TableHead className="text-right text-purple-500">Fatura (30%)</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Nenhum histórico de faturamento encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                history.map((item, index) => {
                  const timestamp = item?.timestamp;
                  const amount = typeof item?.amount === 'number' && !isNaN(item.amount) ? item.amount : null;
                  const type = item?.type;

                  const formattedDate = timestamp && !isNaN(new Date(timestamp).getTime()) ? new Date(timestamp).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : 'Data indisponível';
                  const formattedSaving = type === 'saving' && amount !== null ? `R$ ${amount.toFixed(2)}` : '-';
                  const formattedCredit = type === 'credit' && amount !== null ? `R$ ${amount.toFixed(2)}` : '-';
                  const formattedTotal = amount !== null ? `R$ ${amount.toFixed(2)}` : 'R$ 0.00';
                  const formattedCommission = amount !== null ? `R$ ${(amount * 0.3).toFixed(2)}` : 'R$ 0.00';

                  return (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{formattedDate}</TableCell>
                      <TableCell className="text-right">{formattedSaving}</TableCell>
                      <TableCell className="text-right">{formattedCredit}</TableCell>
                      <TableCell className="text-right font-semibold text-green-600">{formattedTotal}</TableCell>
                      <TableCell className="text-right font-medium text-purple-500">{formattedCommission}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="success">PAGO</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Upgrade e Gerenciamento de Pagamentos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="w-5 h-5" />
            Plano e Pagamentos
          </CardTitle>
          <CardDescription>
            Gerencie sua assinatura e métodos de pagamento
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <h3 className="font-medium">Plano Atual</h3>
              <p className="text-sm text-muted-foreground">
                Trial Gratuito - Acesso limitado a recomendações
              </p>
            </div>
            <Badge variant="outline">TRIAL</Badge>
          </div>

          <div className="border-t pt-4">
            <h3 className="font-medium mb-3">Upgrade para Active</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="border-primary">
                <CardHeader>
                  <CardTitle className="text-lg">Plano Professional</CardTitle>
                  <CardDescription>$99/mês</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Recomendações ilimitadas
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Execução automática
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      SLA Claims prioritários
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Suporte premium
                    </li>
                  </ul>
                  <Button className="w-full mt-4" onClick={() => handleUpgrade('price_123456789')}>
                    Upgrade Now
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Gerenciar Pagamentos</CardTitle>
                  <CardDescription>Stripe Customer Portal</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    Atualize cartão de crédito, veja faturas, cancele assinatura
                  </p>
                  <Button variant="outline" className="w-full" onClick={handleCustomerPortal}>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Abrir Portal de Pagamentos
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}