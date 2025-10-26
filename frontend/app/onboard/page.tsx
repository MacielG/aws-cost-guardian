// frontend/app/onboard/page.tsx

'use client';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotify } from '@/hooks/useNotify';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
// Assuma que existe um hook ou contexto para obter o token de autenticação
// import { useAuth } from '@/context/AuthContext'; 

export default function Onboard() {
  const { t } = useTranslation();
  const notify = useNotify();
  const [cfnLink, setCfnLink] = useState('');
  const [onboardingStatus, setOnboardingStatus] = useState('PENDING_CFN');
  const [isConnecting, setIsConnecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const router = useRouter();
  // const { getToken } = useAuth(); // Exemplo de como obter o token

  const checkOnboardingStatus = useCallback(async () => {
    // const token = await getToken();
    const response = await fetch('/api/onboard-init'); // Este endpoint agora retorna o status
    if (response.ok) {
      const config = await response.json();
      // Se o usuário ainda não aceitou os termos, redireciona para a página de termos
      if (config.termsAccepted === false) {
        router.push('/terms');
        return;
      }
      setOnboardingStatus(config.status);
      if (config.status === 'COMPLETED') {
        router.push('/dashboard');
      }
    }
  }, [router]);

  const fetchOnboardConfig = useCallback(async () => {
      // const token = await getToken(); // Obter token do Cognito
  setLoading(true);
  const response = await fetch('/api/onboard-init', {
        headers: {
          // 'Authorization': `Bearer ${token}`, // Enviar o token
        },
      });

      if (response.ok) {
        const config = await response.json();
        // Constrói o link do CloudFormation dinamicamente
        const templateUrl = process.env.NEXT_PUBLIC_CFN_TEMPLATE_URL;
        setOnboardingStatus(config.status);
        const callbackUrl = `${process.env.NEXT_PUBLIC_API_URL}/onboard`;
        const link = `https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=${templateUrl}&stackName=CostGuardianStack&param_ExternalId=${config.externalId}&param_PlatformAccountId=${config.platformAccountId}&param_CallbackUrl=${encodeURIComponent(callbackUrl)}`;
        setCfnLink(link);
      } else {
        notify.error('Erro ao buscar configuração de onboarding.');
      }
      setLoading(false);
    }, []);

  // Buscar o ExternalId seguro no backend
  useEffect(() => {
    fetchOnboardConfig();
  }, [fetchOnboardConfig]);

  useEffect(() => {
    if (isConnecting && onboardingStatus !== 'COMPLETED') {
      const interval = setInterval(checkOnboardingStatus, 5000); // Verifica a cada 5 segundos
      return () => clearInterval(interval);
    }
  }, [isConnecting, onboardingStatus, checkOnboardingStatus]);

  const handleConnect = () => {
    if (cfnLink) {
      window.open(cfnLink, '_blank');
      setIsConnecting(true);
      setStep(2);
      notify.info('Aguardando confirmação da stack no AWS...');
    } else {
      notify.info('Gerando link de conexão, por favor aguarde...');
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-8">
      <h1 className="heading-2 mb-6">Onboarding AWS Cost Guardian</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className={`flex flex-col items-center ${step >= 1 ? 'opacity-100' : 'opacity-50'}`}>
          <div className={`rounded-full ${step === 1 ? 'bg-primary' : 'bg-gray-300'} text-white w-10 h-10 flex items-center justify-center font-bold mb-2`}>1</div>
          <div className="font-semibold">Conectar AWS</div>
        </div>
        <div className={`flex flex-col items-center ${step >= 2 ? 'opacity-100' : 'opacity-50'}`}>
          <div className={`rounded-full ${step === 2 ? 'bg-primary' : 'bg-gray-300'} text-white w-10 h-10 flex items-center justify-center font-bold mb-2`}>2</div>
          <div className="font-semibold">Revisar Permissões</div>
        </div>
        <div className={`flex flex-col items-center ${step === 3 ? 'opacity-100' : 'opacity-50'}`}>
          <div className={`rounded-full ${step === 3 ? 'bg-primary' : 'bg-gray-300'} text-white w-10 h-10 flex items-center justify-center font-bold mb-2`}>3</div>
          <div className="font-semibold">Deploy</div>
        </div>
      </div>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Por que precisamos disso?</CardTitle>
          <CardDescription>Para automatizar a recuperação de créditos e monitorar custos, precisamos de uma role AWS com permissões específicas. O <span className="font-mono bg-gray-100 px-2 py-1 rounded">ExternalId</span> garante segurança e rastreabilidade.</CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/docs/deploy" className="text-primary underline">Ver documentação completa</a>
        </CardContent>
      </Card>
      {loading ? (
        <Skeleton className="w-full h-12 mb-4" />
      ) : onboardingStatus === 'COMPLETED' ? (
        <div className="mt-4 p-4 bg-green-100 text-green-800 rounded animate-fade-in">
          <p>✅ Conexão com a AWS realizada com sucesso!</p>
          <p>Você será redirecionado para o dashboard...</p>
        </div>
      ) : (
        <>
          <Button onClick={handleConnect} className="mt-4" disabled={!cfnLink || isConnecting}>
            {isConnecting ? 'Aguardando conexão...' : '1. Conectar AWS (Abrir CloudFormation)'}
          </Button>
          <p className="text-sm text-gray-600 mt-2">
            {isConnecting
              ? 'Após criar a stack no console da AWS, pode fechar a aba e voltar para cá. Estamos aguardando a confirmação automática.'
              : 'Isto abrirá o console da AWS para você criar a role de acesso. É seguro e transparente.'}
          </p>
        </>
      )}
    </div>
  );
}