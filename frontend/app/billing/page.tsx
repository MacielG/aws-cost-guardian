'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink, Check, X } from 'lucide-react';
import { initializeStripe } from '@/lib/utils';

interface Subscription {
  status: string;
  stripeCustomerId?: string;
}

interface Invoice {
  id: string;
  date: number;
  amount: string;
  status: string;
  pdfUrl?: string;
  hostedUrl?: string;
}

export default function BillingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Carregar assinatura
        const subRes = await fetch('/api/billing/subscription');
        if (subRes.ok) {
          const subData = await subRes.json();
          setSubscription(subData);
        }

        // Carregar faturas
        const invRes = await fetch('/api/invoices');
        if (invRes.ok) {
          const invData = await invRes.json();
          setInvoices(invData);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro desconhecido');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleUpgradeClick = async () => {
    try {
      setUpgradeLoading(true);
      setError(null);

      const res = await fetch('/api/billing/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stripeCustomerId: subscription?.stripeCustomerId,
        }),
      });

      if (!res.ok) {
        throw new Error('Erro ao criar sessão de checkout');
      }

      const { sessionId } = await res.json();

      // Redirecionar para checkout do Stripe
      const stripe = await initializeStripe();
      await stripe.redirectToCheckout({ sessionId });
    } catch (err) {
      console.error('Erro no processo de upgrade:', err);
      setError('Ocorreu um erro ao tentar fazer upgrade para o plano Pro.');
    } finally {
      setUpgradeLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">Planos e Faturamento</h1>

      {/* Planos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
        {/* Plano Free */}
        <Card>
          <CardHeader>
            <CardTitle>Plano Free</CardTitle>
            <CardDescription>Para começar a economizar</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 mb-6">
              <li><Check className="inline mr-2" />Detecção de violações de SLA</li>
              <li><Check className="inline mr-2" />Cálculo de impacto financeiro</li>
              <li><Check className="inline mr-2" />Relatórios básicos</li>
              <li><X className="inline mr-2" />Automação de processos</li>
              <li><X className="inline mr-2" />Suporte prioritário</li>
              <li className="font-bold mt-4">Comissão de 30% sobre créditos</li>
            </ul>
            <p className="text-lg mb-4">Grátis</p>
            {subscription?.status !== 'active' ? (
              <Button disabled className="w-full">Plano Atual</Button>
            ) : null}
          </CardContent>
        </Card>

        {/* Plano Pro */}
        <Card className="border-2 border-primary">
          <CardHeader>
            <CardTitle>
              Plano Pro
              <span className="ml-2 text-sm bg-primary text-white px-2 py-1 rounded">Recomendado</span>
            </CardTitle>
            <CardDescription>Para empresas que buscam eficiência máxima</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 mb-6">
              <li><Check className="inline mr-2" />Todas as funcionalidades do plano Free</li>
              <li><Check className="inline mr-2" />Automação completa dos processos</li>
              <li><Check className="inline mr-2" />Suporte prioritário 24/7</li>
              <li><Check className="inline mr-2" />Relatórios personalizados</li>
              <li><Check className="inline mr-2" />Integração com sistemas internos</li>
              <li className="font-bold mt-4">Sem comissão sobre créditos 🎉</li>
            </ul>
            <p className="text-lg font-bold mb-4">$99/mês</p>
            {subscription?.status === 'active' ? (
              <Button disabled className="w-full">Plano Atual</Button>
            ) : (
              <Button
                onClick={handleUpgradeClick}
                disabled={upgradeLoading}
                className="w-full"
              >
                {upgradeLoading ? 'Processando...' : 'Fazer Upgrade'}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Histórico de Faturas */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Histórico de Faturas</CardTitle>
          <CardDescription>Veja suas faturas e pagamentos.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p>Carregando...</p>}
          {error && <p className="text-red-500">Erro: {error}</p>}
          {!loading && !error && invoices.length === 0 && <p>Nenhuma fatura encontrada.</p>}
          {!loading && !error && invoices.length > 0 && (
            <div className="space-y-3">
              {invoices.map(inv => (
                <Card key={inv.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <div className="font-semibold">Fatura {inv.id}</div>
                      <div className="text-sm text-muted-foreground">{new Date(inv.date * 1000).toLocaleString()}</div>
                      <div className="mt-1">Valor: ${inv.amount}</div>
                      <div>Status: <span className="font-medium">{inv.status}</span></div>
                    </div>
                    <div className="space-y-2">
                      {inv.pdfUrl && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer">Download PDF</a>
                        </Button>
                      )}
                      {inv.hostedUrl && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={inv.hostedUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 inline-block" />Abrir no portal</a>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
