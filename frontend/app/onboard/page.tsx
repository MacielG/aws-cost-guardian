// frontend/app/onboard/page.tsx

'use client';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
// Assuma que existe um hook ou contexto para obter o token de autenticação
// import { useAuth } from '@/context/AuthContext'; 

export default function Onboard() {
  const { t } = useTranslation();
  const [cfnLink, setCfnLink] = useState('');
  const [onboardingStatus, setOnboardingStatus] = useState('PENDING_CFN');
  const [isConnecting, setIsConnecting] = useState(false);
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
      const response = await fetch('/api/onboard-init', {
        headers: {
          // 'Authorization': `Bearer ${token}`, // Enviar o token
        },
      });

      if (response.ok) {
      const config = await response.json();
      // Constrói o link do CloudFormation dinamicamente
      setOnboardingStatus(config.status);
      const templateUrl = 'https://s3.amazonaws.com/cost-guardian-templates/cost-guardian-template.yaml';
      const callbackUrl = `${window.location.origin}/api/onboard`;
      const link = `https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=${templateUrl}&stackName=CostGuardianStack&param_ExternalId=${config.externalId}&param_PlatformAccountId=${config.platformAccountId}&param_CallbackUrl=${encodeURIComponent(callbackUrl)}`;
      setCfnLink(link);
      }
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
    } else {
      alert('Gerando link de conexão, por favor aguarde...');
    }
  };

  return (
    <div className="p-8">
      <h1>{t('connectAws')}</h1>
      {onboardingStatus === 'COMPLETED' ? (
        <div className="mt-4 p-4 bg-green-100 text-green-800 rounded">
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