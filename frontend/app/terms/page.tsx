'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TermsPage() {
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  
  const acceptTerms = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/accept-terms', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to accept terms');
      setAccepted(true);
      setMessage('Termos aceitos com sucesso.');
      
      // Pequeno delay para mostrar a mensagem
      await new Promise(resolve => setTimeout(resolve, 800));
      // Redireciona de volta para o onboarding
      window.location.href = '/onboard';
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <Card>
        <CardHeader>
          <CardTitle>Termos de Serviço</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="prose max-w-none">
            <h3>Contrato de Prestação de Serviços - AWS Cost Guardian</h3>
            <p>Este contrato estabelece os termos entre o prestador de serviços (Cost Guardian) e o cliente.</p>
            <h4>1. Serviço</h4>
            <p>Fornecimento de monitoramento e reivindicação de créditos SLA conforme descrito na plataforma.</p>
            <h4>2. Comissão</h4>
            <p>O prestador cobrará uma comissão equivalente a 30% (trinta por cento) sobre quaisquer créditos efetivamente recuperados junto à AWS.</p>
            <h4>3. Responsabilidades</h4>
            <p>O cliente concorda em fornecer acesso necessário (role IAM) e cooperação para que o serviço funcione.</p>
            <h4>4. Limitações</h4>
            <p>O prestador não garante que todas as reivindicações serão aceitas pela AWS.</p>
            <h4>5. Disposições Gerais</h4>
            <p>Este contrato é regido pela legislação aplicável.</p>
          </div>

          <div className="mt-6">
            <label className="flex items-center space-x-3">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span>Li e concordo com os Termos de Serviço</span>
            </label>
          <div className="mt-4">
            <Button onClick={acceptTerms} disabled={!accepted || loading}>{loading ? 'Enviando...' : 'Aceitar'}</Button>
          </div>
          {message && <p className="mt-3">{message}</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
