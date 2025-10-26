"use client";
import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import TagsInput from '@/components/ui/tags-input';
import { Button } from '@/components/ui/button';
import { useNotify } from '@/hooks/useNotify';

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
  const notify = useNotify();

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
      notify.success('Preferências salvas com sucesso');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
      notify.error(`Erro ao salvar: ${err instanceof Error ? err.message : 'desconhecido'}`);
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
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Desligar instâncias ociosas (dev)</div>
                <p className="text-sm text-gray-500">Desliga instâncias com baixa atividade para reduzir custos.</p>
              </div>
              <div className="ml-4">
                <Switch
                  checked={automation.stopIdle}
                  onChange={(v) => setAutomation({ ...automation, stopIdle: v })}
                  ariaLabel="Habilitar desligamento de instâncias ociosas"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Excluir volumes EBS não anexados</div>
                <p className="text-sm text-gray-500">Remove automaticamente EBS que não estão anexados a nenhuma instância.</p>
              </div>
              <div className="ml-4">
                <Switch
                  checked={automation.deleteUnusedEbs}
                  onChange={(v) => setAutomation({ ...automation, deleteUnusedEbs: v })}
                  ariaLabel="Habilitar exclusão automática de EBS"
                />
              </div>
            </div>
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
            <TagsInput
              value={automation.exclusionTags || ''}
              onChange={(next) => setAutomation({ ...automation, exclusionTags: next })}
              placeholder="Ex: env:prod, critical:true"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex-1 inline-flex items-center justify-center rounded font-medium shadow-sm transition-colors duration-150 bg-blue-600 text-white px-4 py-2 disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar preferências'}
            </button>
            <button
              type="button"
              onClick={() => { setAutomation({ stopIdle: false, deleteUnusedEbs: false, exclusionTags: '' }); notify.info('Valores restaurados'); }}
              className="inline-flex items-center justify-center rounded font-medium shadow-sm transition-colors duration-150 bg-gray-100 text-gray-800 px-4 py-2"
            >
              Restaurar
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
