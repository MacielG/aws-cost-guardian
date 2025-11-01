'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/loadingspinner';
import { Alert } from '@/components/ui/alert';
import { apiClient } from '@/lib/api';

export default function OnboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') || 'active';
  
  const [loading, setLoading] = useState(true);
  const [cfnTemplateUrl, setCfnTemplateUrl] = useState('');
  const [onboardingStatus, setOnboardingStatus] = useState('PENDING_CFN');
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(1);

  useEffect(() => {
    fetchOnboardingConfig();
  }, [mode]);

  const fetchOnboardingConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await apiClient.get(`/api/onboard-init?mode=${mode}`);
      
      if (response.data.status === 'COMPLETED') {
        router.push('/dashboard');
        return;
      }
      
      setCfnTemplateUrl(response.data.cfnTemplateUrl);
      setOnboardingStatus(response.data.status);
    } catch (err: any) {
      console.error('Erro ao buscar config de onboarding:', err);
      setError(err.message || 'Erro ao carregar configuração');
    } finally {
      setLoading(false);
    }
  };

  const handleLaunchStack = () => {
    const quickCreateUrl = `https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=${encodeURIComponent(cfnTemplateUrl)}`;
    window.open(quickCreateUrl, '_blank');
    setCurrentStep(2);
  };

  const handleCheckStatus = async () => {
    await fetchOnboardingConfig();
    if (onboardingStatus === 'COMPLETED') {
      router.push('/dashboard');
    }
  };

  if (loading) {
    return <LoadingState message="Carregando onboarding..." />;
  }

  if (error) {
    return (
      <Alert variant="error">
        <h4 className="font-semibold">Erro no Onboarding</h4>
        <p className="mt-1 text-sm">{error}</p>
        <button onClick={fetchOnboardingConfig} className="mt-3 text-sm underline">
          Tentar novamente
        </button>
      </Alert>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">
          Conectar Conta AWS
        </h1>
        <p className="mt-2 text-gray-600">
          {mode === 'trial' ? 'Inicie seu trial gratuito' : 'Configure sua conta AWS'}
        </p>
      </div>

      {/* Timeline */}
      <div className="flex items-center justify-center gap-4">
        {[1, 2, 3].map((step) => (
          <div key={step} className="flex items-center">
            <div className={`flex items-center justify-center w-10 h-10 rounded-full ${
              currentStep >= step ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
            }`}>
              {step}
            </div>
            {step < 3 && <div className="w-16 h-1 bg-gray-200 mx-2" />}
          </div>
        ))}
      </div>

      {/* Step 1 */}
      {currentStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Passo 1: Lançar CloudFormation Stack</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-700">
              Clique no botão abaixo para abrir o console da AWS e criar a stack do CloudFormation.
              Esta stack criará as permissões necessárias para o Cost Guardian acessar sua conta.
            </p>

            {mode === 'trial' && (
              <Alert variant="info">
                <h4 className="font-semibold">Modo Trial</h4>
                <p className="mt-1 text-sm">
                  No modo trial, criamos apenas permissões de leitura (read-only).
                  Você pode ver recomendações, mas não executá-las automaticamente.
                </p>
              </Alert>
            )}

            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="font-medium mb-2">O que será criado:</h4>
              <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                <li>IAM Role para acesso cross-account</li>
                <li>Permissões de leitura para análise de custos</li>
                {mode !== 'trial' && <li>Permissões de escrita para execução de recomendações</li>}
                <li>EventBridge rules para monitoramento</li>
              </ul>
            </div>

            <Button onClick={handleLaunchStack} className="w-full" size="lg">
              Lançar Stack na AWS
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2 */}
      {currentStep === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Passo 2: Aguardar Criação da Stack</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="warning">
              <h4 className="font-semibold">Stack em criação...</h4>
              <p className="mt-1 text-sm">
                A stack do CloudFormation está sendo criada. Este processo leva aproximadamente 2-3 minutos.
              </p>
            </Alert>

            <div className="space-y-3">
              <h4 className="font-medium">Enquanto aguarda:</h4>
              <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                <li>Verifique se a stack está com status "CREATE_COMPLETE" no console da AWS</li>
                <li>Aguarde o callback automático (pode levar até 30 segundos após a criação)</li>
                <li>Clique em "Verificar Status" abaixo para conferir se a conexão foi estabelecida</li>
              </ol>
            </div>

            <Button onClick={handleCheckStatus} className="w-full" variant="primary">
              Verificar Status
            </Button>

            <Button onClick={() => setCurrentStep(1)} className="w-full" variant="ghost">
              Voltar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 3 - Success */}
      {onboardingStatus === 'COMPLETED' && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-medium text-gray-900">
                Conta AWS Conectada!
              </h3>
              <p className="mt-2 text-sm text-gray-600">
                Sua conta foi conectada com sucesso. Redirecionando para o dashboard...
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
