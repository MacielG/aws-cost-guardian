'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingSpinner';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';
import { apiClient } from '@/lib/api';

interface AWSConnection {
  awsAccountId: string;
  roleArn: string;
  externalId: string;
  accountType: string;
  status: string;
  createdAt: string;
}

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<AWSConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get('/api/connections');
      setConnections(response.data || []);
    } catch (err: any) {
      console.error('Erro ao carregar conexões:', err);
      setError(err.message || 'Erro ao carregar conexões AWS');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (awsAccountId: string) => {
    if (!confirm('Tem certeza que deseja remover esta conexão?')) {
      return;
    }

    try {
      await apiClient.delete(`/api/connections/${awsAccountId}`);
      await loadConnections();
      alert('Conexão removida com sucesso!');
    } catch (err: any) {
      alert(`Erro ao remover conexão: ${err.message}`);
    }
  };

  if (loading) return <LoadingState message="Carregando conexões..." />;

  if (error) {
    return (
      <Alert variant="error">
        <h4 className="font-semibold">Erro ao carregar conexões</h4>
        <p className="mt-1 text-sm">{error}</p>
        <button onClick={loadConnections} className="mt-3 text-sm underline">
          Tentar novamente
        </button>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Conexões AWS</h1>
          <p className="mt-2 text-gray-600">
            Gerencie suas contas AWS conectadas
          </p>
        </div>
        <Link href="/onboard">
          <Button>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Adicionar Conta
          </Button>
        </Link>
      </div>

      {connections.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                Nenhuma conta AWS conectada
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Conecte sua primeira conta AWS para começar a economizar.
              </p>
              <div className="mt-6">
                <Link href="/onboard">
                  <Button>Conectar Conta AWS</Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {connections.map((conn) => (
            <Card key={conn.awsAccountId}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-gray-900">
                        AWS Account: {conn.awsAccountId}
                      </h3>
                      <Badge variant={conn.status === 'ACTIVE' ? 'success' : 'default'}>
                        {conn.status}
                      </Badge>
                      <Badge variant="info">{conn.accountType}</Badge>
                    </div>
                    
                    <div className="mt-3 space-y-2 text-sm text-gray-600">
                      <p><span className="font-medium">Role ARN:</span> {conn.roleArn}</p>
                      <p><span className="font-medium">Conectado em:</span> {new Date(conn.createdAt).toLocaleString('pt-BR')}</p>
                    </div>
                  </div>
                  
                  <Button
                    onClick={() => handleRemove(conn.awsAccountId)}
                    variant="danger"
                    size="sm"
                  >
                    Remover
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
