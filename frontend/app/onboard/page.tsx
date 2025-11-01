// frontend/app/onboard/page.tsx

'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotify } from '@/hooks/useNotify';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Cloud, Lock, Settings, CheckCircle, ArrowRight, FileText, ShieldCheck, BarChart2 } from 'lucide-react';
// Assuma que existe um hook ou contexto para obter o token de autenticação
// import { useAuth } from '@/context/AuthContext'; 

const steps = [
  {
    id: 1,
    title: 'Prepare sua conta AWS',
    description: 'Inicie a conexão para configurar o acesso seguro e de somente leitura à sua conta AWS.',
    icon: Cloud,
  },
  {
    id: 2,
    title: 'Análise de Recursos',
    description: 'Nossos algoritmos analisam seus recursos em busca de otimizações de custo e segurança.',
    icon: BarChart2,
  },
  {
    id: 3,
    title: 'Receba Recomendações',
    description: 'Visualize um relatório detalhado com todas as economias potenciais encontradas.',
    icon: FileText,
  }
];

export default function Onboard() {
    const notify = useNotify();
    const [cfnLink, setCfnLink] = useState('');
    const [onboardingStatus, setOnboardingStatus] = useState('PENDING_CFN');
    const [isConnecting, setIsConnecting] = useState(false);
    const [loading, setLoading] = useState(true);
    const [step, setStep] = useState(1);
    const [isAnimating, setIsAnimating] = useState(false);
    const router = useRouter();
    const searchParams = useSearchParams();
    const mode = searchParams.get('mode');

    const handleNext = () => {
        setIsAnimating(true);
        setStep((prev) => Math.min(prev + 1, steps.length + 1));
        setTimeout(() => setIsAnimating(false), 500);
    };

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
            handleNext();
            notify.info('Aguardando confirmação da stack no AWS...');
        } else {
            notify.info('Gerando link de conexão, por favor aguarde...');
        }
    };

    return (
        <motion.div className="min-h-screen bg-background dark:bg-background/95 flex items-center justify-center p-6">
            <div className="max-w-4xl w-full">
                <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center mb-12"
                >
                    <h1 className="text-4xl font-bold text-foreground mb-3">Bem-vindo ao AWS Cost Guardian</h1>
                    <p className="text-xl text-muted-foreground">Otimize seus custos na nuvem de forma inteligente e automatizada.</p>
                </motion.div>

                <div className="relative grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
                    {steps.map((s, index) => (
                        <motion.div
                            key={s.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className="flex items-start gap-4"
                        >
                            <div className={`flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-full transition-colors duration-300 ${step >= s.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                                {step > s.id ? <CheckCircle className="w-6 h-6" /> : <s.icon className="w-6 h-6" />}
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-foreground mb-1">{s.title}</h3>
                                <p className="text-sm text-muted-foreground">{s.description}</p>
                            </div>
                        </motion.div>
                    ))}
                    <motion.div className="absolute top-6 left-0 h-1 bg-muted rounded-full w-full -z-10" />
                    <motion.div 
                        className="absolute top-6 left-0 h-1 bg-primary rounded-full -z-10"
                        animate={{ width: `${((step - 1) / (steps.length -1)) * 100}%` }}
                    />
                </div>

                <AnimatePresence mode="wait">
                {loading ? (
                    <motion.div
                        key="loading"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <Card className="border-border">
                            <CardContent className="p-8">
                                <div className="flex flex-col items-center justify-center">
                                    <Skeleton className="w-12 h-12 rounded-full mb-4" />
                                    <Skeleton className="w-48 h-6 mb-2" />
                                    <Skeleton className="w-64 h-4" />
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                ) : onboardingStatus === 'COMPLETED' ? (
                    <motion.div
                        key="completed"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <Card className="border-green-500/30 bg-green-500/5 dark:bg-green-500/10">
                            <CardContent className="p-8">
                                <div className="flex flex-col items-center text-center">
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ type: "spring", stiffness: 200 }}
                                    >
                                        <ShieldCheck className="w-16 h-16 text-green-500 mb-4" />
                                    </motion.div>
                                    <h3 className="text-2xl font-bold text-foreground mb-2">Configuração Concluída!</h3>
                                    <p className="text-muted-foreground mb-6">Sua conta AWS está conectada e pronta para começar a economizar.</p>
                                    <Button
                                        size="lg"
                                        onClick={() => router.push('/dashboard')}
                                        className="bg-primary text-primary-foreground hover:bg-primary/90"
                                    >
                                        Ir para o Dashboard <ArrowRight className="ml-2 w-4 h-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                ) : (
                    <motion.div
                        key="connect"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <Card className="border-border overflow-hidden">
                            <CardHeader>
                                <CardTitle className="text-center">Passo 1: Conecte sua Conta AWS</CardTitle>
                                <CardDescription className="text-center">
                                    Para começar, clique no botão abaixo. Você será redirecionado para o console da AWS para implantar uma stack do CloudFormation.
                                    <br />
                                    Este processo é <strong>seguro</strong> e cria uma role com <strong>permissões mínimas e de somente leitura</strong>, seguindo as melhores práticas da AWS.
                                    {mode === 'trial' && (
                                        <span className="block mt-2 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 p-2 rounded-md">
                                            Você está no modo <strong>Trial</strong>. Apenas permissões de leitura serão concedidas. Nenhuma ação será executada.
                                        </span>
                                    )}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex justify-center">
                                <Button
                                    size="lg"
                                    onClick={handleConnect}
                                    disabled={isConnecting}
                                    className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
                                >
                                    {isConnecting ? 'Aguardando Conexão...' : 'Conectar com AWS'}
                                    {!isConnecting && <ArrowRight className="ml-2 w-4 h-4" />}
                                </Button>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}