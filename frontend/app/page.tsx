'use client';

import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { BarChart3, Shield, TrendingDown, DollarSign, Zap, Award } from 'lucide-react';
import { motion } from 'framer-motion';
import { PageAnimator } from '@/components/ui/PageAnimator';

export default function Home() {
return (
<PageAnimator>
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Hero Section */}
      <div className="container mx-auto px-6 py-16">
        <div className="max-w-4xl mx-auto text-center">
        <motion.h1
            initial={{ opacity: 0, y: -50 }}
              animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="text-4xl md:text-6xl font-bold text-gray-900 mb-6"
          >
        AWS Cost Guardian
      </motion.h1>
        <motion.p
            initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.8 }}
          className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto"
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
<Button className="px-8 py-3 text-lg">
Iniciar Análise Gratuita →
</Button>
</Link>
</motion.div>
</div>

{/* Benefits Section */}
<div className="max-w-6xl mx-auto mt-16">
  <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
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
    variants={{ hidden: { y: 50, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
    whileHover={{ y: -10, scale: 1.05 }}
    transition={{ duration: 0.3 }}
    className="bg-white/80 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-white/20 text-center hover:shadow-2xl transition-shadow"
  >
    <DollarSign className="w-12 h-12 text-green-500 mx-auto mb-4" />
  <h3 className="text-xl font-semibold mb-4">Economia Garantida</h3>
<p className="text-gray-600">
    Identificamos e desligamos instâncias EC2 ociosas, reduzindo sua fatura mensal em até 30%.
    </p>
    </motion.div>

    <motion.div
    variants={{ hidden: { y: 50, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
    whileHover={{ y: -10, scale: 1.05 }}
    transition={{ duration: 0.3 }}
    className="bg-white/80 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-white/20 text-center hover:shadow-2xl transition-shadow"
  >
            <Award className="w-12 h-12 text-blue-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-4">Créditos SLA Automáticos</h3>
              <p className="text-gray-600">
              Monitoramos interrupções de serviço e automaticamente reivindicamos créditos SLA da AWS por você.
              </p>
              </motion.div>

              <motion.div
    variants={{ hidden: { y: 50, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
    whileHover={{ y: -10, scale: 1.05 }}
    transition={{ duration: 0.3 }}
    className="bg-white/80 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-white/20 text-center hover:shadow-2xl transition-shadow"
  >
              <Zap className="w-12 h-12 text-orange-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-4">Sem Esforço</h3>
              <p className="text-gray-600">
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
            className="bg-white/90 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-white/20 mb-16 hover:shadow-2xl transition-shadow"
          >
            <h2 className="text-2xl font-bold text-center mb-6">
              Como Funciona Nosso Modelo
            </h2>
            <div className="max-w-3xl mx-auto text-center">
              <p className="text-lg text-gray-600 mb-6">
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
              <p className="text-sm text-gray-500 mt-4">
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
            className="bg-white/90 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-white/20 mb-16 hover:shadow-2xl transition-shadow"
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
                className="flex items-start space-x-4 p-4 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <BarChart3 className="w-8 h-8 text-blue-500 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold mb-2">Monitoramento em Tempo Real</h3>
                  <p className="text-gray-600">
                  Analisamos continuamente sua conta AWS para identificar oportunidades de economia.
                  </p>
                  </div>
                  </motion.div>

                  <motion.div
                variants={{ hidden: { x: -50, opacity: 0 }, visible: { x: 0, opacity: 1 } }}
                className="flex items-start space-x-4 p-4 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Shield className="w-8 h-8 text-green-500 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold mb-2">Execução Segura</h3>
                  <p className="text-gray-600">
                  Todas as ações são executadas com permissões mínimas e reversíveis.
                  </p>
                  </div>
                  </motion.div>

                  <motion.div
                variants={{ hidden: { x: -50, opacity: 0 }, visible: { x: 0, opacity: 1 } }}
                className="flex items-start space-x-4 p-4 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <TrendingDown className="w-8 h-8 text-orange-500 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold mb-2">Otimização Contínua</h3>
                  <p className="text-gray-600">
                  Identificamos padrões de uso e sugerimos melhorias para reduzir custos futuros.
                  </p>
                  </div>
                  </motion.div>

                  <motion.div
                variants={{ hidden: { x: -50, opacity: 0 }, visible: { x: 0, opacity: 1 } }}
                className="flex items-start space-x-4 p-4 rounded-lg hover:bg-gray-50 transition-colors"
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
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Pronto para começar a economizar?
            </h2>
            <p className="text-lg text-gray-600 mb-8">
              Cadastre-se gratuitamente e veja quanto você pode economizar na sua conta AWS.
            </p>
            <Link href="/login?mode=trial">
              <Button className="px-10 py-4 text-lg bg-green-600 hover:bg-green-700">
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