// frontend/app/status/page.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api';
import { useNotify } from '@/hooks/useNotify';
import { motion } from 'framer-motion';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, CheckCircle, Clock, RefreshCw, Server, Shield } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { PageAnimator } from '@/components/layout/PageAnimator';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/emptystate';

interface AWSServiceStatus {
  status: 'operational' | 'degraded' | 'major_outage';
  incidents: Array<{
    eventTypeCode: string;
    eventDescription: string;
    startTime: string;
    lastUpdatedTime: string;
    region: string;
    availabilityZone: string;
    statusCode: string;
    affectedResources: number;
  }>;
}

interface GuardianServiceStatus {
  status: 'healthy' | 'error' | 'unknown';
  lastRun: string | null;
  message: string;
}

interface AWSStatus {
  timestamp: string;
  services: Record<string, AWSServiceStatus>;
  totalIncidents: number;
}

interface GuardianStatus {
  timestamp: string;
  overallStatus: 'healthy' | 'degraded' | 'error';
  services: {
    costIngestor: GuardianServiceStatus;
    correlateHealth: GuardianServiceStatus;
    automationSfn: GuardianServiceStatus;
    marketplaceMetering: GuardianServiceStatus;
  };
}

const StatusSkeleton = () => (
  <div className="space-y-8">
    <Card>
      <CardHeader><CardTitle><Skeleton className="h-6 w-1/3" /></CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle><Skeleton className="h-6 w-1/3" /></CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </CardContent>
    </Card>
  </div>
);

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'healthy':
    case 'operational':
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    case 'degraded':
      return <AlertCircle className="w-5 h-5 text-yellow-500" />;
    case 'error':
    case 'major_outage':
      return <AlertCircle className="w-5 h-5 text-red-500" />;
    default:
      return <Clock className="w-5 h-5 text-gray-500" />;
  }
};

const getStatusBadgeVariant = (status: string) => {
  switch (status) {
    case 'healthy':
    case 'operational':
      return 'default';
    case 'degraded':
      return 'secondary';
    case 'error':
    case 'major_outage':
      return 'destructive';
    default:
      return 'outline';
  }
};

const getServiceName = (serviceKey: string) => {
  const names: Record<string, string> = {
    costIngestor: 'Ingestão de Custos',
    correlateHealth: 'Correlação de Health Events',
    automationSfn: 'Automações (Step Functions)',
    marketplaceMetering: 'Medição do Marketplace'
  };
  return names[serviceKey] || serviceKey;
};

export default function StatusPage() {
  const [awsStatus, setAwsStatus] = useState<AWSStatus | null>(null);
  const [guardianStatus, setGuardianStatus] = useState<GuardianStatus>({
    timestamp: new Date().toISOString(),
    overallStatus: 'degraded',
    services: {
      costIngestor: { status: 'unknown', lastRun: null, message: '' },
      correlateHealth: { status: 'unknown', lastRun: null, message: '' },
      automationSfn: { status: 'unknown', lastRun: null, message: '' },
      marketplaceMetering: { status: 'unknown', lastRun: null, message: '' },
    },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const notify = useNotify();

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (process.env.NODE_ENV === 'development') {
        // Mock data for development
        const mockAwsData = {
            timestamp: new Date().toISOString(),
            services: {
                'EC2': { status: 'operational' as const, incidents: [], lastUpdatedTime: new Date().toISOString() },
                'S3': { status: 'operational' as const, incidents: [], lastUpdatedTime: new Date().toISOString() },
                'RDS': { status: 'operational' as const, incidents: [], lastUpdatedTime: new Date().toISOString() }
            },
            totalIncidents: 0
        };
        const mockGuardianServices = {
            costIngestor: { status: 'healthy' as const, lastRun: new Date().toISOString(), message: 'Última execução: 5 minutos atrás' },
            correlateHealth: { status: 'healthy' as const, lastRun: new Date().toISOString(), message: 'Última execução: 10 minutos atrás' },
            automationSfn: { status: 'healthy' as const, lastRun: new Date().toISOString(), message: 'Última execução: 15 minutos atrás' },
            marketplaceMetering: { status: 'healthy' as const, lastRun: new Date().toISOString(), message: 'Última execução: 2 minutos atrás' }
        };
        const mockGuardianData = {
          timestamp: new Date().toISOString(),
          services: mockGuardianServices,
          overallStatus: 'healthy' as const
        };
        setAwsStatus(mockAwsData);
        setGuardianStatus(mockGuardianData);
        setLastRefresh(new Date());
        return;
      }

      const [awsData, guardianData] = await Promise.all([
        apiClient.get('/api/system-status/aws'),
        apiClient.get('/api/system-status/guardian')
      ]);

      setAwsStatus(awsData);

      // Assuming guardianData from API is an object with 'services' and 'timestamp' properties
      // or just the services object directly. Let's assume it's the full GuardianStatus object
      // or at least contains 'services' and 'timestamp'.
      const guardianApiResponse: { services: GuardianStatus['services']; timestamp?: string; overallStatus?: GuardianStatus['overallStatus'] } = guardianData;

      // Transform guardianData to expected structure
      const services = guardianApiResponse.services;
      const overallStatus = Object.values(services).some(s => s.status === 'error') ? 'error' :
                           Object.values(services).some(s => s.status === 'unknown') ? 'degraded' : 'healthy';
      setGuardianStatus({ services, overallStatus, timestamp: guardianApiResponse.timestamp || new Date().toISOString() });
      setLastRefresh(new Date());
    } catch (err: any) {
      console.error('Erro ao carregar status:', err);
      const msg = err?.message || 'Erro ao carregar dados de status';
      setError(msg);
      notify.error(msg);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  if (loading) {
    return (
      <PageAnimator>
        <PageHeader title="Status do Sistema" description="Monitoramento de serviços AWS e componentes internos" />
        <StatusSkeleton />
      </PageAnimator>
    );
  }

  if (error) {
    return (
      <PageAnimator>
        <EmptyState
          icon={AlertCircle}
          title="Erro ao Carregar Status"
          description={error}
          action={{
            label: 'Tentar Novamente',
            onClick: fetchStatus
          }}
        />
      </PageAnimator>
    );
  }

  return (
    <PageAnimator>
      <div className="flex items-center justify-between">
        <PageHeader
          title="Status do Sistema"
          description="Monitoramento em tempo real dos serviços AWS e componentes internos"
        />
        <Button onClick={fetchStatus} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      <div className="text-sm text-muted-foreground mb-6">
        Última atualização: {formatDate(lastRefresh, 'pt-BR')}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Status dos Serviços AWS */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5" />
                Serviços AWS
              </CardTitle>
            </CardHeader>
            <CardContent>
              {awsStatus ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Incidentes Ativos</span>
                    <Badge variant={awsStatus.totalIncidents > 0 ? 'destructive' : 'default'}>
                      {awsStatus.totalIncidents}
                    </Badge>
                  </div>

                  {Object.entries(awsStatus.services).map(([service, serviceData]) => (
                    <div key={service} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(serviceData.status)}
                        <div>
                          <div className="font-medium">{service}</div>
                          {serviceData.incidents.length > 0 && (
                            <div className="text-sm text-muted-foreground">
                              {serviceData.incidents.length} incidente(s)
                            </div>
                          )}
                        </div>
                      </div>
                      <Badge variant={getStatusBadgeVariant(serviceData.status)}>
                        {serviceData.status === 'operational' ? 'Operacional' :
                         serviceData.status === 'degraded' ? 'Degradado' : 'Indisponível'}
                      </Badge>
                    </div>
                  ))}

                  {Object.keys(awsStatus.services).length === 0 && (
                    <div className="text-center text-muted-foreground py-4">
                      Todos os serviços operacionais
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  Dados indisponíveis
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Status dos Componentes Internos */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Componentes Internos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {guardianStatus ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Status Geral</span>
                    <Badge variant={getStatusBadgeVariant(guardianStatus.overallStatus)}>
                      {guardianStatus.overallStatus === 'healthy' ? 'Saudável' :
                       guardianStatus.overallStatus === 'degraded' ? 'Degradado' : 'Com Problemas'}
                    </Badge>
                  </div>

                  {Object.entries(guardianStatus.services).map(([service, serviceData]) => (
                    <div key={service} className="p-3 rounded-lg border">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          {getStatusIcon(serviceData.status)}
                          <span className="font-medium">{getServiceName(service)}</span>
                        </div>
                        <Badge variant={getStatusBadgeVariant(serviceData.status)}>
                          {serviceData.status === 'healthy' ? 'OK' :
                           serviceData.status === 'error' ? 'Erro' : 'Desconhecido'}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {serviceData.message}
                      </div>
                      {serviceData.lastRun && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Última execução: {formatDate(new Date(serviceData.lastRun), 'pt-BR')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  Dados indisponíveis
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Detalhes de Incidentes AWS */}
      {awsStatus && awsStatus.totalIncidents > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Detalhes dos Incidentes AWS</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(awsStatus.services).map(([service, serviceData]) =>
                  serviceData.incidents.map((incident, idx) => (
                    <div key={`${service}-${idx}`} className="p-4 rounded-lg border border-yellow-200 bg-yellow-50">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-medium">{service} - {incident.eventTypeCode}</h4>
                          <p className="text-sm text-muted-foreground">{incident.eventDescription}</p>
                        </div>
                        <Badge variant="secondary">{incident.statusCode}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="font-medium">Região:</span> {incident.region || 'N/A'}
                        </div>
                        <div>
                          <span className="font-medium">Recursos afetados:</span> {incident.affectedResources}
                        </div>
                        <div>
                          <span className="font-medium">Início:</span> {formatDate(new Date(incident.startTime), 'pt-BR')}
                        </div>
                        <div>
                          <span className="font-medium">Última atualização:</span> {formatDate(new Date(incident.lastUpdatedTime), 'pt-BR')}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </PageAnimator>
  );
}
