"use client";

import { motion } from 'framer-motion';
import { DollarSign, TrendingUp, TrendingDown, Award, Database, Server, HardDrive } from 'lucide-react';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';

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
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="h-32 animate-pulse bg-gray-100 rounded"></div>
      </div>
    );
  }

  if (!data || data.totalSavings === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-8 text-center">
        <DollarSign className="mx-auto h-12 w-12 text-gray-400" />
        <h3 className="mt-2 text-sm font-medium text-gray-900">Nenhuma economia registrada</h3>
        <p className="mt-1 text-sm text-gray-500">Execute recomendações para começar a economizar</p>
      </div>
    );
  }

  const breakdown = [
    { 
      label: 'Créditos SLA', 
      value: data.breakdown.slaCredits || 0, 
      icon: Award, 
      color: 'text-purple-600',
      bg: 'bg-purple-100'
    },
    { 
      label: 'Instâncias EC2', 
      value: data.breakdown.idleInstances || 0, 
      icon: Server, 
      color: 'text-blue-600',
      bg: 'bg-blue-100'
    },
    { 
      label: 'Volumes EBS', 
      value: data.breakdown.unusedEbs || 0, 
      icon: HardDrive, 
      color: 'text-green-600',
      bg: 'bg-green-100'
    },
    { 
      label: 'Banco RDS', 
      value: data.breakdown.idleRds || 0, 
      icon: Database, 
      color: 'text-orange-600',
      bg: 'bg-orange-100'
    },
  ];

  const automationPercentage = ((data.attribution.automated / data.totalSavings) * 100).toFixed(0);

  return (
    <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.4, ease: 'easeOut' }}
    className="overflow-hidden rounded-2xl border border-gray-200/50 bg-gradient-to-br from-white/90 via-blue-50/80 to-indigo-50/90 shadow-xl backdrop-blur-lg hover:shadow-2xl transition-shadow duration-300"
    >
      <div className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Economias Realizadas</h2>
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
            {data.month}
          </span>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline gap-2">
            <DollarSign className="h-8 w-8 text-green-600" />
            <h3 className="text-4xl font-bold text-gray-900">
              <AnimatedCounter value={data.totalSavings} prefix="$" decimals={2} />
            </h3>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Sua comissão: <span className="font-semibold text-blue-600">
              <AnimatedCounter value={data.commission} prefix="$" decimals={2} />
            </span> ({data.commissionRate * 100}%)
          </p>
        </div>

        {/* Breakdown */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          {breakdown.map((item, idx) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.1, duration: 0.3 }}
              className={`rounded-lg ${item.bg} p-3 transition-all duration-300 hover:shadow-md`}
            >
              <div className="flex items-center gap-2">
                <item.icon className={`h-5 w-5 ${item.color}`} />
                <span className="text-xs font-medium text-gray-700">{item.label}</span>
              </div>
              <p className={`mt-1 text-lg font-bold ${item.color}`}>
                <AnimatedCounter value={item.value} prefix="$" decimals={2} />
              </p>
            </motion.div>
          ))}
        </div>

        {/* Automation Attribution */}
        <div className="mt-6 rounded-lg bg-white p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Automação</span>
            <span className="font-semibold text-green-600">{automationPercentage}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${automationPercentage}%` }}
              transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
              className="h-full bg-gradient-to-r from-green-500 to-green-600"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
};
