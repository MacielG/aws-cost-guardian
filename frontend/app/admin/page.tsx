'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { PageAnimator } from '@/components/layout/PageAnimator';
import { AdminRoute } from '@/components/auth/AdminRoute';
import { apiFetch } from '@/lib/api';
import { Users, TrendingUp, DollarSign, Activity, AlertCircle, Settings, Tag, Gift, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface AdminMetrics {
  customers: {
    total: number;
    trial: number;
    active: number;
    churnedThisMonth: number;
  };
  revenue: {
    thisMonth: number;
    lastMonth: number;
    growth: number;
  };
  leads: {
    newThisWeek: number;
    conversionRate: number;
    highValueCount: number;
  };
  recommendations: {
    totalGenerated: number;
    executed: number;
    executionRate: number;
  };
  sla: {
    claimsDetected: number;
    claimsSubmitted: number;
    creditsRecovered: number;
  };
}

interface AdminSettings {
  commissionRate: number;
  updatedAt?: string;
  updatedBy?: string;
}

interface Coupon {
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  validUntil: string;
  maxUses?: number;
  usedCount: number;
  description: string;
  active: boolean;
  createdAt: string;
}

interface Promotion {
  name: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  validUntil: string;
  targetCustomers: 'all' | 'trial' | 'active';
  description: string;
  active: boolean;
  createdAt: string;
  sk?: string; // DynamoDB sort key
}

function AdminContent() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  // Settings state
  const [settings, setSettings] = useState<AdminSettings>({ commissionRate: 0.30 });
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);



  // Form states
  const [commissionRateInput, setCommissionRateInput] = useState('30');
  const [newCoupon, setNewCoupon] = useState({
    code: '',
    discountType: 'percentage' as 'percentage' | 'fixed',
    discountValue: '',
    validUntil: '',
    maxUses: '',
    description: ''
  });
  const [newPromotion, setNewPromotion] = useState({
    name: '',
    discountType: 'percentage' as 'percentage' | 'fixed',
    discountValue: '',
    validUntil: '',
    targetCustomers: 'all' as 'all' | 'trial' | 'active',
    description: ''
  });

  useEffect(() => {
    loadMetrics();
    loadSettings();
  }, []);

  const loadMetrics = async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/api/admin/metrics');
      setMetrics(data);
    } catch (err: any) {
      console.error('Erro ao carregar métricas:', err);
      toast.error('Erro ao carregar métricas admin');
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const data = await apiFetch('/api/admin/settings');
      setSettings(data.settings);
      setCoupons(data.coupons);
      setPromotions(data.promotions);
      setCommissionRateInput((data.settings.commissionRate * 100).toString());
    } catch (err: any) {
      console.error('Erro ao carregar configurações:', err);
      toast.error('Erro ao carregar configurações');
    }
  };

  const updateCommissionRate = async () => {
    try {
      setSettingsLoading(true);
      const rate = parseFloat(commissionRateInput) / 100;
      if (isNaN(rate) || rate < 0 || rate > 1) {
        toast.error('Taxa deve ser entre 0 e 100');
        return;
      }

      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ commissionRate: rate })
      });

      toast.success('Taxa de comissão atualizada');
      loadSettings();
    } catch (err: any) {
      console.error('Erro ao atualizar comissão:', err);
      toast.error('Erro ao atualizar taxa de comissão');
    } finally {
      setSettingsLoading(false);
    }
  };

  const createCoupon = async () => {
    try {
      await apiFetch('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({
          ...newCoupon,
          discountValue: parseFloat(newCoupon.discountValue),
          maxUses: newCoupon.maxUses ? parseInt(newCoupon.maxUses) : undefined
        })
      });

      toast.success('Cupom criado com sucesso');
      setNewCoupon({
        code: '',
        discountType: 'percentage',
        discountValue: '',
        validUntil: '',
        maxUses: '',
        description: ''
      });
      loadSettings();
    } catch (err: any) {
      console.error('Erro ao criar cupom:', err);
      toast.error(err.message || 'Erro ao criar cupom');
    }
  };

  const deleteCoupon = async (code: string) => {
    if (!confirm('Tem certeza que deseja excluir este cupom?')) return;

    try {
      await apiFetch(`/api/admin/coupons/${code}`, {
        method: 'DELETE'
      });

      toast.success('Cupom excluído');
      loadSettings();
    } catch (err: any) {
      console.error('Erro ao excluir cupom:', err);
      toast.error('Erro ao excluir cupom');
    }
  };

  const createPromotion = async () => {
    try {
      await apiFetch('/api/admin/promotions', {
        method: 'POST',
        body: JSON.stringify({
          ...newPromotion,
          discountValue: parseFloat(newPromotion.discountValue)
        })
      });

      toast.success('Promoção criada com sucesso');
      setNewPromotion({
        name: '',
        discountType: 'percentage',
        discountValue: '',
        validUntil: '',
        targetCustomers: 'all',
        description: ''
      });
      loadSettings();
    } catch (err: any) {
      console.error('Erro ao criar promoção:', err);
      toast.error(err.message || 'Erro ao criar promoção');
    }
  };

  const deletePromotion = async (promotion: Promotion, index: number) => {
    if (!confirm('Tem certeza que deseja excluir esta promoção?')) return;

    try {
      // Usar createdAt como identificador único (timestamp)
      const id = new Date(promotion.createdAt).getTime().toString();

      await apiFetch(`/api/admin/promotions/${id}`, {
        method: 'DELETE'
      });

      toast.success('Promoção excluída');
      loadSettings();
    } catch (err: any) {
      console.error('Erro ao excluir promoção:', err);
      toast.error('Erro ao excluir promoção');
    }
  };

  if (loading) {
    return (
      <AdminRoute>
        <PageAnimator>
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        </PageAnimator>
      </AdminRoute>
    );
  }

  return (
    <AdminRoute>
      <PageAnimator>
        <div className="space-y-6">
        {/* KPIs Principais */}
        <div className="grid md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="w-4 h-4" />
                Total Clientes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics?.customers.total || 0}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {metrics?.customers.active || 0} Active | {metrics?.customers.trial || 0} Trial
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Receita (Mês)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                ${metrics?.revenue.thisMonth.toFixed(2) || '0.00'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {metrics && metrics.revenue.growth > 0 ? '+' : ''}
                {metrics?.revenue.growth.toFixed(1) || 0}% vs último mês
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Taxa Conversão
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {metrics?.leads.conversionRate.toFixed(1) || 0}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {metrics?.leads.newThisWeek || 0} novos leads esta semana
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Execuções
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">
                {metrics?.recommendations.executionRate.toFixed(1) || 0}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {metrics?.recommendations.executed || 0} de {metrics?.recommendations.totalGenerated || 0}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detalhes */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Funil de Conversão</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Leads (Trial)</span>
                <span className="font-bold">{metrics?.customers.trial || 0}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full" 
                  style={{ width: '100%' }}
                />
              </div>

              <div className="flex justify-between items-center mt-4">
                <span className="text-sm text-muted-foreground">Convertidos (Active)</span>
                <span className="font-bold text-green-600">{metrics?.customers.active || 0}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-green-500 h-2 rounded-full" 
                  style={{ 
                    width: `${metrics?.leads.conversionRate || 0}%` 
                  }}
                />
              </div>

              <div className="flex justify-between items-center mt-4">
                <span className="text-sm text-muted-foreground">Churn (Este Mês)</span>
                <span className="font-bold text-red-600">{metrics?.customers.churnedThisMonth || 0}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Créditos SLA</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Claims Detectados</span>
                <span className="font-bold">{metrics?.sla.claimsDetected || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Claims Submetidos</span>
                <span className="font-bold text-blue-600">{metrics?.sla.claimsSubmitted || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Total Recuperado</span>
                <span className="font-bold text-green-600">
                  ${metrics?.sla.creditsRecovered.toFixed(2) || '0.00'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Nossa Comissão (30%)</span>
                <span className="font-bold text-purple-600">
                  ${((metrics?.sla.creditsRecovered || 0) * 0.3).toFixed(2)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Leads de Alto Valor */}
        {metrics && metrics.leads.highValueCount > 0 && (
          <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950">
            <CardHeader>
              <CardTitle className="text-orange-900 dark:text-orange-100 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                Leads de Alto Valor
              </CardTitle>
            </CardHeader>
            <CardContent className="text-orange-800 dark:text-orange-200">
              <p>
                🔥 <strong>{metrics.leads.highValueCount} leads</strong> com economia potencial &gt; $500/mês detectados.
                Ação recomendada: Contato proativo para conversão.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Configurações do Sistema */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Configurações do Sistema
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Taxa de Comissão */}
            <div className="space-y-2">
              <Label htmlFor="commissionRate">Taxa de Comissão (%)</Label>
              <div className="flex gap-2">
                <Input
                  id="commissionRate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={commissionRateInput}
                  onChange={(e) => setCommissionRateInput(e.target.value)}
                  placeholder="30"
                />
                <Button
                  onClick={updateCommissionRate}
                  disabled={settingsLoading}
                >
                  {settingsLoading ? 'Salvando...' : 'Atualizar'}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Taxa atual: {(settings.commissionRate * 100).toFixed(1)}%
                {settings.updatedAt && ` (atualizado em ${new Date(settings.updatedAt).toLocaleString()})`}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Cupons de Desconto */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5" />
              Cupons de Desconto
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                placeholder="Código do cupom"
                value={newCoupon.code}
                onChange={(e) => setNewCoupon({...newCoupon, code: e.target.value.toUpperCase()})}
              />
              <Select value={newCoupon.discountType} onValueChange={(value) => setNewCoupon({...newCoupon, discountType: value as 'percentage' | 'fixed'})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Porcentagem</SelectItem>
                  <SelectItem value="fixed">Valor Fixo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                type="number"
                placeholder="Valor"
                value={newCoupon.discountValue}
                onChange={(e) => setNewCoupon({...newCoupon, discountValue: e.target.value})}
              />
              <Input
                type="datetime-local"
                value={newCoupon.validUntil}
                onChange={(e) => setNewCoupon({...newCoupon, validUntil: e.target.value})}
              />
              <Input
                placeholder="Descrição"
                value={newCoupon.description}
                onChange={(e) => setNewCoupon({...newCoupon, description: e.target.value})}
              />
            </div>
            <Button onClick={createCoupon}>
              <Plus className="w-4 h-4 mr-2" />
              Criar Cupom
            </Button>

            <div className="mt-6">
              <h4 className="font-medium mb-3">Cupons Ativos</h4>
              <div className="space-y-2">
                {coupons.map((coupon) => (
                  <div key={coupon.code} className="flex items-center justify-between p-3 border rounded">
                    <div>
                      <span className="font-medium">{coupon.code}</span>
                      <span className="ml-2 text-sm text-muted-foreground">
                        {coupon.discountValue}{coupon.discountType === 'percentage' ? '%' : '$'}
                      </span>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteCoupon(coupon.code)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {coupons.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    Nenhum cupom criado ainda
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Promoções */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5" />
              Promoções
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                placeholder="Nome da promoção"
                value={newPromotion.name}
                onChange={(e) => setNewPromotion({...newPromotion, name: e.target.value})}
              />
              <Select value={newPromotion.discountType} onValueChange={(value) => setNewPromotion({...newPromotion, discountType: value as 'percentage' | 'fixed'})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Porcentagem</SelectItem>
                  <SelectItem value="fixed">Valor Fixo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                type="number"
                placeholder="Valor"
                value={newPromotion.discountValue}
                onChange={(e) => setNewPromotion({...newPromotion, discountValue: e.target.value})}
              />
              <Input
                type="datetime-local"
                value={newPromotion.validUntil}
                onChange={(e) => setNewPromotion({...newPromotion, validUntil: e.target.value})}
              />
              <Select value={newPromotion.targetCustomers} onValueChange={(value) => setNewPromotion({...newPromotion, targetCustomers: value as 'all' | 'trial' | 'active'})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="trial">Apenas Trial</SelectItem>
                  <SelectItem value="active">Apenas Active</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              placeholder="Descrição"
              value={newPromotion.description}
              onChange={(e) => setNewPromotion({...newPromotion, description: e.target.value})}
            />
            <Button onClick={createPromotion}>
              <Plus className="w-4 h-4 mr-2" />
              Criar Promoção
            </Button>

            <div className="mt-6">
              <h4 className="font-medium mb-3">Promoções Ativas</h4>
              <div className="space-y-2">
                {promotions.map((promotion, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded">
                    <div>
                      <span className="font-medium">{promotion.name}</span>
                      <span className="ml-2 text-sm text-muted-foreground">
                        {promotion.discountValue}{promotion.discountType === 'percentage' ? '%' : '$'}
                      </span>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deletePromotion(promotion, index)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {promotions.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    Nenhuma promoção criada ainda
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      </PageAnimator>
    </AdminRoute>
  );
}

export default function AdminPage() {
  return (
    <AdminRoute>
      <AdminContent />
    </AdminRoute>
  );
}
