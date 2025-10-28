'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MainLayout } from '@/components/layouts/main-layout';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { apiFetch } from '@/lib/api';
import { AlertCircle, CheckCircle, Clock, DollarSign } from 'lucide-react';
import { toast } from 'sonner';

interface Recommendation {
  id: string;
  type: string;
  status: string;
  potentialSavings: number;
  resourceArn: string;
  details: any;
  createdAt: string;
}

function RecommendationsContent() {
  const { t } = useTranslation();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState<string | null>(null);

  const loadRecommendations = async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/api/recommendations');
      setRecommendations(data.recommendations || []);
    } catch (err: any) {
      console.error('Erro ao carregar recomendações:', err);
      toast.error('Erro ao carregar recomendações');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecommendations();
  }, []);

  const handleExecute = async (recommendationId: string) => {
    if (!confirm('Deseja realmente executar esta recomendação? Esta ação não pode ser desfeita.')) {
      return;
    }

    try {
      setExecuting(recommendationId);
      await apiFetch('/api/recommendations/execute', {
        method: 'POST',
        body: JSON.stringify({ recommendationId }),
      });
      
      toast.success('Recomendação executada com sucesso!');
      await loadRecommendations();
    } catch (err: any) {
      console.error('Erro ao executar recomendação:', err);
      toast.error(err.message || 'Erro ao executar recomendação');
    } finally {
      setExecuting(null);
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'IDLE_INSTANCE':
        return 'Instância Ociosa';
      case 'UNUSED_EBS':
        return 'Volume EBS Não Utilizado';
      default:
        return type;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'RECOMMENDED':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'EXECUTED':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'IGNORED':
        return <AlertCircle className="w-5 h-5 text-gray-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-blue-500" />;
    }
  };

  const totalSavings = recommendations
    .filter(r => r.status === 'RECOMMENDED')
    .reduce((sum, r) => sum + (r.potentialSavings || 0), 0);

  return (
    <MainLayout title="Recomendações">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Economia Potencial</CardTitle>
            <CardDescription>
              Total de economia se todas as recomendações forem aplicadas
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <DollarSign className="w-8 h-8 text-green-500" />
              <span className="text-3xl font-bold">
                ${totalSavings.toFixed(2)}
              </span>
              <span className="text-muted-foreground">/mês</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recomendações de Otimização</CardTitle>
            <CardDescription>
              Ações sugeridas para reduzir custos AWS
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : recommendations.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  Nenhuma recomendação disponível no momento
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Conecte uma conta AWS para começar a receber recomendações
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    className="border rounded-lg p-4 hover:bg-accent transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex gap-3 flex-1">
                        {getStatusIcon(rec.status)}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium">{getTypeLabel(rec.type)}</h3>
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              rec.status === 'RECOMMENDED' ? 'bg-yellow-100 text-yellow-800' :
                              rec.status === 'EXECUTED' ? 'bg-green-100 text-green-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {rec.status}
                            </span>
                          </div>
                          
                          {rec.details && (
                            <div className="text-sm text-muted-foreground space-y-1">
                              {rec.details.instanceId && (
                                <p>Instância: {rec.details.instanceId} ({rec.details.instanceType})</p>
                              )}
                              {rec.details.cpuAvg !== undefined && (
                                <p>CPU média (24h): {rec.details.cpuAvg.toFixed(2)}%</p>
                              )}
                              {rec.details.tags && rec.details.tags.length > 0 && (
                                <div className="flex gap-1 flex-wrap mt-2">
                                  {rec.details.tags.slice(0, 3).map((tag: any, idx: number) => (
                                    <span key={idx} className="px-2 py-0.5 bg-secondary rounded text-xs">
                                      {tag.Key}: {tag.Value}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          
                          <p className="text-xs text-muted-foreground mt-2">
                            {new Date(rec.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <div className="text-lg font-bold text-green-600">
                          ${rec.potentialSavings.toFixed(2)}
                        </div>
                        <div className="text-xs text-muted-foreground">economia/mês</div>
                        
                        {rec.status === 'RECOMMENDED' && (
                          <Button
                            size="sm"
                            className="mt-2"
                            onClick={() => handleExecute(rec.id)}
                            disabled={executing === rec.id}
                          >
                            {executing === rec.id ? (
                              <>
                                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                                Executando...
                              </>
                            ) : (
                              'Executar'
                            )}
                          </Button>
                        )}
                        {rec.status === 'EXECUTING' && (
                          <div className="mt-2 text-xs text-yellow-600 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Em execução...
                          </div>
                        )}
                      </div>
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

export default function RecommendationsPage() {
  return (
    <ProtectedRoute>
      <RecommendationsContent />
    </ProtectedRoute>
  );
}
