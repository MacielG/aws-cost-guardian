'use client';
import React, { useEffect, useState } from 'react';

export default function AdminPage() {
  const [items, setItems] = useState<any[]>([]);
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
