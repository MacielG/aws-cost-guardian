"use client";
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import TagsInput from '@/components/ui/tags-input';
import { Button } from '@/components/ui/button';
import { MainLayout } from '@/components/layouts/main-layout';
import { useNotify } from '@/hooks/useNotify';

interface AutomationSettings {
  stopIdle: boolean;
  deleteUnusedEbs: boolean;
  exclusionTags?: string;
}

export default function AutomationSettingsPage() {
  const { t } = useTranslation();
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

  if (loading) return (
    <MainLayout title={t('settings.automation')}>
      <div className="text-muted">{t('common.loading')}</div>
    </MainLayout>
  );

  return (
    <MainLayout title={t('settings.automation')}>
      <div className="space-y-6">
        <h1 className="heading-1">{t('settings.automation')}</h1>

        {error && <div className="text-secondary-red mb-4">{error}</div>}
      
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.automation.costAutomation')}</CardTitle>
            <CardDescription>{t('settings.automation.description')}</CardDescription>
          </CardHeader>
        <CardContent className="space-y-6">
          {/* Seção de Automações */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
            <div>
            <div className="font-medium">{t('settings.automation.stopIdle.title')}</div>
            <p className="text-sm text-muted">{t('settings.automation.stopIdle.description')}</p>
            </div>
            <div className="ml-4">
            <Switch
            checked={automation.stopIdle}
            onChange={(v) => setAutomation({ ...automation, stopIdle: v })}
            ariaLabel={t('settings.automation.stopIdle.ariaLabel')}
            />
            </div>
            </div>

            <div className="flex items-center justify-between">
            <div>
            <div className="font-medium">{t('settings.automation.deleteUnusedEbs.title')}</div>
            <p className="text-sm text-muted">{t('settings.automation.deleteUnusedEbs.description')}</p>
            </div>
            <div className="ml-4">
            <Switch
            checked={automation.deleteUnusedEbs}
            onChange={(v) => setAutomation({ ...automation, deleteUnusedEbs: v })}
            ariaLabel={t('settings.automation.deleteUnusedEbs.ariaLabel')}
            />
            </div>
            </div>
          </div>

          {/* Seção de Tags de Exclusão */}
          <div className="space-y-2">
          <label className="block text-sm font-medium">
          {t('settings.automation.exclusionTags.title')}
          <p className="text-sm text-muted">
          {t('settings.automation.exclusionTags.description')}
          </p>
          </label>
          <TagsInput
            value={automation.exclusionTags || ''}
          onChange={(next) => setAutomation({ ...automation, exclusionTags: next })}
          placeholder={t('settings.automation.exclusionTags.placeholder')}
          />
          </div>

          <div className="flex gap-3">
          <Button
          onClick={save}
          isLoading={saving}
          className="flex-1"
          >
            {saving ? t('common.saving') : t('settings.automation.savePreferences')}
          </Button>
          <Button
            variant="outline"
          onClick={() => {
            setAutomation({ stopIdle: false, deleteUnusedEbs: false, exclusionTags: '' });
            notify.info(t('settings.automation.resetSuccess'));
            }}
          >
            {t('settings.automation.reset')}
            </Button>
            </div>
            </CardContent>
              </Card>
              </div>
    </MainLayout>
  );
}
