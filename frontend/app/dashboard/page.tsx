// frontend/app/dashboard/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { DollarSign, Zap, ShieldCheck, TrendingUp, AlertCircle, ArrowRight, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AnimatedCounter } from '@/components/ui/animatedcounter';
import { PageAnimator } from '@/components/layout/PageAnimator';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/emptystate';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';

// Mock de dados da API para desenvolvimento
const mockSummary = {
  totalSavings: 12540.50,
  realizedSavings: 8778.35,
  recommendationsExecuted: 42,
  slaCreditsRecovered: 3762.15,
  monthlySavings: [
    { month: 'Jan', savings: 1200 },
    { month: 'Fev', savings: 1800 },
    { month: 'Mar', savings: 1500 },
    { month: 'Abr', savings: 2500 },
    { month: 'Mai', savings: 2200 },
    { month: 'Jun', savings: 3340.50 },
  ],
};

const mockRecommendations = [
  { id: 'rec-001', type: 'IDLE_INSTANCE', resourceId: 'i-1234567890abcdef0', potentialSaving: 120.50, status: 'EXECUTED' },
  { id: 'rec-002', type: 'UNUSED_EBS', resourceId: 'vol-0abcdef1234567890', potentialSaving: 25.00, status: 'ACTIVE' },
  { id: 'rec-003', type: 'IDLE_INSTANCE', resourceId: 'i-abcdef12345678901', potentialSaving: 88.75, status: 'ACTIVE' },
  { id: 'rec-004', type: 'OPTIMIZE_RDS', resourceId: 'db-instance-01', potentialSaving: 210.00, status: 'EXECUTED' },
  { id: 'rec-005', type: 'UNUSED_EIP', resourceId: '54.123.45.67', potentialSaving: 3.60, status: 'ACTIVE' },
];

const StatCard = ({ title, value, icon: Icon, color, prefix = "", suffix = "" }: any) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      <Icon className={`w-5 h-5 ${color}`} />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">
        <AnimatedCounter value={value} prefix={prefix} suffix={suffix} />
      </div>
    </CardContent>
  </Card>
);

const DashboardSkeleton = () => (
  <div className="space-y-8">
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-5 w-5 rounded-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-1/2" />
          </CardContent>
        </Card>
      ))}
    </div>
    <div className="grid gap-8 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle><Skeleton className="h-6 w-1/3" /></CardTitle></CardHeader>
        <CardContent><Skeleton className="h-64 w-full" /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle><Skeleton className="h-6 w-1/3" /></CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    </div>
  </div>
);

export default function DashboardPage() {
  const [summary, setSummary] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Simulação de chamada de API
        // const summaryRes = await fetch('/api/billing/summary');
        // const recsRes = await fetch('/api/recommendations?limit=5');
        // if (!summaryRes.ok || !recsRes.ok) throw new Error('Falha ao carregar dados do dashboard');
        // const summaryData = await summaryRes.json();
        // const recsData = await recsRes.json();
        
        // Usando dados mockados
        await new Promise(resolve => setTimeout(resolve, 1500)); // Simula delay de rede
        setSummary(mockSummary);
        setRecommendations(mockRecommendations);

      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <PageAnimator>
        <PageHeader title="Dashboard" description="Carregando suas métricas de economia..." />
        <DashboardSkeleton />
      </PageAnimator>
    );
  }

  if (error) {
    return (
      <PageAnimator>
        <EmptyState
          icon={AlertCircle}
          title="Erro ao Carregar Dashboard"
          description={error}
        />
      </PageAnimator>
    );
  }

  if (!summary) {
    return (
       <PageAnimator>
        <EmptyState
          icon={FileText}
          title="Bem-vindo ao seu Dashboard!"
          description="Ainda não temos dados para exibir. Conecte sua conta AWS para começar a ver suas economias."
          action={{ label: 'Conectar Conta AWS', onClick: () => window.location.href = '/onboard' }}
        />
      </PageAnimator>
    )
  }

  const recommendationStatusVariant: { [key: string]: "success" | "warning" | "default" } = {
    'ACTIVE': 'warning',
    'EXECUTED': 'success',
  };

  return (
    <PageAnimator>
      <PageHeader title="Dashboard" description="Sua visão geral de otimização de custos na AWS." />

      <motion.div
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.1 } }
        }}
      >
        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="cursor-pointer">
          <Link href="/billing">
            <StatCard title="Economia Total Potencial" value={summary.totalSavings} prefix="R$ " icon={DollarSign} color="text-green-500" />
          </Link>
        </motion.div>
        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="cursor-pointer">
          <Link href="/billing">
            <StatCard title="Suas Economias (70%)" value={summary.realizedSavings} prefix="R$ " icon={TrendingUp} color="text-blue-500" />
          </Link>
        </motion.div>
        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="cursor-pointer">
          <Link href="/recommendations">
            <StatCard title="Recomendações Executadas" value={summary.recommendationsExecuted} icon={Zap} color="text-orange-500" decimals={0} />
          </Link>
        </motion.div>
        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="cursor-pointer">
          <Link href="/sla-claims">
            <StatCard title="Créditos SLA Recuperados" value={summary.slaCreditsRecovered} prefix="R$ " icon={ShieldCheck} color="text-purple-500" />
          </Link>
        </motion.div>
      </motion.div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-5">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Economia Mensal (Últimos 6 Meses)</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.monthlySavings}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `R$${value}`} />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted))' }}
                    contentStyle={{
                      background: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 'var(--radius)',
                    }}
                  />
                  <Bar dataKey="savings" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recomendações Recentes</CardTitle>
              <Link href="/recommendations">
                <Button variant="ghost" size="sm">Ver todas <ArrowRight className="ml-2 h-4 w-4" /></Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recommendations.map((rec) => (
                  <div key={rec.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted">
                    <div>
                      <p className="font-medium">{rec.type.replace(/_/g, ' ')}</p>
                      <p className="text-sm text-muted-foreground">{rec.resourceId}</p>
                    </div>
                    <Badge variant={recommendationStatusVariant[rec.status]}>{rec.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </PageAnimator>
  );
}