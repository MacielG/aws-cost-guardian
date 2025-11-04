"use client";

import { motion } from 'framer-motion';
import { DollarSign, Award, Database, Server, HardDrive } from 'lucide-react';
import AnimatedCounter from '@/components/ui/AnimatedCounter';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface SavingsData {
  month: string;
  totalSavings: number;
  commission: number;
  commissionRate: number;
  breakdown: {
    slaCredits?: number;
    idleInstances?: number;
    unusedEbs?: number;
    idleRds?: number;
  };
  attribution: {
    automated: number;
    manual: number;
  };
}

interface SavingsWidgetProps {
  data: SavingsData | null;
  loading?: boolean;
}

export const SavingsWidget = ({ data, loading }: SavingsWidgetProps) => {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="h-32 animate-pulse bg-muted rounded"></div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.totalSavings === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <DollarSign className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-2 text-sm font-medium">Nenhuma economia registrada</h3>
          <p className="mt-1 text-sm text-muted-foreground">Execute recomendações para começar a economizar</p>
        </CardContent>
      </Card>
    );
  }

  const breakdown = [
    {
      label: 'Créditos SLA',
      value: data.breakdown.slaCredits || 0,
      icon: Award,
      color: 'text-purple-600 dark:text-purple-400',
      bg: 'bg-purple-100 dark:bg-purple-900/40',
    },
    {
      label: 'Instâncias EC2',
      value: data.breakdown.idleInstances || 0,
      icon: Server,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-100 dark:bg-blue-900/40',
    },
    {
      label: 'Volumes EBS',
      value: data.breakdown.unusedEbs || 0,
      icon: HardDrive,
      color: 'text-green-600 dark:text-green-400',
      bg: 'bg-green-100 dark:bg-green-900/40',
    },
    {
      label: 'Banco RDS',
      value: data.breakdown.idleRds || 0,
      icon: Database,
      color: 'text-orange-600 dark:text-orange-400',
      bg: 'bg-orange-100 dark:bg-orange-900/40',
    },
  ];

  const automationPercentage = ((data.attribution.automated / data.totalSavings) * 100).toFixed(0);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Economias Realizadas</CardTitle>
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
            {data.month}
          </span>
        </CardHeader>

        <CardContent>
          <div className="flex items-baseline gap-2">
            <DollarSign className="h-8 w-8 text-green-600" />
            <div className="text-3xl font-bold">
              <AnimatedCounter value={data.totalSavings} formatValue={(v) => `$${v.toFixed(2)}`} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Sua comissão: <span className="font-semibold text-blue-600">
              <AnimatedCounter value={data.commission} formatValue={(v) => `$${v.toFixed(2)}`} />
            </span> ({data.commissionRate * 100}%)
          </p>

          {/* Breakdown */}
          <div className="mt-6 grid grid-cols-2 gap-3">
            {breakdown.map((item, idx) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1, duration: 0.3 }}
                className={`rounded-xl ${item.bg} p-3 transition-all duration-300 hover:shadow-lg border border-border`}
              >
                <div className="flex items-center gap-2">
                  <item.icon className={`h-5 w-5 ${item.color}`} />
                  <span className="text-xs font-medium text-foreground">{item.label}</span>
                </div>
                <p className={`mt-1 text-lg font-bold ${item.color}`}>
                  <AnimatedCounter value={item.value} formatValue={(v) => `$${v.toFixed(2)}`} />
                </p>
              </motion.div>
            ))}
          </div>

          {/* Automation Attribution */}
          <div className="mt-6 rounded-lg bg-card p-4 border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Automação</span>
              <span className="font-semibold text-green-600">{automationPercentage}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${automationPercentage}%` }}
                transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
                className="h-full bg-gradient-to-r from-green-500 to-green-600"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};
