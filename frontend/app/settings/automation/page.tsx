"use client";

import { useState, useEffect } from 'react';
import { PageAnimator } from '@/components/ui/PageAnimator';
import { Settings, Loader2, Save, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

interface TagFilter {
  Key: string;
  Values: string[];
}

interface AutomationConfig {
  enabled: boolean;
  regions: string[];
  filters: {
    tags: TagFilter[];
    instanceStates?: string[];
    volumeStates?: string[];
  };
  thresholds: {
    cpuUtilization?: number;
    evaluationPeriodHours?: number;
    daysUnused?: number;
  };
  exclusionTags: string[];
}

interface AutomationSettings {
  stopIdleInstances: AutomationConfig;
  deleteUnusedEbs: AutomationConfig;
  stopIdleRds?: AutomationConfig;
}

export default function AutomationSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<AutomationSettings | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings/automation');
      if (!response.ok) throw new Error('Failed to fetch settings');
      const data = await response.json();
      setSettings(data.settings || getDefaultSettings());
    } catch (error) {
      console.error('Error fetching settings:', error);
      toast.error('Erro ao carregar configurações');
      setSettings(getDefaultSettings());
    } finally {
      setLoading(false);
    }
  };

  const getDefaultSettings = (): AutomationSettings => ({
    stopIdleInstances: {
      enabled: false,
      regions: ['us-east-1'],
      filters: {
        tags: [{ Key: 'Environment', Values: ['dev', 'staging'] }],
        instanceStates: ['running']
      },
      thresholds: {
        cpuUtilization: 5,
        evaluationPeriodHours: 24
      },
      exclusionTags: []
    },
    deleteUnusedEbs: {
      enabled: false,
      regions: ['us-east-1'],
      filters: {
        tags: [],
        volumeStates: ['available']
      },
      thresholds: {
        daysUnused: 7
      },
      exclusionTags: []
    }
  });

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, settings })
      });

      if (!response.ok) throw new Error('Failed to save settings');
      toast.success('Configurações salvas com sucesso');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <PageAnimator>
      <div className="container mx-auto max-w-4xl p-6">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Automação</h1>
              <p className="text-sm text-gray-500">Configure as regras de otimização automática</p>
            </div>
          </div>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition-all duration-150 hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar
          </button>
        </div>

        {/* Stop Idle Instances */}
        <AutomationSection
          title="Parar Instâncias Ociosas"
          description="Identifica e recomenda parar instâncias EC2 com baixa utilização de CPU"
          config={settings.stopIdleInstances}
          onChange={(config) => setSettings({ ...settings, stopIdleInstances: config })}
          showCpuThreshold
        />

        {/* Delete Unused EBS */}
        <AutomationSection
          title="Deletar Volumes EBS Não Utilizados"
          description="Identifica volumes EBS disponíveis (não anexados) há muito tempo"
          config={settings.deleteUnusedEbs}
          onChange={(config) => setSettings({ ...settings, deleteUnusedEbs: config })}
          showDaysThreshold
        />
      </div>
    </PageAnimator>
  );
}

interface AutomationSectionProps {
  title: string;
  description: string;
  config: AutomationConfig;
  onChange: (config: AutomationConfig) => void;
  showCpuThreshold?: boolean;
  showDaysThreshold?: boolean;
}

function AutomationSection({ 
  title, 
  description, 
  config, 
  onChange,
  showCpuThreshold,
  showDaysThreshold
}: AutomationSectionProps) {
  const [newRegion, setNewRegion] = useState('');
  const [newExclusionTag, setNewExclusionTag] = useState('');

  const addRegion = () => {
    if (newRegion && !config.regions.includes(newRegion)) {
      onChange({ ...config, regions: [...config.regions, newRegion] });
      setNewRegion('');
    }
  };

  const removeRegion = (region: string) => {
    onChange({ ...config, regions: config.regions.filter(r => r !== region) });
  };

  const addExclusionTag = () => {
    if (newExclusionTag && !config.exclusionTags.includes(newExclusionTag)) {
      onChange({ ...config, exclusionTags: [...config.exclusionTags, newExclusionTag] });
      setNewExclusionTag('');
    }
  };

  const removeExclusionTag = (tag: string) => {
    onChange({ ...config, exclusionTags: config.exclusionTags.filter(t => t !== tag) });
  };

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition-all duration-300 hover:shadow-md">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
            className="peer sr-only"
          />
          <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300"></div>
        </label>
      </div>

      {config.enabled && (
        <div className="space-y-4 border-t border-gray-100 pt-4">
          {/* Regions */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Regiões AWS</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newRegion}
                onChange={(e) => setNewRegion(e.target.value)}
                placeholder="us-west-2"
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                onKeyPress={(e) => e.key === 'Enter' && addRegion()}
              />
              <button
                onClick={addRegion}
                className="rounded-md bg-blue-100 px-3 py-2 text-blue-600 transition-colors hover:bg-blue-200"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {config.regions.map((region) => (
                <span
                  key={region}
                  className="flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-700"
                >
                  {region}
                  <button onClick={() => removeRegion(region)} className="hover:text-blue-900">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Thresholds */}
          {showCpuThreshold && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                CPU Utilization Threshold (%)
              </label>
              <input
                type="number"
                value={config.thresholds.cpuUtilization || 5}
                onChange={(e) => onChange({
                  ...config,
                  thresholds: { ...config.thresholds, cpuUtilization: Number(e.target.value) }
                })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                min="0"
                max="100"
              />
            </div>
          )}

          {showDaysThreshold && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Dias Não Utilizado
              </label>
              <input
                type="number"
                value={config.thresholds.daysUnused || 7}
                onChange={(e) => onChange({
                  ...config,
                  thresholds: { ...config.thresholds, daysUnused: Number(e.target.value) }
                })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                min="1"
              />
            </div>
          )}

          {/* Exclusion Tags */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Tags de Exclusão (Botão de Emergência)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newExclusionTag}
                onChange={(e) => setNewExclusionTag(e.target.value)}
                placeholder="CostGuardian:Exclude"
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                onKeyPress={(e) => e.key === 'Enter' && addExclusionTag()}
              />
              <button
                onClick={addExclusionTag}
                className="rounded-md bg-blue-100 px-3 py-2 text-blue-600 transition-colors hover:bg-blue-200"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {config.exclusionTags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-sm text-red-700"
                >
                  {tag}
                  <button onClick={() => removeExclusionTag(tag)} className="hover:text-red-900">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
