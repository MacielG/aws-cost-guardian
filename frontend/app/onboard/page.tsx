// frontend/app/onboard/page.tsx

'use client';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotify } from '@/hooks/useNotify';
import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
    const searchParams = useSearchParams();
    const mode = searchParams.get('mode');
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
        const query = mode ? `?mode=${mode}` : '';
        const response = await fetch(`/api/onboard-init${query}`, {
            headers: {
                // 'Authorization': `Bearer ${token}`, // Enviar o token
            },
        });

        if (response.ok) {
            const config = await response.json();
            // Constrói o link do CloudFormation dinamicamente
            const templateUrl = config.templateUrl || process.env.NEXT_PUBLIC_CFN_TEMPLATE_URL;
            setOnboardingStatus(config.status);
            const callbackUrl = `${process.env.NEXT_PUBLIC_API_URL}/onboard`;
            const link = `https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=${templateUrl}&stackName=CostGuardianStack&param_ExternalId=${config.externalId}&param_PlatformAccountId=${config.platformAccountId}&param_CallbackUrl=${encodeURIComponent(callbackUrl)}`;
            setCfnLink(link);
        } else {
            notify.error('Erro ao buscar configuração de onboarding.');
        }
        setLoading(false);
    }, [mode]);

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
    <div className="min-h-screen bg-background-dark flex items-center justify-center p-6">
            <div className="max-w-2xl w-full">
                <div className="text-center mb-8">
                    <h1 className="heading-1 mb-2">Welcome to Cost Guardian</h1>
                    <p className="paragraph">Start optimizing your AWS costs in just a few steps</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div className={`flex flex-col items-center ${step >= 1 ? 'opacity-100' : 'opacity-50'}`}>
                        <div className={`rounded-full ${step === 1 ? 'bg-primary-blue text-text-light' : 'bg-border-color text-text-medium'} w-12 h-12 flex items-center justify-center font-bold mb-3 text-lg transition-all duration-200`}>
                            1
                        </div>
                        <div className="font-medium text-text-light">Connect AWS</div>
                        <div className="text-xs text-text-medium text-center mt-1">Set up your AWS integration</div>
                    </div>
                    <div className={`flex flex-col items-center ${step >= 2 ? 'opacity-100' : 'opacity-50'}`}>
                        <div className={`rounded-full ${step === 2 ? 'bg-primary-blue text-text-light' : 'bg-border-color text-text-medium'} w-12 h-12 flex items-center justify-center font-bold mb-3 text-lg transition-all duration-200`}>
                            2
                        </div>
                        <div className="font-medium text-text-light">Review Permissions</div>
                        <div className="text-xs text-text-medium text-center mt-1">Check required access</div>
                    </div>
                    <div className={`flex flex-col items-center ${step === 3 ? 'opacity-100' : 'opacity-50'}`}>
                        <div className={`rounded-full ${step === 3 ? 'bg-primary-blue text-text-light' : 'bg-border-color text-text-medium'} w-12 h-12 flex items-center justify-center font-bold mb-3 text-lg transition-all duration-200`}>
                            3
                        </div>
                        <div className="font-medium text-text-light">Deploy</div>
                        <div className="text-xs text-text-medium text-center mt-1">Start monitoring costs</div>
                    </div>
                </div>

                <Card className="mb-6">
                    <CardHeader>
                        <CardTitle>Why do we need this?</CardTitle>
                        <CardDescription>
                            To automate credit recovery and monitor costs, we need an AWS role with specific permissions. The <code className="bg-background-light px-2 py-1 rounded text-sm">ExternalId</code> ensures security and traceability.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <a href="/docs/deploy" className="text-primary-blue hover:text-primary-blue-light underline transition-colors">View complete documentation</a>
                    </CardContent>
                </Card>

                {loading ? (
                    <Skeleton className="w-full h-12 mb-4" />
                ) : onboardingStatus === 'COMPLETED' ? (
                    <Card className="border-secondary-green">
                        <CardContent className="pt-6">
                            <div className="text-center">
                                <div className="w-16 h-16 bg-secondary-green rounded-full flex items-center justify-center mx-auto mb-4">
                                    <svg className="w-8 h-8 text-text-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                                <h3 className="heading-3 mb-2">AWS Connection Successful!</h3>
                                <p className="text-muted">You will be redirected to the dashboard...</p>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <CardContent className="pt-6">
                            <Button onClick={handleConnect} className="w-full mb-4" disabled={!cfnLink || isConnecting}>
                                {isConnecting ? 'Waiting for connection...' : '1. Connect AWS (Open CloudFormation)'}
                            </Button>
                            <p className="text-sm text-text-medium text-center">
                                {isConnecting
                                    ? 'After creating the stack in AWS console, you can close the tab and return here. We\'re waiting for automatic confirmation.'
                                    : 'This will open the AWS console for you to create the access role. It\'s safe and transparent.'}
                            </p>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}