// frontend/app/onboard/page.tsx

'use client';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
// Assuma que existe um hook ou contexto para obter o token de autenticação
// import { useAuth } from '@/context/AuthContext'; 

export default function Onboard() {
  const { t } = useTranslation();
  const [roleArn, setRoleArn] = useState('');
  const [awsAccountId, setAwsAccountId] = useState(''); // Novo: Coletar Account ID
  const [cfnLink, setCfnLink] = useState('');
  // const { getToken } = useAuth(); // Exemplo de como obter o token

  // Buscar o ExternalId seguro no backend
  useEffect(() => {
    const fetchOnboardConfig = async () => {
      // const token = await getToken(); // Obter token do Cognito
      const response = await fetch('/api/onboard-init', {
        headers: {
          // 'Authorization': `Bearer ${token}`, // Enviar o token
        },
      });

      if (response.ok) {
        const config = await response.json();
        // Constrói o link do CloudFormation dinamicamente
        const templateUrl = 'https://s3.amazonaws.com/cost-guardian-templates/cost-guardian-template.yaml';
        const link = `https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=${templateUrl}&stackName=CostGuardianStack&param_ExternalId=${config.externalId}&param_PlatformAccountId=${config.platformAccountId}`;
        setCfnLink(link);
      }
    };

    fetchOnboardConfig();
  }, []); // Adicionado 'getToken' ao array de dependência se ele mudar

  const handleConnect = () => {
    if (cfnLink) {
      window.open(cfnLink, '_blank');
    } else {
      alert('Gerando link de conexão, por favor aguarde...');
    }
  };

  const saveRole = async () => {
    // const token = await getToken();
    // Chame backend /api/onboard
    await fetch('/api/onboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ 
          roleArn, 
          awsAccountId // Enviar o ID da conta também
        }),
    });
    alert('Onboarding completo!');
  };

  return (
    <div className="p-8">
      <h1>{t('connectAws')}</h1>
      <Button onClick={handleConnect} className="mt-4" disabled={!cfnLink}>
        1. Conectar AWS (Abrir CloudFormation)
      </Button>
      <p className="text-sm text-gray-600 mt-2">
        Após criar a pilha no console da AWS, copie o 'RoleArn' e o 'AWS Account ID' da aba 'Outputs' e cole-os abaixo.
      </p>
      <input
        type="text"
        placeholder="Insira o ID da Conta AWS (ex: 123456789012)"
        value={awsAccountId}
        onChange={(e) => setAwsAccountId(e.target.value)}
        className="mt-4 p-2 border w-full"
      />
      <input
        type="text"
        placeholder="Insira o ARN da Role gerada (ex: arn:aws:iam::...)"
        value={roleArn}
        onChange={(e) => setRoleArn(e.target.value)}
        className="mt-4 p-2 border w-full"
      />
      <Button onClick={saveRole} className="mt-2">
        2. Salvar e Iniciar Monitoramento
      </Button>
    </div>
  );
}