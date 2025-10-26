'use client';
import React, { useEffect, useState } from 'react';
import type { JSX } from 'react';

interface Claim {
  id: string;
  sk: string;
  status: string;
}

type RetryFn = (customerId: string, claimSk: string) => Promise<void>;

export default function AdminPage(): JSX.Element {
  const [items, setItems] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin/claims', { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Falha ao carregar');
        const json = await res.json();
        setItems(json.items || json);
      } catch (err: any) {
        setError(err.message || 'Erro');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function markPaid(customerId: string, claimSk: string) {
    try {
      const claimId = claimSk.replace('CLAIM#', '');
      const res = await fetch(`/api/admin/claims/${customerId}/${claimId}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ status: 'PAID' }) });
      if (!res.ok) throw new Error('Falha ao marcar como PAID');
      // refresh
      setItems(items.map(i => i.sk === claimSk ? { ...i, status: 'PAID' } : i));
    } catch (err) {
      console.error(err);
    }
  }

  async function createInvoice(customerId: string, claimSk: string) {
    try {
      const claimId = claimSk.replace('CLAIM#', '');
      const res = await fetch(`/api/admin/claims/${customerId}/${claimId}/create-invoice`, { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) throw new Error('Falha ao criar fatura');
      alert('Fatura criada');
    } catch (err) {
      console.error(err);
      alert('Erro ao criar fatura');
    }
  }

  async function retryClaim(customerId: string, claimSk: string) {
    try {
      const claimId = claimSk.replace('CLAIM#', '');
      const res = await fetch(`/api/admin/claims/${customerId}/${claimId}/retry`, { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) throw new Error('Falha ao reiniciar reivindicação');
      // refresh
      setItems(items.map(i => i.sk === claimSk ? { ...i, status: 'RETRYING' } : i));
      alert('Reivindicação reiniciada com sucesso');
    } catch (err) {
      console.error(err);
      alert('Erro ao reiniciar reivindicação');
    }
  }

  if (loading) return <div className="p-6">Carregando...</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl mb-4">Admin — Reivindicações</h1>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr>
            <th className="border-b py-2">Customer</th>
            <th className="border-b py-2">Claim</th>
            <th className="border-b py-2">Status</th>
            <th className="border-b py-2">Ações</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={idx}>
              <td className="py-2">{it.id}</td>
              <td className="py-2">{it.sk}</td>
              <td className="py-2">{it.status}</td>
              <td className="py-2 space-x-2">
                {['SUBMISSION_FAILED', 'REPORT_FAILED'].includes(it.status) && (
                  <button onClick={() => retryClaim(it.id, it.sk)} className="px-2 py-1 bg-yellow-600 text-white rounded">Tentar Novamente</button>
                )}
                <button onClick={() => markPaid(it.id, it.sk)} className="px-2 py-1 bg-green-600 text-white rounded">Marcar PAID</button>
                <button onClick={() => createInvoice(it.id, it.sk)} className="px-2 py-1 bg-blue-600 text-white rounded">Gerar Fatura</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
