'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MainLayout } from '@/components/layouts/main-layout';
import { apiFetch } from '@/lib/api';
import { DollarSign, Award, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

interface Recommendation {
  potentialSavings: number;
}

interface Claim {
  creditAmount: number;
}

export default function TrialPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [recData, claimsData] = await Promise.all([
          apiFetch('/api/recommendations'),
          apiFetch('/api/sla-claims'),
        ]);
        setRecommendations(recData.recommendations || []);
        setClaims(claimsData.claims || []);
      } catch (err: any) {
        console.error('Erro ao carregar dados do trial:', err);
        toast.error('Erro ao carregar dados');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const totalSavingsPotential = recommendations.reduce((sum, rec) => sum + (rec.potentialSavings || 0), 0);
  const totalCreditsPotential = claims.reduce((sum, claim) => sum + (claim.creditAmount || 0), 0);
  const totalPotential = totalSavingsPotential + totalCreditsPotential;

  if (loading) {
    return (
      <MainLayout title="Trial Dashboard">
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="AWS Cost Guardian - Trial">
      <div className="space-y-6">
        {/* Hero Message */}
        <Card className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">
          <CardContent className="pt-6">
            <h1 className="text-3xl font-bold mb-4">
              Bem-vindo ao AWS Cost Guardian!
            </h1>
            <p className="text-xl mb-6">
              Analisamos sua conta AWS e detectamos oportunidades incríveis de economia.
            </p>
            <div className="grid md:grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <DollarSign className="w-8 h-8 mx-auto mb-2" />
                <div className="text-2xl font-bold">${totalSavingsPotential.toFixed(2)}</div>
                <div className="text-sm">Economia mensal em recursos</div>
              </div>
              <div className="text-center">
                <Award className="w-8 h-8 mx-auto mb-2" />
                <div className="text-2xl font-bold">${totalCreditsPotential.toFixed(2)}</div>
                <div className="text-sm">Créditos SLA recuperáveis</div>
              </div>
              <div className="text-center">
                <TrendingUp className="w-8 h-8 mx-auto mb-2" />
                <div className="text-2xl font-bold">${totalPotential.toFixed(2)}</div>
                <div className="text-sm">Valor total potencial</div>
              </div>
            </div>
            <div className="text-center">
              <p className="text-lg mb-4">
                Detectamos <strong>${totalPotential.toFixed(2)}</strong> em economia mensal e créditos SLA recuperáveis na sua conta.
              </p>
              <p className="mb-6">
                Ative a versão completa para começar a economizar automaticamente. Cobramos apenas <strong>30%</strong> do valor recuperado.
              </p>
              <Button className="bg-white text-blue-600 hover:bg-gray-100 px-8 py-3 text-lg" onClick={() => router.push('/billing')}>
                Ativar Agora e Economizar →
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recommendations Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Recomendações Encontradas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Identificamos {recommendations.length} oportunidades de otimização em sua conta AWS.
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              {recommendations.slice(0, 4).map((rec, index) => (
                <div key={index} className="border rounded-lg p-4">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Recomendação {index + 1}</span>
                    <span className="text-green-600 font-bold">${rec.potentialSavings?.toFixed(2)}/mês</span>
                  </div>
                </div>
              ))}
            </div>
            {recommendations.length > 4 && (
              <p className="text-sm text-muted-foreground mt-4">
                E mais {recommendations.length - 4} recomendações...
              </p>
            )}
          </CardContent>
        </Card>

        {/* SLA Claims Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Créditos SLA</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Identificamos {claims.length} eventos de interrupção elegíveis para créditos SLA.
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              {claims.slice(0, 4).map((claim, index) => (
                <div key={index} className="border rounded-lg p-4">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Claim {index + 1}</span>
                    <span className="text-blue-600 font-bold">${claim.creditAmount?.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
            {claims.length > 4 && (
              <p className="text-sm text-muted-foreground mt-4">
                E mais {claims.length - 4} claims...
              </p>
            )}
          </CardContent>
        </Card>

        {/* Call to Action */}
        <Card className="text-center">
          <CardContent className="pt-6">
            <h2 className="text-2xl font-bold mb-4">Pronto para economizar?</h2>
            <p className="text-muted-foreground mb-6">
              Ative sua conta completa e deixe o AWS Cost Guardian trabalhar para você automaticamente.
            </p>
            <Button className="px-8 py-3 text-lg" onClick={() => router.push('/billing')}>
              Começar a Economizar Agora
            </Button>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
