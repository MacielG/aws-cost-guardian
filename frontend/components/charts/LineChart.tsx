import { LineChart as ReLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Skeleton } from '../ui/skeleton';

interface LineChartProps {
  data: any[];
  xKey: string;
  yKey: string;
  loading?: boolean;
  error?: string;
  height?: number;
}

export default function LineChart({ data, xKey, yKey, loading, error, height = 300 }: LineChartProps) {
  if (loading) return <Skeleton className="w-full h-[300px]" />;
  if (error) return <div className="text-destructive">Erro: {error}</div>;
  return (
    <div className="bg-white rounded-md shadow-sm p-4">
      <ResponsiveContainer width="100%" height={height}>
        <ReLineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey={yKey} stroke="#2563eb" strokeWidth={2} dot={false} />
        </ReLineChart>
      </ResponsiveContainer>
    </div>
  );
}
