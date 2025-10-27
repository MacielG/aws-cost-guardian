'use client';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MainLayout } from '@/components/layouts/main-layout';
import { AlertCircle, DollarSign, TrendingUp, TrendingDown } from 'lucide-react';

interface Incident {
  id: string;
  service: string;
  impact: number;
  confidence: number;
  status: 'detected' | 'submitted' | 'refunded';
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [costs, setCosts] = useState<any[]>([]);
  const [loadingCosts, setLoadingCosts] = useState(true);

  useEffect(() => {
    fetch('/api/incidents')
      .then(res => res.json())
      .then(setIncidents);
  }, []);

  useEffect(() => {
    fetch('/api/dashboard/costs', { credentials: 'same-origin' })
      .then(res => {
        if (!res.ok) return [];
        return res.json();
      })
      .then((d) => {
        setCosts(Array.isArray(d) ? d : []);
      })
      .catch(() => setCosts([]))
      .finally(() => setLoadingCosts(false));
  }, []);

  const totalEarnings = incidents.reduce((sum, inc) => sum + (inc.status === 'refunded' ? inc.impact * 0.7 : 0), 0);
  const totalCost = costs.reduce((sum, day) => {
    if (day && day.Groups) {
      return sum + day.Groups.reduce((daySum: number, g: any) => daySum + parseFloat(g.Metrics?.UnblendedCost?.Amount || 0), 0);
    }
    return sum;
  }, 0);

  return (
    <MainLayout title={t('dashboard')}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Earnings</CardTitle>
            <DollarSign className="h-4 w-4 text-secondary-green" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-text-light">${totalEarnings.toFixed(2)}</div>
            <p className="text-xs text-secondary-green flex items-center">
              <TrendingUp className="w-3 h-3 mr-1" />
              +12% from last month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-secondary-red" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-text-light">${totalCost.toFixed(2)}</div>
            <p className="text-xs text-secondary-red flex items-center">
              <TrendingDown className="w-3 h-3 mr-1" />
              +8% from last month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Incidents</CardTitle>
            <AlertCircle className="h-4 w-4 text-secondary-orange" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-text-light">{incidents.filter(inc => inc.status !== 'refunded').length}</div>
            <p className="text-xs text-text-medium">
              {incidents.filter(inc => inc.status === 'detected').length} detected
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Incidents</CardTitle>
          </CardHeader>
          <CardContent>
            {incidents.length === 0 ? (
              <p className="text-muted">No incidents detected.</p>
            ) : (
              <div className="space-y-4">
                {incidents.slice(0, 5).map(inc => (
                  <div key={inc.id} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <AlertCircle className="w-5 h-5 text-secondary-red" />
                      <div>
                        <p className="text-sm font-medium text-text-light">{inc.service}</p>
                        <p className="text-xs text-text-medium">Impact: ${inc.impact}</p>
                      </div>
                    </div>
                    <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                      inc.status === 'refunded' ? 'bg-secondary-green text-text-light' :
                      inc.status === 'submitted' ? 'bg-secondary-orange text-text-light' :
                      'bg-secondary-red text-text-light'
                    }`}>
                      {inc.status}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Cost Services</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingCosts ? (
              <p className="text-muted">Loading cost data...</p>
            ) : costs.length === 0 ? (
              <p className="text-muted">No cost data available.</p>
            ) : (
              <div className="space-y-4">
                {(() => {
                  const serviceCosts: { [key: string]: number } = {};
                  try {
                    for (const day of costs) {
                      if (day && day.Groups) {
                        for (const g of day.Groups) {
                          const service = g.Keys?.[0] || 'Unknown';
                          const amount = parseFloat(g.Metrics?.UnblendedCost?.Amount || 0);
                          serviceCosts[service] = (serviceCosts[service] || 0) + amount;
                        }
                      }
                    }
                  } catch (e) {}
                  return Object.entries(serviceCosts)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 5)
                    .map(([service, amount]) => (
                      <div key={service} className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text-light">{service}</span>
                        <span className="text-sm text-text-medium">${amount.toFixed(2)}</span>
                      </div>
                    ));
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}