'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DollarSign, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react';

export default function TrialPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleStartTrial = () => {
    setLoading(true);
    // Redirecionar para signup com parâmetro trial
    router.push('/login?mode=trial');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Análise Gratuita de Custos AWS
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Descubra quanto você pode economizar na AWS sem compromisso.
            Análise 100% automatizada em minutos.
          </p>
        </div>

        {/* Value Props */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card className="border-2 border-transparent hover:border-blue-500 transition-all">
            <CardHeader>
              <DollarSign className="w-12 h-12 text-green-500 mb-4" />
              <CardTitle>Economia Potencial</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 dark:text-gray-400">
                Identifique recursos ociosos, volumes não utilizados e oportunidades
                de otimização instantaneamente.
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 border-transparent hover:border-blue-500 transition-all">
            <CardHeader>
              <TrendingUp className="w-12 h-12 text-blue-500 mb-4" />
              <CardTitle>Créditos SLA</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 dark:text-gray-400">
                Calcule automaticamente créditos de SLA não reclamados devido a
                incidentes AWS Health.
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 border-transparent hover:border-blue-500 transition-all">
            <CardHeader>
              <AlertCircle className="w-12 h-12 text-orange-500 mb-4" />
              <CardTitle>Zero Risco</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 dark:text-gray-400">
                Apenas leitura. Nenhuma mudança será feita na sua conta AWS.
                Cancele quando quiser.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* CTA Section */}
        <Card className="max-w-3xl mx-auto bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-0">
          <CardHeader>
            <CardTitle className="text-3xl text-center">
              Comece Sua Análise Gratuita
            </CardTitle>
            <CardDescription className="text-blue-100 text-center text-lg">
              Veja o potencial de economia em menos de 5 minutos
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-300" />
                <span>Configuração em 1 clique via CloudFormation</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-300" />
                <span>Dashboard com análise completa de custos</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-300" />
                <span>Recomendações priorizadas por impacto</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-300" />
                <span>Sem cartão de crédito necessário</span>
              </div>
            </div>

            <Button
              size="lg"
              onClick={handleStartTrial}
              disabled={loading}
              className="w-full bg-white text-blue-600 hover:bg-blue-50 text-lg py-6"
            >
              {loading ? 'Iniciando...' : 'Iniciar Análise Gratuita'}
            </Button>

            <p className="text-xs text-blue-100 text-center">
              Ao continuar, você concorda com nossos Termos de Serviço e Política de Privacidade.
              Pague apenas 30% sobre economias realizadas após ativação completa.
            </p>
          </CardContent>
        </Card>

        {/* Social Proof */}
        <div className="mt-12 text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            92% das contas AWS deixam créditos de SLA na mesa 💰
          </p>
          <div className="flex justify-center gap-8 text-sm text-gray-500">
            <div>
              <div className="text-2xl font-bold text-blue-600">$150-500</div>
              <div>Economia média/trimestre</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-600">5min</div>
              <div>Setup completo</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-600">0%</div>
              <div>Risco</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
