// frontend/app/billing/page.tsx
'use client';

import React from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { AnimatedCounter } from '@/components/ui/animatedcounter';
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
  return (
    <>
      <PageHeader
        title="Faturamento e Economias"
        description="Acompanhe suas economias, entenda nossa cobrança e veja seu histórico."
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard title="Total Economizado no Período" value={mockBillingSummary.totalSavings} icon={DollarSign} color="text-green-500" />
        <StatCard title="Sua Economia Líquida (70%)" value={mockBillingSummary.netSavings} icon={TrendingUp} color="text-blue-500" />
        <StatCard title="Nossa Comissão (30%)" value={mockBillingSummary.invoiceAmount} icon={ShieldCheck} color="text-purple-500" />
        <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Período de Faturamento</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{mockBillingSummary.billingPeriod}</div>
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
              {mockSavingsHistory.map((item) => (
                <TableRow key={item.month}>
                  <TableCell className="font-medium">{item.month}</TableCell>
                  <TableCell className="text-right">R$ {item.recommendations.toFixed(2)}</TableCell>
                  <TableCell className="text-right">R$ {item.slaCredits.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-semibold text-green-600">R$ {item.totalSaved.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-medium text-purple-500">R$ {item.invoice.toFixed(2)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={item.status === 'PAGO' ? 'success' : 'warning'}>{item.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}