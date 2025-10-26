'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { PiggyBank, AlertTriangle, Check, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Recommendation {
  id: string;
  sk: string;
  type: string;
  status: string;
  potentialSavings: number;
  details: any;
  createdAt: string;
  executedAt?: string;
  error?: string;
}

export default function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [orderBy, setOrderBy] = useState<'savings' | 'date'>('savings');

  useEffect(() => {
  fetchRecommendations();
  }, []);

  const fetchRecommendations = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/recommendations');
      if (!res.ok) {
        throw new Error('Falha ao carregar recomendações');
      }
      const data = await res.json();
      setRecommendations(data);
    } catch (err) {
      setError('Erro ao carregar recomendações');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async (recommendationId: string) => {
    try {
      setExecuting(prev => ({ ...prev, [recommendationId]: true }));
      
      const res = await fetch(`/api/recommendations/${recommendationId}/execute`, {
        method: 'POST'
      });
      
      if (!res.ok) {
        throw new Error('Falha ao executar recomendação');
      }
      
      // Atualizar a lista
      await fetchRecommendations();
    } catch (err) {
      setError('Erro ao executar recomendação');
      console.error(err);
    } finally {
      setExecuting(prev => ({ ...prev, [recommendationId]: false }));
    }
  };

  const getRecommendationTitle = (rec: Recommendation) => {
    switch (rec.type) {
      case 'UNUSED_EBS_VOLUME':
        return `Volume EBS não utilizado: ${rec.details.volumeId}`;
      case 'IDLE_INSTANCE':
        return `Instância ociosa: ${rec.details.instanceId}`;
      default:
        return 'Recomendação';
    }
  };

  const getRecommendationDescription = (rec: Recommendation) => {
    switch (rec.type) {
      case 'UNUSED_EBS_VOLUME':
        return `Volume EBS de ${rec.details.volumeSize}GB está sem uso desde ${formatDistanceToNow(new Date(rec.details.createTime), { 
          addSuffix: true, 
          locale: ptBR 
        })}`;
      case 'IDLE_INSTANCE':
        return `Instância com baixa utilização de CPU por um período prolongado`;
      default:
        return '';
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center">
          <Loader2 className="mr-2 h-8 w-8 animate-spin" />
          <span>Carregando recomendações...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Guardian Advisor</h1>
        <p className="text-muted-foreground">
          Recomendações para otimizar seus custos e recursos na AWS
        </p>
      </div>

      <div className="flex gap-4 mb-6">
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="border rounded px-2 py-1">
          <option value="all">Todos os tipos</option>
          <option value="UNUSED_EBS_VOLUME">Volumes EBS não utilizados</option>
          <option value="IDLE_INSTANCE">Instâncias ociosas</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border rounded px-2 py-1">
          <option value="all">Todos os status</option>
          <option value="RECOMMENDED">Recomendado</option>
          <option value="COMPLETED">Executado</option>
          <option value="FAILED">Falhou</option>
        </select>
        <Button variant="outline" onClick={() => setOrderBy(orderBy === 'savings' ? 'date' : 'savings')}>
          Ordenar por {orderBy === 'savings' ? 'Economia' : 'Data'}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {recommendations.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <div className="flex flex-col items-center text-center">
              <Check className="h-12 w-12 text-green-500 mb-4" />
              <h3 className="text-lg font-semibold mb-2">Nenhuma recomendação pendente</h3>
              <p className="text-muted-foreground">
                Seus recursos estão otimizados. Continuaremos monitorando e alertaremos quando houver novas oportunidades.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {recommendations
            .filter(rec => filterType === 'all' || rec.type === filterType)
            .filter(rec => filterStatus === 'all' || rec.status === filterStatus)
            .sort((a, b) => orderBy === 'savings' ? b.potentialSavings - a.potentialSavings : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((rec) => (
              <Card key={rec.sk}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {rec.type === 'UNUSED_EBS_VOLUME' ? <AlertTriangle className="h-5 w-5 text-red-500" /> : <PiggyBank className="h-5 w-5 text-green-600" />}
                    {getRecommendationTitle(rec)}
                  </CardTitle>
                  <CardDescription>{getRecommendationDescription(rec)}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-semibold text-green-600">
                        Economia potencial: ${rec.potentialSavings.toFixed(2)}/mês
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Criado {formatDistanceToNow(new Date(rec.createdAt), { addSuffix: true, locale: ptBR })}
                      </p>
                    </div>
                    {rec.status === 'RECOMMENDED' && (
                      <Button 
                        onClick={() => {
                          if (window.confirm('Deseja realmente executar esta recomendação?')) {
                            handleExecute(rec.sk.replace('REC#', ''));
                          }
                        }}
                        disabled={executing[rec.sk]}
                      >
                        {executing[rec.sk] ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Executando...
                          </>
                        ) : (
                          'Executar'
                        )}
                      </Button>
                    )}
                    {rec.status === 'COMPLETED' && (
                      <div className="flex items-center text-green-600">
                        <Check className="mr-2" />
                        Executado
                      </div>
                    )}
                    {rec.status === 'FAILED' && (
                      <div className="flex flex-col">
                        <div className="flex items-center text-red-600">
                          <AlertTriangle className="mr-2" />
                          Falha na execução
                        </div>
                        {rec.error && (
                          <p className="text-sm text-red-500 mt-1">{rec.error}</p>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}