 'use client';
import React, { useState, useEffect } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { apiClientFn } from '@/lib/api';
import { apiClient } from '@/lib/api';
import { PageAnimator } from '@/components/layout/PageAnimator';

interface AwsConnection {
  awsAccountId: string;
  status: string;
  roleArn: string;
}

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<AwsConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchConnections = async () => {
      setIsLoading(true);
      try {
        const data = await apiClientFn<AwsConnection[]>('/api/connections');
        setConnections(data || []);
      } catch (err: any) {
        setError(err.message || 'Falha ao buscar conexões.');
      }
      setIsLoading(false);
    };
    fetchConnections();
  }, []);

  const handleAddConnection = () => {
    window.location.href = '/onboard';
  };
  
  const handleDelete = async (accountId: string) => {
    if (!confirm(`Tem certeza que deseja remover a conta ${accountId}?`)) {
      return;
    }
    
    try {
      await apiClient(`/api/connections/${accountId}`, {
        method: 'DELETE',
      });
      setConnections(connections.filter(c => c.awsAccountId !== accountId));
    } catch (err: any) {
      alert(`Falha ao remover conta: ${err.message}`);
    }
  };

  return (
    <PageAnimator>
      <PageHeader title="Conexões AWS" description="Gerencie as contas AWS conectadas à plataforma.">
        <Button onClick={handleAddConnection}>
          <Plus className="mr-2 h-4 w-4" />
          Adicionar Nova Conta
        </Button>
      </PageHeader>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Contas Conectadas</CardTitle>
            <CardDescription>
              Estas são as contas que o Cost Guardian está monitorando.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}
            {error && (
              <p className="text-center text-destructive">{error}</p>
            )}
            {!isLoading && !error && (
              <ul className="divide-y divide-gray-200">
                {connections.length === 0 && (
                  <li className="py-4 text-center text-muted-foreground">
                    Nenhuma conta AWS conectada.
                  </li>
                )}
                {connections.map((conn) => (
                  <li key={conn.awsAccountId} className="flex items-center justify-between py-4">
                    <div>
                      <p className="font-medium text-gray-900">{conn.awsAccountId}</p>
                      <p className="text-sm text-muted-foreground">{conn.status === 'ACTIVE' ? 'Ativa' : 'Pendente'}</p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      onClick={() => handleDelete(conn.awsAccountId)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageAnimator>
  );
}
