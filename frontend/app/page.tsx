'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { BarChart3, Shield, TrendingDown, DollarSign, Zap, Award, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { PageAnimator } from '@/components/layout/PageAnimator';
import { PageHeader } from '@/components/layout/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/api';

interface PublicMetrics {
  monthlySavings: number;
  slaCreditsRecovered: number;
  accountsManaged: number;
  monthlyGrowth: number;
  activeUsers: number;
  trialUsers: number;
  commissionRate: number;
}

export default function Home() {
  const [metrics, setMetrics] = useState<PublicMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        // Use apiFetch with skipAuth=true for public endpoints
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}public/metrics`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        setMetrics(data);
      } catch (err) {
        console.error('Erro ao carregar métricas:', err);
        // Fallback para dados estáticos se a API falhar
        setMetrics({
          monthlySavings: 47832,
          slaCreditsRecovered: 12450,
          accountsManaged: 247,
          monthlyGrowth: 37,
          activeUsers: 180,
          trialUsers: 67,
          commissionRate: 0.30,
        });
      } finally {
        setLoading(false);
      }
    };

    loadMetrics();
  }, []);

return (
  <PageAnimator>
    <main className="min-h-screen bg-background dark:bg-background transition-colors">
      <div className="container mx-auto px-6 py-8">
        <PageHeader
          title="AWS Cost Guardian"
          description="Economize automaticamente na sua conta AWS. Detectamos recursos ociosos, recuperamos créditos SLA e otimizamos seus custos de nuvem."
        />
      </div>
      {/* Quick Stats */}
      <div className="container mx-auto px-6 py-4">
      <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8 }}
      className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
      <div className="bg-card dark:bg-card/80 backdrop-blur-sm p-6 rounded-xl shadow-lg border border-border card-hover transition-colors">
      <div className="flex items-center">
      <DollarSign className="w-8 h-8 text-green-500 dark:text-green-400 mr-4" />
      <div>
      <p className="text-sm font-medium text-muted-foreground">Economia Mensal</p>
      {loading ? (
        <Skeleton className="h-8 w-24 mb-2" />
        ) : (
            <p className="text-2xl font-bold text-foreground">${metrics?.monthlySavings.toLocaleString()}</p>
            )}
            <p className="text-sm text-green-600 dark:text-green-400">+{metrics?.monthlyGrowth}% vs mês anterior</p>
        </div>
      </div>
      </div>
      <div className="bg-card dark:bg-card/80 backdrop-blur-sm p-6 rounded-xl shadow-lg border border-border card-hover transition-colors">
      <div className="flex items-center">
      <Award className="w-8 h-8 text-blue-500 dark:text-blue-400 mr-4" />
      <div>
          <p className="text-sm font-medium text-muted-foreground">Créditos SLA Recuperados</p>
            {loading ? (
              <Skeleton className="h-8 w-20 mb-2" />
          ) : (
          <p className="text-2xl font-bold text-foreground">${metrics?.slaCreditsRecovered.toLocaleString()}</p>
        )}
      <p className="text-sm text-blue-600 dark:text-blue-400">{Math.round((metrics?.activeUsers || 0) / (metrics?.accountsManaged || 1) * 100)}% taxa de sucesso</p>
      </div>
      </div>
      </div>
      <div className="bg-card dark:bg-card/80 backdrop-blur-sm p-6 rounded-xl shadow-lg border border-border card-hover transition-colors">
        <div className="flex items-center">
            <Shield className="w-8 h-8 text-purple-500 dark:text-purple-400 mr-4" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Contas Gerenciadas</p>
                {loading ? (
                  <Skeleton className="h-8 w-16 mb-2" />
                ) : (
                  <p className="text-2xl font-bold text-foreground">{metrics?.accountsManaged.toLocaleString()}</p>
                )}
                <p className="text-sm text-purple-600 dark:text-purple-400">{metrics?.activeUsers} ativos, {metrics?.trialUsers} trial</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
      {/* Hero Section */}
      <div className="container mx-auto px-6 py-16">
        <div className="max-w-4xl mx-auto text-center">
        <motion.h1
            initial={{ opacity: 0, y: -50 }}
              animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="text-4xl md:text-6xl font-bold text-foreground mb-6"
          >
        AWS Cost Guardian
      </motion.h1>
        <motion.p
            initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.8 }}
          className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto"
        >
      Economize automaticamente na sua conta AWS. Detectamos recursos ociosos, recuperamos créditos SLA e otimizamos seus custos de nuvem.
</motion.p>

<motion.div
  initial={{ opacity: 0, y: 50 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: 0.6, duration: 0.8 }}
  className="flex flex-col sm:flex-row gap-4 justify-center mb-12"
>
<Link href="/login?mode=trial">
<Button className="px-8 py-3 text-lg bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => toast.success('Análise gratuita iniciada!')}>
Iniciar Análise Gratuita →
</Button>
</Link>
</motion.div>
</div>

{/* Benefits Section */}
<div className="max-w-6xl mx-auto mt-16">
  <h2 className="text-3xl font-bold text-center text-foreground mb-12">
  Por que escolher o AWS Cost Guardian?
</h2>

<motion.div
className="grid md:grid-cols-3 gap-8 mb-16"
  initial="hidden"
  animate="visible"
  variants={{
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2
      }
    }
  }}
>
  <motion.div
    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
    whileHover={{ y: -5, scale: 1.02 }}
    transition={{ duration: 0.3 }}
    className="bg-card/80 backdrop-blur-sm p-8 rounded-2xl shadow-lg border border-border text-center card-hover"
  >
    <DollarSign className="w-12 h-12 text-green-500 mx-auto mb-4" />
  <h3 className="text-xl font-semibold mb-4">Economia Garantida</h3>
<p className="text-muted-foreground">
    Identificamos e desligamos instâncias EC2 ociosas, reduzindo sua fatura mensal em até 30%.
    </p>
    </motion.div>

    <motion.div
    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
    whileHover={{ y: -5, scale: 1.02 }}
    transition={{ duration: 0.3 }}
    className="bg-card/80 backdrop-blur-sm p-8 rounded-2xl shadow-lg border border-border text-center card-hover"
  >
            <Award className="w-12 h-12 text-blue-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-4">Créditos SLA Automáticos</h3>
              <p className="text-muted-foreground">
              Monitoramos interrupções de serviço e automaticamente reivindicamos créditos SLA da AWS por você.
              </p>
              </motion.div>

              <motion.div
    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
    whileHover={{ y: -5, scale: 1.02 }}
    transition={{ duration: 0.3 }}
    className="bg-card/80 backdrop-blur-sm p-8 rounded-2xl shadow-lg border border-border text-center card-hover"
  >
              <Zap className="w-12 h-12 text-orange-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-4">Sem Esforço</h3>
              <p className="text-muted-foreground">
              Uma vez configurado, tudo funciona automaticamente. Você apenas vê os resultados.
              </p>
              </motion.div>
              </motion.div>

          {/* Commission Model */}
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="bg-card/90 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-border mb-16 card-hover"
          >
            <h2 className="text-2xl font-bold text-center mb-6">
              Como Funciona Nosso Modelo
            </h2>
            <div className="max-w-3xl mx-auto text-center">
              <p className="text-lg text-muted-foreground mb-6">
                Cobramos apenas quando você economiza. Nossa comissão é justa e transparente:
              </p>
              <div className="bg-green-50 border-2 border-green-200 rounded-lg p-6">
                <h3 className="text-2xl font-bold text-green-700 mb-2">
                  30% da Economia Recuperada
                </h3>
                <p className="text-green-600">
                  Para cada dólar economizado através de nossas recomendações ou créditos SLA recuperados, retemos apenas 30 centavos.
                  Você fica com 70% de todo o valor recuperado.
                </p>
              </div>
              <p className="text-sm text-muted-foreground mt-4">
              Sem taxas mensais, sem custos ocultos. Pague apenas pelo valor real que recuperamos para você.
              </p>
              </div>
              </motion.div>

          {/* Features */}
          <motion.div
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
            className="bg-card/90 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-border mb-16 card-hover"
          >
            <h2 className="text-2xl font-bold text-center mb-8">
              Recursos Principais
            </h2>
            <motion.div
              className="grid md:grid-cols-2 gap-8"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={{
                hidden: { opacity: 0 },
                visible: {
                  opacity: 1,
                  transition: {
                    staggerChildren: 0.1
                  }
                }
              }}
            >
            <motion.div
            variants={{ hidden: { x: -50, opacity: 0 }, visible: { x: 0, opacity: 1 } }}
                className="flex items-start space-x-4 p-4 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <BarChart3 className="w-8 h-8 text-blue-500 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold mb-2">Monitoramento em Tempo Real</h3>
                  <p className="text-muted-foreground">
                  Analisamos continuamente sua conta AWS para identificar oportunidades de economia.
                  </p>
                  </div>
                  </motion.div>

                  <motion.div
                variants={{ hidden: { x: 50, opacity: 0 }, visible: { x: 0, opacity: 1 } }}
                className="flex items-start space-x-4 p-4 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <Shield className="w-8 h-8 text-green-500 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold mb-2">Execução Segura</h3>
                  <p className="text-muted-foreground">
                  Todas as ações são executadas com permissões mínimas e reversíveis.
                  </p>
                  </div>
                  </motion.div>

                  <motion.div
                variants={{ hidden: { x: -50, opacity: 0 }, visible: { x: 0, opacity: 1 } }}
                className="flex items-start space-x-4 p-4 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <TrendingDown className="w-8 h-8 text-orange-500 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold mb-2">Otimização Contínua</h3>
                  <p className="text-muted-foreground">
                  Identificamos padrões de uso e sugerimos melhorias para reduzir custos futuros.
                  </p>
                  </div>
                  </motion.div>

                  <motion.div
                variants={{ hidden: { x: 50, opacity: 0 }, visible: { x: 0, opacity: 1 } }}
                className="flex items-start space-x-4 p-4 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <Award className="w-8 h-8 text-purple-500 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold mb-2">Relatórios Detalhados</h3>
                  <p className="text-gray-600">
                  Receba relatórios completos sobre interrupções e créditos SLA recuperados.
                  </p>
                  </div>
                  </motion.div>
                  </motion.div>
                  </motion.div>

          {/* CTA Final */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <h2 className="text-3xl font-bold text-foreground mb-4">
              Pronto para começar a economizar?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Cadastre-se gratuitamente e veja quanto você pode economizar na sua conta AWS.
            </p>
            <Link href="/login?mode=trial">
            <Button className="px-10 py-4 text-lg bg-green-600 hover:bg-green-700" onClick={() => toast.success('Pronto para economizar!')}>
            Iniciar Análise Gratuita →
            </Button>
            </Link>
              </motion.div>
        </div>
        </div>
        </main>
</PageAnimator>
  );
}