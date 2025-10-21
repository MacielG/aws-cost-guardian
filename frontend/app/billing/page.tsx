'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';

interface Invoice {
  id: string;
  date: number; // unix timestamp
  amount: string;
  status: string;
  pdfUrl?: string;
  hostedUrl?: string;
}

export default function BillingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchInvoices = async () => {
      try {
        const res = await fetch('/api/invoices');
        if (!res.ok) throw new Error('Failed to fetch invoices');
        const data: Invoice[] = await res.json();
        setInvoices(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    fetchInvoices();
  }, []);

  return (
    <div className="p-8">
      <Card>
        <CardHeader>
          <CardTitle>Faturamento</CardTitle>
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
