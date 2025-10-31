import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

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
  items?: Array<{
    type: string;
    recommendationId: string;
    amount: number;
    executedAt: string;
    executedBy: string;
  }>;
}

export const useSavings = (month?: string) => {
  const [data, setData] = useState<SavingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSavings();
  }, [month]);

  const fetchSavings = async () => {
    try {
      setLoading(true);
      const currentMonth = month || new Date().toISOString().slice(0, 7);
      const response = await apiFetch(`/api/billing/savings/${currentMonth}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          setData(null);
          return;
        }
        throw new Error('Failed to fetch savings data');
      }

      const savingsData = await response.json();
      setData(savingsData.totalSavings ? savingsData : null);
    } catch (err) {
      console.error('Error fetching savings:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return { data, loading, error, refetch: fetchSavings };
};
