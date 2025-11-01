'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MainLayout } from '@/components/layouts/main-layout';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { apiFetch } from '@/lib/api';
import { Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface Connection {
  awsAccountId: string;
  roleArn: string;
  status: string;
  connectedAt: string;
  externalId: string;
}

function ConnectionsContent() {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadConnections = async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/api/connections');
      setConnections(data.connections || []);
    } catch (err: any) {
      console.error('Erro ao carregar conexões:', err);
      toast.error('Erro ao carregar conexões AWS');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConnections();
  }, []);

  const handleDelete = async (awsAccountId: string) => {
    if (!confirm(`Deseja realmente remover a conexão com a conta ${awsAccountId}?`)) {
      return;
    }

    try {
      setDeleting(awsAccountId);
      await apiFetch(`/api/connections/${awsAccountId}`, { method: 'DELETE' });
      toast.success('Conexão removida com sucesso');
      await loadConnections();
    } catch (err: any) {
      console.error('Erro ao remover conexão:', err);
      toast.error('Erro ao remover conexão');
    } finally {
      setDeleting(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return 'bg-green-500';
      case 'PENDING_CFN':
        return 'bg-yellow-500';
      case 'ERROR':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <MainLayout title="Conexões AWS">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Contas AWS Conectadas</CardTitle>
            <CardDescription>
              Gerencie as contas AWS conectadas ao Cost Guardian
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : connections.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">
                  Nenhuma conta AWS conectada
                </p>
                <Button onClick={() => window.location.href = '/onboard'}>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Conectar Conta AWS
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {connections.map((conn) => (
                  <div
                    key={conn.awsAccountId}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${getStatusColor(conn.status)}`} />
                        <div>
                          <p className="font-medium">{conn.awsAccountId}</p>
                          <p className="text-sm text-muted-foreground">
                            {conn.roleArn}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Conectado em: {new Date(conn.connectedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs ${
                        conn.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                        conn.status === 'PENDING_CFN' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {conn.status}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-600 hover:bg-red-50"
                        onClick={() => handleDelete(conn.awsAccountId)}
                        disabled={deleting === conn.awsAccountId}
                      >
                        {deleting === conn.awsAccountId ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
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

export default function ConnectionsPage() {
  return (
    <ProtectedRoute>
      <ConnectionsContent />
    </ProtectedRoute>
  );
}
