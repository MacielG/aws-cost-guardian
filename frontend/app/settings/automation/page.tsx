'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingSpinner';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { apiClient } from '@/lib/api';

interface AutomationSettings {
  enabled: boolean;
  settings: {
    autoExecuteThreshold?: number;
    excludedTypes?: string[];
    approvalRequired?: boolean;
    maxDailySavings?: number;
    notifyBeforeExecution?: boolean;
  };
}

export default function AutomationSettingsPage() {
  const [settings, setSettings] = useState<AutomationSettings>({
    enabled: false,
    settings: {},
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [hasProPlan, setHasProPlan] = useState(false);

  useEffect(() => {
    loadSettings();
    checkProPlan();
  }, []);

  const checkProPlan = async () => {
    try {
      const response = await apiClient.get('/api/billing/subscription');
      setHasProPlan(response.data.status === 'active');
    } catch (err) {
      console.error('Erro ao verificar plano:', err);
    }
  };

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get('/api/settings/automation');
      setSettings(response.data);
    } catch (err: any) {
      console.error('Erro ao carregar configurações:', err);
      setError(err.message || 'Erro ao carregar configurações de automação');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);
      
      await apiClient.put('/api/settings/automation', settings);
      
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error('Erro ao salvar configurações:', err);
      setError(err.message || 'Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAutomation = async () => {
    const newSettings = {
      ...settings,
      enabled: !settings.enabled,
    };
    setSettings(newSettings);
  };

  const updateSetting = (key: string, value: any) => {
    setSettings({
      ...settings,
      settings: {
        ...settings.settings,
        [key]: value,
      },
    });
  };

  if (loading) {
    return <LoadingState message="Carregando configurações..." />;
  }

  if (!hasProPlan) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Automação</h1>
          <p className="mt-2 text-gray-600">
            Configure a execução automática de recomendações
          </p>
        </div>

        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-blue-100">
                <svg className="h-8 w-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-medium text-gray-900">
                Recurso Exclusivo do Plano Pro
              </h3>
              <p className="mt-2 text-sm text-gray-600">
                A automação de recomendações está disponível apenas para assinantes do plano Pro.
              </p>
              <div className="mt-6">
                <Button onClick={() => window.location.href = '/billing'}>
                  Fazer Upgrade para Pro
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Automação</h1>
          <p className="mt-2 text-gray-600">
            Configure a execução automática de recomendações
          </p>
        </div>
        <Badge variant="success">Plano Pro</Badge>
      </div>

      {error && (
        <Alert variant="error">
          <h4 className="font-semibold">Erro</h4>
          <p className="mt-1 text-sm">{error}</p>
        </Alert>
      )}

      {success && (
        <Alert variant="success">
          <h4 className="font-semibold">Configurações salvas!</h4>
          <p className="mt-1 text-sm">Suas preferências foram atualizadas com sucesso.</p>
        </Alert>
      )}

      {/* Status da Automação */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Status da Automação</CardTitle>
            <Badge variant={settings.enabled ? 'success' : 'default'}>
              {settings.enabled ? 'Ativada' : 'Desativada'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex-1">
              <h4 className="font-medium text-gray-900">Execução Automática de Recomendações</h4>
              <p className="mt-1 text-sm text-gray-600">
                Quando ativado, recomendações aprovadas serão executadas automaticamente
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer ml-4">
              <input 
                type="checkbox" 
                checked={settings.enabled}
                onChange={handleToggleAutomation}
                className="sr-only peer" 
              />
              <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {settings.enabled && (
            <Alert variant="warning">
              <h4 className="font-semibold">Atenção</h4>
              <p className="mt-1 text-sm">
                Com a automação ativada, recomendações que atendam aos critérios abaixo 
                serão executadas automaticamente. Certifique-se de que os limites estão configurados corretamente.
              </p>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Configurações de Threshold */}
      <Card>
        <CardHeader>
          <CardTitle>Limites de Execução</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Economia Mínima para Auto-Execução (USD)
            </label>
            <input
              type="number"
              value={settings.settings.autoExecuteThreshold || 0}
              onChange={(e) => updateSetting('autoExecuteThreshold', parseFloat(e.target.value))}
              className="w-full md:w-64 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="100"
              min="0"
              step="10"
              disabled={!settings.enabled}
            />
            <p className="mt-1 text-xs text-gray-500">
              Apenas recomendações que economizem pelo menos este valor serão executadas automaticamente
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Limite Diário de Economias (USD)
            </label>
            <input
              type="number"
              value={settings.settings.maxDailySavings || 0}
              onChange={(e) => updateSetting('maxDailySavings', parseFloat(e.target.value))}
              className="w-full md:w-64 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="1000"
              min="0"
              step="50"
              disabled={!settings.enabled}
            />
            <p className="mt-1 text-xs text-gray-500">
              Parar execução automática se o total de economias diárias exceder este valor
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Tipos de Recomendação */}
      <Card>
        <CardHeader>
          <CardTitle>Tipos de Recomendação</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-4">
            Selecione quais tipos de recomendação podem ser executados automaticamente
          </p>
          
          <div className="space-y-3">
            {[
              { id: 'IDLE_INSTANCE', label: 'Instâncias Ociosas', description: 'Parar instâncias EC2 com baixo uso' },
              { id: 'UNUSED_EBS', label: 'Volumes EBS Não Utilizados', description: 'Remover volumes não anexados' },
              { id: 'IDLE_RDS', label: 'RDS Ocioso', description: 'Parar bancos de dados com baixo uso' },
              { id: 'RESERVED_INSTANCE', label: 'Instâncias Reservadas', description: 'Comprar RIs para economia' },
            ].map((type) => (
              <label key={type.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!settings.settings.excludedTypes?.includes(type.id)}
                  onChange={(e) => {
                    const excluded = settings.settings.excludedTypes || [];
                    if (e.target.checked) {
                      updateSetting('excludedTypes', excluded.filter(t => t !== type.id));
                    } else {
                      updateSetting('excludedTypes', [...excluded, type.id]);
                    }
                  }}
                  className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  disabled={!settings.enabled}
                />
                <div className="flex-1">
                  <h4 className="font-medium text-gray-900">{type.label}</h4>
                  <p className="text-sm text-gray-600">{type.description}</p>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Notificações */}
      <Card>
        <CardHeader>
          <CardTitle>Notificações</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.settings.approvalRequired || false}
              onChange={(e) => updateSetting('approvalRequired', e.target.checked)}
              className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              disabled={!settings.enabled}
            />
            <div className="flex-1">
              <h4 className="font-medium text-gray-900">Requerer Aprovação Manual</h4>
              <p className="text-sm text-gray-600">
                Enviar notificação para aprovação antes de executar (modo semi-automático)
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.settings.notifyBeforeExecution || false}
              onChange={(e) => updateSetting('notifyBeforeExecution', e.target.checked)}
              className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded-lg focus:ring-blue-500"
              disabled={!settings.enabled}
            />
            <div className="flex-1">
              <h4 className="font-medium text-gray-900">Notificar Antes da Execução</h4>
              <p className="text-sm text-gray-600">
                Enviar email 5 minutos antes de executar uma recomendação
              </p>
            </div>
          </label>
        </CardContent>
      </Card>

      {/* Ações */}
      <div className="flex items-center gap-4">
        <Button 
          onClick={handleSave} 
          isLoading={saving}
          disabled={!settings.enabled}
        >
          Salvar Configurações
        </Button>
        <Button 
          variant="ghost" 
          onClick={loadSettings}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
