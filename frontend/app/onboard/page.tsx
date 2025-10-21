'use client';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

export default function Onboard() {
  const { t } = useTranslation();
  const [roleArn, setRoleArn] = useState('');

  const handleConnect = () => {
    const cfTemplateUrl = `https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=https://s3.amazonaws.com/cost-guardian-templates/cost-guardian-template.yaml&stackName=CostGuardianStack&param_ExternalId=unique-external-id`;
    window.open(cfTemplateUrl, '_blank');
  };

  const saveRole = async () => {
    // Chame backend /api/onboard
    await fetch('/api/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleArn, email: 'user@example.com' }), // Integre auth
    });
    alert('Onboarding completo!');
  };

  return (
    <div className="p-8">
      <h1>{t('connectAws')}</h1>
      <Button onClick={handleConnect} className="mt-4">1-Click Connect (CloudFormation)</Button>
      <input
        type="text"
        placeholder="Insira o ARN da Role gerada"
        value={roleArn}
        onChange={(e) => setRoleArn(e.target.value)}
        className="mt-4 p-2 border w-full"
      />
      <Button onClick={saveRole} className="mt-2">Salvar e Iniciar Monitoramento</Button>
    </div>
  );
}