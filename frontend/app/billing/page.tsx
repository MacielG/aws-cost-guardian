// frontend/app/billing/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { useNotify } from '@/hooks/useNotify';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { DollarSign, TrendingUp, ShieldCheck, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

// Mock data - substitua pela chamada de API
const mockBillingSummary = {
  totalSavings: 8778.35,
  commissionRate: 0.30,
  netSavings: 8778.35 * (1 - 0.30),
  invoiceAmount: 8778.35 * 0.30,
  billingPeriod: '1 de Out - 31 de Out de 2023',
};

const mockSavingsHistory = [
  { month: 'Outubro 2023', totalSaved: 8778.35, recommendations: 5016.20, slaCredits: 3762.15, invoice: 2633.51, status: 'PAGO' },
  { month: 'Setembro 2023', totalSaved: 7540.10, recommendations: 7540.10, slaCredits: 0, invoice: 2262.03, status: 'PAGO' },
  { month: 'Agosto 2023', totalSaved: 6210.50, recommendations: 6210.50, slaCredits: 0, invoice: 1863.15, status: 'PAGO' },
];

const StatCard = ({ title, value, icon: Icon, color, prefix = "R$ ", decimals = 2 }: any) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      <Icon className={`w-5 h-5 ${color}`} />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">
        <AnimatedCounter value={value} prefix={prefix} decimals={decimals} />
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
  }, []);

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
    </>
  );
}