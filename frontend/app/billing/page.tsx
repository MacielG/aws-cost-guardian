'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MainLayout } from '@/components/layouts/main-layout';
import { apiFetch } from '@/lib/api';
import { DollarSign, TrendingUp, Award, Calendar } from 'lucide-react';
import { toast } from 'sonner';

interface HistoryItem {
  type: 'saving' | 'credit';
  amount: number;
  timestamp: string;
  description: string;
}

interface Summary {
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

export default function BillingPage() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [historyData, summaryData] = await Promise.all([
          apiFetch('/api/billing/history'),
          apiFetch('/api/billing/summary'),
        ]);
        setHistory(historyData.history || []);
        setSummary(summaryData);
      } catch (err: any) {
        console.error('Erro ao carregar dados de billing:', err);
        toast.error('Erro ao carregar dados de cobrança');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  if (loading) {
    return (
      <MainLayout title="Cobrança">
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Cobrança e Valor Gerado">
      <div className="space-y-6">
        {/* Resumo */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center space-x-2">
                  <DollarSign className="w-5 h-5 text-green-500" />
                  <div>
                    <p className="text-2xl font-bold">${summary.summary.totalSavingsRealized.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Economias Realizadas</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center space-x-2">
                  <Award className="w-5 h-5 text-blue-500" />
                  <div>
                    <p className="text-2xl font-bold">${summary.summary.totalCreditsRecovered.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Créditos SLA Recuperados</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center space-x-2">
                  <TrendingUp className="w-5 h-5 text-purple-500" />
                  <div>
                    <p className="text-2xl font-bold">${summary.summary.ourCommission.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Nossa Comissão (30%)</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center space-x-2">
                  <DollarSign className="w-5 h-5 text-green-600" />
                  <div>
                    <p className="text-2xl font-bold">${summary.summary.yourSavings.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Seu Lucro Líquido</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ROI Explanation */}
        <Card>
          <CardHeader>
            <CardTitle>Como Funciona a Cobrança</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Cobramos apenas quando você economiza. Nossa comissão é de 30% sobre o valor total que recuperamos para você através de recomendações executadas e créditos SLA.
            </p>
            <div className="bg-green-50 p-4 rounded-lg">
              <p className="text-sm">
                <strong>Exemplo:</strong> Se recuperamos $1000 em economias para você, retemos $300 como comissão e você fica com $700 de lucro líquido.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Histórico */}
        <Card>
          <CardHeader>
            <CardTitle>Histórico de Valor Gerado</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Nenhum valor gerado ainda. Execute recomendações para começar a economizar!
              </p>
            ) : (
              <div className="space-y-4">
                {history.map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      {item.type === 'saving' ? (
                        <DollarSign className="w-5 h-5 text-green-500" />
                      ) : (
                        <Award className="w-5 h-5 text-blue-500" />
                      )}
                      <div>
                        <p className="font-medium">{item.description}</p>
                        <p className="text-sm text-muted-foreground flex items-center">
                          <Calendar className="w-4 h-4 mr-1" />
                          {new Date(item.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-green-600">
                        +${item.amount.toFixed(4)}/hora
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.type === 'saving' ? 'Economia horária' : 'Crédito recuperado'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
