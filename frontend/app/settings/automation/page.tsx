'use client';
import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface AutomationSettings {
  stopIdle: boolean;
  deleteUnusedEbs: boolean;
  exclusionTags?: string;
}

export default function AutomationSettingsPage() {
  const [automation, setAutomation] = useState<AutomationSettings>({ 
    stopIdle: false, 
    deleteUnusedEbs: false,
    exclusionTags: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/settings/automation', { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Falha ao carregar');
        const json = await res.json();
        setAutomation(json.automation || { stopIdle: false, deleteUnusedEbs: false });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro desconhecido');
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
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div>Carregando...</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl mb-4">Automação — Configurações</h1>

      {error && <div className="text-red-600 mb-4">{error}</div>}
      
      <Card>
        <CardHeader>
          <CardTitle>Automação de Custos</CardTitle>
          <CardDescription>Configure as automações para otimizar seus custos na AWS</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Seção de Automações */}
          <div className="space-y-3">
            <label className="flex items-center">
              <input 
                type="checkbox" 
                checked={automation.stopIdle} 
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
                  setAutomation({ ...automation, stopIdle: e.target.checked })} 
                className="mr-2"
              />
              Habilitar desligamento de instâncias de dev ociosas
            </label>

            <label className="flex items-center">
              <input 
                type="checkbox" 
                checked={automation.deleteUnusedEbs} 
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
                  setAutomation({ ...automation, deleteUnusedEbs: e.target.checked })} 
                className="mr-2"
              />
              Habilitar exclusão automática de volumes EBS não anexados
            </label>
          </div>

          {/* Seção de Tags de Exclusão */}
          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Tags de Exclusão
              <p className="text-sm text-gray-500">
                Lista de tags (separadas por vírgula) para recursos que não devem ser afetados pelas automações.
                Exemplo: env:prod, critical:true
              </p>
            </label>
            <Input
              type="text"
              value={automation.exclusionTags || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
                setAutomation({ ...automation, exclusionTags: e.target.value })}
              placeholder="Ex: env:prod, critical:true"
              className="w-full"
            />
          </div>

          <button 
            disabled={saving} 
            onClick={save} 
            className="w-full px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar preferências'}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
