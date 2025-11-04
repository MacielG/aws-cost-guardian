// frontend/app/settings/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useNotify } from '@/hooks/useNotify';
import { apiClient } from '@/lib/api';
import { Cloud, User, Bell, CreditCard, Bot, Trash2, Link as LinkIcon, PlusCircle, RefreshCw, AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';

interface AWSConnection {
  alias: string;
  accountId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ERROR';
  connectionDate: string;
  lastSync: string | null;
}

const statusVariant: { [key: string]: "success" | "secondary" | "destructive" } = {
  'ACTIVE': 'success',
  'INACTIVE': 'secondary',
  'ERROR': 'destructive',
};

export default function SettingsPage() {
  const notify = useNotify();
  // Estado real - será carregado das APIs
  const [profile, setProfile] = useState({ name: '', email: '' });
  const [automation, setAutomation] = useState({ enabled: true, threshold: 80 });
  const [connections, setConnections] = useState<AWSConnection[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        // Carregar perfil do usuário
        const profileResponse = await apiClient.get('/api/profile');
        setProfile({
          name: profileResponse.profile.name || '',
          email: profileResponse.profile.email || '',
        });

        // Carregar configurações de automação
        const automationResponse = await apiClient.get('/settings/automation');
        setAutomation(automationResponse);

        // Carregar conexões AWS
        setLoadingConnections(true);
        const connectionsResponse = await apiClient.get('/connections');
        setConnections(connectionsResponse.connections || []);
      } catch (err: any) {
        console.error('Erro ao carregar dados:', err);
        notify.error('Erro ao carregar configurações');
      } finally {
        setLoadingConnections(false);
      }
    };

    loadData();
  }, [notify]);

  const handleSaveProfile = async () => {
    try {
      await apiClient.put('/api/profile', profile);
      notify.success('Perfil atualizado com sucesso!');
    } catch (err: any) {
      console.error('Erro ao salvar perfil:', err);
      notify.error('Erro ao atualizar perfil');
    }
  };

  const handleSaveAutomation = async () => {
    try {
      await apiClient.put('/settings/automation', automation);
      notify.success('Configurações de automação atualizadas!');
    } catch (err: any) {
      console.error('Erro ao salvar automação:', err);
      notify.error('Erro ao atualizar configurações de automação');
    }
  };

  const handleSaveChanges = (section: string) => {
    switch (section) {
      case 'profile':
        handleSaveProfile();
        break;
      case 'automation':
        handleSaveAutomation();
        break;
      default:
        notify.info(`Salvando alterações na seção ${section}...`);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    try {
      await apiClient.delete(`/connections/${accountId}`);
      notify.success(`Conta ${accountId} desconectada com sucesso!`);
      // Recarregar conexões
      const connectionsResponse = await apiClient.get('/connections');
      setConnections(connectionsResponse.connections || []);
    } catch (err: any) {
      console.error('Erro ao desconectar conta:', err);
      notify.error('Erro ao desconectar conta');
    }
  }

  return (
    <>
      <PageHeader
        title="Configurações"
        description="Gerencie seu perfil, contas conectadas e preferências de automação."
      />

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList>
          <TabsTrigger value="profile"><User className="mr-2 h-4 w-4" />Perfil</TabsTrigger>
          <TabsTrigger value="accounts"><Cloud className="mr-2 h-4 w-4" />Contas AWS</TabsTrigger>
          <TabsTrigger value="automation"><Bot className="mr-2 h-4 w-4" />Automação</TabsTrigger>
          <TabsTrigger value="notifications"><Bell className="mr-2 h-4 w-4" />Notificações</TabsTrigger>
          <TabsTrigger value="billing"><CreditCard className="mr-2 h-4 w-4" />Faturamento</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Perfil do Usuário</CardTitle>
              <CardDescription>Atualize suas informações pessoais e foto.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
                  <AvatarFallback>CN</AvatarFallback>
                </Avatar>
                <Button variant="outline">Alterar Foto</Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" value={profile.name} onChange={(e) => setProfile(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={profile.email} disabled />
                </div>
              </div>
            </CardContent>
            <div className="p-6 pt-0 flex justify-end">
              <Button onClick={() => handleSaveChanges('Perfil')}>Salvar Alterações</Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="accounts">
          <Card>
            <CardHeader>
              <CardTitle>Contas AWS Conectadas</CardTitle>
              <CardDescription>Gerencie as contas AWS que o Cost Guardian monitora.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {loadingConnections ? (
                [...Array(2)].map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)
              ) : (
                <>
                  {connections.map((conn) => (
                    <Card key={conn.accountId} className="flex flex-col">
                      <CardHeader className="flex-row items-start gap-4 space-y-0">
                        <div className="flex-shrink-0 w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                          <Cloud className="w-6 h-6 text-foreground" />
                        </div>
                        <div className="flex-1">
                          <CardTitle className="text-base mb-1">{conn.alias}</CardTitle>
                          <p className="text-xs font-mono text-muted-foreground">ID: {conn.accountId}</p>
                        </div>
                        <Badge variant={statusVariant[conn.status]}>{conn.status}</Badge>
                      </CardHeader>
                      <CardContent className="flex-1 space-y-2 text-sm">
                        <p className="text-muted-foreground">Conectada em: <span className="font-medium text-foreground">{new Date(conn.connectionDate).toLocaleDateString()}</span></p>
                        <p className="text-muted-foreground">Última Sincronização: <span className="font-medium text-foreground">{conn.lastSync ? new Date(conn.lastSync).toLocaleString() : 'Nunca'}</span></p>
                      </CardContent>
                      <div className="p-4 pt-0 flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1"><RefreshCw className="mr-2 h-4 w-4" /> Sincronizar</Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="icon" className="flex-shrink-0"><Trash2 className="h-4 w-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Desconectar {conn.alias}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja desconectar a conta ({conn.accountId})? Você deixará de receber recomendações e monitoramento para esta conta.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDisconnect(conn.accountId)}>Confirmar</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </Card>
                  ))}
                  <Link href="/onboard">
                    <Card className="h-full flex flex-col items-center justify-center border-2 border-dashed hover:border-primary hover:bg-muted transition-all">
                      <CardContent className="text-center p-6">
                        <PlusCircle className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-semibold">Conectar Nova Conta</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Clique aqui para iniciar o processo de conexão de uma nova conta AWS.
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                </>
              )}
              {(!loadingConnections && connections.length === 0) && (
                <Card className="md:col-span-2 lg:col-span-3 text-center py-12 border-2 border-dashed">
                  <CardContent>
                    <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
                    <h3 className="mt-4 text-lg font-semibold">Nenhuma Conta Conectada</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Você ainda não conectou nenhuma conta AWS. Conecte uma para começar a economizar.
                    </p>
                    <Button className="mt-6" asChild>
                      <Link href="/onboard"><PlusCircle className="mr-2 h-4 w-4" /> Conectar Conta AWS</Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="automation">
          <Card>
            <CardHeader>
              <CardTitle>Automação Inteligente</CardTitle>
              <CardDescription>Configure como o Cost Guardian executa otimizações automaticamente.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label htmlFor="automation-enabled" className="font-semibold">Habilitar Execução Automática</Label>
                  <p className="text-sm text-muted-foreground">Permitir que o sistema execute ações de otimização sem aprovação manual.</p>
                </div>
                <Switch
                  checked={automation.enabled}
                  onChange={(checked: boolean) => setAutomation(a => ({ ...a, enabled: checked }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="threshold">Nível de Confiança para Automação ({automation.threshold}%)</Label>
                <p className="text-sm text-muted-foreground">Ações só serão automáticas se a confiança do nosso algoritmo for maior que este valor.</p>
                <Input 
                  id="threshold" 
                  type="range" 
                  min="50" 
                  max="100" 
                  value={automation.threshold}
                  onChange={(e) => setAutomation(a => ({ ...a, threshold: Number(e.target.value) }))}
                  disabled={!automation.enabled}
                />
              </div>
            </CardContent>
            <div className="p-6 pt-0 flex justify-end">
              <Button onClick={() => handleSaveChanges('Automação')}>Salvar Configurações de Automação</Button>
            </div>
          </Card>
        </TabsContent>

        {/* Adicione aqui os TabsContent para Notificações e Faturamento */}

      </Tabs>
    </>
  );
}