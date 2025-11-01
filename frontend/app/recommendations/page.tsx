'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/loadingspinner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api';
import PageShell from '@/components/layout/PageShell';

interface Recommendation {
  sk: string;
  type: string;
  status: string;
  resourceId: string;
  resourceType: string;
  region: string;
  potentialSavings: number;
  reason: string;
  createdAt: string;
  executedAt?: string;
}

export default function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executingIds, setExecutingIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    loadRecommendations();
  }, []);

  const loadRecommendations = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get('/api/recommendations');
      setRecommendations(response.data || []);
    } catch (err: any) {
      console.error('Erro ao carregar recomendações:', err);
      setError(err.message || 'Erro ao carregar recomendações');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async (recommendation: Recommendation) => {
    if (!confirm(`Tem certeza que deseja executar esta recomendação? Esta ação não pode ser desfeita.`)) {
      return;
    }

    try {
      setExecutingIds(prev => new Set(prev).add(recommendation.sk));
      
      await apiClient.post('/api/recommendations/execute', {
        recommendationId: recommendation.sk,
      });

      // Atualizar lista
      await loadRecommendations();
      
      alert('Recomendação executada com sucesso!');
    } catch (err: any) {
      console.error('Erro ao executar recomendação:', err);
      alert(`Erro ao executar: ${err.message}`);
    } finally {
      setExecutingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(recommendation.sk);
        return newSet;
      });
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { variant: 'default' | 'success' | 'warning' | 'danger' | 'info'; label: string }> = {
      RECOMMENDED: { variant: 'info', label: 'Recomendado' },
      EXECUTING: { variant: 'warning', label: 'Executando' },
      EXECUTED: { variant: 'success', label: 'Executado' },
      FAILED: { variant: 'danger', label: 'Falhou' },
      DISMISSED: { variant: 'default', label: 'Dispensado' },
    };

    const config = statusMap[status] || { variant: 'default', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };
  const getTypeLabel = (type: string) => {
    const typeMap: Record<string, string> = {
      IDLE_INSTANCE: 'Instância Ociosa',
      UNUSED_EBS: 'Volume EBS Não Utilizado',
      IDLE_RDS: 'RDS Ocioso',
      RESERVED_INSTANCE: 'Instância Reservada',
    };
    return typeMap[type] || type;
  };

  const filteredRecommendations = recommendations.filter(rec => {
    if (filter === 'all') return true;
    if (filter === 'active') return rec.status === 'RECOMMENDED';
    if (filter === 'executed') return rec.status === 'EXECUTED';
    return true;
  });

  if (loading) {
    return <LoadingState message="Carregando recomendações..." />;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="error">
          <h4 className="font-semibold">Erro ao carregar recomendações</h4>
          <p className="mt-1 text-sm">{error}</p>
          <button
            onClick={loadRecommendations}
            className="mt-3 text-sm underline hover:no-underline"
          >
            Tentar novamente
          </button>
        </Alert>
      </div>
    );
  }

  return (
    <PageShell title="Recomendações" subtitle="Sugestões automáticas para reduzir seus custos">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Recomendações</h1>
          <p className="mt-2 text-gray-600">
            Oportunidades de economia identificadas pela nossa IA
          </p>
        </div>
        <Button onClick={loadRecommendations} variant="secondary">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Atualizar
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            filter === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Todas ({recommendations.length})
        </button>
        <button
          onClick={() => setFilter('active')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            filter === 'active'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Ativas ({recommendations.filter(r => r.status === 'RECOMMENDED').length})
        </button>
        <button
          onClick={() => setFilter('executed')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            filter === 'executed'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Executadas ({recommendations.filter(r => r.status === 'EXECUTED').length})
        </button>
      </div>

      {/* Lista de Recomendações */}
      {filteredRecommendations.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                Nenhuma recomendação encontrada
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Conecte sua conta AWS para receber recomendações personalizadas.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredRecommendations.map((rec) => (
            <Card key={rec.sk}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {getTypeLabel(rec.type)}
                      </h3>
                      {getStatusBadge(rec.status)}
                    </div>
                    
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                        </svg>
                        <span className="font-medium">Recurso:</span>
                        <span>{rec.resourceId}</span>
                      </div>
                      
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="font-medium">Região:</span>
                        <span>{rec.region}</span>
                      </div>
                      
                      <div className="flex items-center gap-2 text-sm">
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="font-medium text-green-700">Economia Potencial:</span>
                        <span className="text-green-700 font-bold">{formatCurrency(rec.potentialSavings)}</span>
                      </div>
                      
                      <div className="mt-3 p-3 bg-gray-50 rounded-md">
                        <p className="text-sm text-gray-700">
                          <span className="font-medium">Motivo:</span> {rec.reason}
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-4 text-xs text-gray-500 mt-2">
                        <span>Criado em: {new Date(rec.createdAt).toLocaleString('pt-BR')}</span>
                        {rec.executedAt && (
                          <span>Executado em: {new Date(rec.executedAt).toLocaleString('pt-BR')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="ml-6">
                    {rec.status === 'RECOMMENDED' && (
                      <Button
                        onClick={() => handleExecute(rec)}
                        variant="primary"
                        isLoading={executingIds.has(rec.sk)}
                      >
                        Executar
                      </Button>
                    )}
                    {rec.status === 'EXECUTED' && (
                      <Badge variant="success">Concluído</Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
