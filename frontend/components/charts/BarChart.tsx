import { BarChart as ReBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Skeleton } from '../ui/skeleton';

interface BarChartProps {
  data: any[];
  xKey: string;
  yKey: string;
  loading?: boolean;
  error?: string;
  height?: number;
}

export default function BarChart({ data, xKey, yKey, loading, error, height = 300 }: BarChartProps) {
  if (loading) return <Skeleton className="w-full h-[300px]" />;
  if (error) return <div className="text-destructive">Erro: {error}</div>;
  return (
    <div className="bg-background-light rounded-md shadow-sm p-4">
      <ResponsiveContainer width="100%" height={height}>
        <ReBarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          <Bar dataKey={yKey} fill="#2563eb" isAnimationActive={true} animationDuration={500} />
        </ReBarChart>
      </ResponsiveContainer>
    </div>
  );
}
