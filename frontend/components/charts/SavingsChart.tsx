'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface SavingsChartProps {
  data: Array<{
    month: string;
    savings: number;
    slaCredits: number;
  }>;
}

export function SavingsChart({ data }: SavingsChartProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis 
          dataKey="month" 
          stroke="#6b7280"
          style={{ fontSize: '12px' }}
        />
        <YAxis 
          stroke="#6b7280"
          style={{ fontSize: '12px' }}
          tickFormatter={formatCurrency}
        />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '12px'
          }}
          formatter={(value: number) => formatCurrency(value)}
        />
        <Legend 
          wrapperStyle={{ fontSize: '14px' }}
        />
        <Line 
          type="monotone" 
          dataKey="savings" 
          stroke="#2563eb" 
          strokeWidth={2}
          name="Economias de Recomendações"
          dot={{ fill: '#2563eb', r: 4 }}
          activeDot={{ r: 6 }}
        />
        <Line 
          type="monotone" 
          dataKey="slaCredits" 
          stroke="#16a34a" 
          strokeWidth={2}
          name="Créditos SLA"
          dot={{ fill: '#16a34a', r: 4 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
