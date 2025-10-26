'use client';
import React, { useEffect, useState } from 'react';

export default function AutomationSettingsPage() {
  const [automation, setAutomation] = useState({ stopIdle: false, deleteUnusedEbs: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/settings/automation', { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Falha ao carregar');
        const json = await res.json();
        setAutomation(json.automation || { stopIdle: false, deleteUnusedEbs: false });
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ automation }),
      });
      if (!res.ok) throw new Error('Falha ao salvar');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div>Carregando...</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl mb-4">Automação — Configurações</h1>

      {error && <div className="text-red-600 mb-4">{error}</div>}

      <label className="flex items-center mb-3">
        <input type="checkbox" checked={automation.stopIdle} onChange={(e) => setAutomation({ ...automation, stopIdle: e.target.checked })} className="mr-2" />
        Habilitar desligamento de instâncias de dev ociosas
      </label>

      <label className="flex items-center mb-3">
        <input type="checkbox" checked={automation.deleteUnusedEbs} onChange={(e) => setAutomation({ ...automation, deleteUnusedEbs: e.target.checked })} className="mr-2" />
        Habilitar exclusão automática de volumes EBS não anexados
      </label>

      <button disabled={saving} onClick={save} className="px-4 py-2 bg-blue-600 text-white rounded">
        {saving ? 'Salvando...' : 'Salvar preferências'}
      </button>
    </div>
  );
}
