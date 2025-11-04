// frontend/app/recommendations/page.tsx
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { useNotify } from '@/hooks/useNotify';
import { motion } from 'framer-motion';
import { BarChart2, Search, Zap, CheckCircle, Info, SlidersHorizontal, Tag, DollarSign, Server, Database, Globe } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';



const recommendationStatusVariant: { [key: string]: "success" | "warning" | "secondary" } = {
  'ACTIVE': 'warning',
  'EXECUTED': 'success',
};

const recommendationTypeIcon: { [key: string]: React.ElementType } = {
  'IDLE_INSTANCE': Server,
  'UNUSED_EBS': Database,
  'OPTIMIZE_RDS': Database,
  'UNUSED_EIP': Globe,
  'default': DollarSign,
};

type StatusFilter = "ALL" | "ACTIVE" | "EXECUTED";

const processSteps = [
    { icon: Search, title: "Análise Contínua", description: "Monitoramos seus recursos AWS 24/7, cruzando dados de uso, métricas do CloudWatch e custos." },
    { icon: BarChart2, title: "Identificação de Padrões", description: "Nossos algoritmos identificam padrões de ociosidade, superdimensionamento e desperdício." },
    { icon: Zap, title: "Ação Inteligente", description: "Geramos recomendações claras para você executar com um clique, ou automatizamos a otimização para você." },
];

export default function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [selectedRec, setSelectedRec] = useState<any | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [regionFilter, setRegionFilter] = useState<string>("ALL");
  const [isExecuting, setIsExecuting] = useState(false);
  const notify = useNotify();

  useEffect(() => {
    const fetchRecs = async () => {
      try {
        const recs = await apiClient.get('/recommendations');
        setRecommendations(recs || []);
      } catch (err: any) {
        console.error('Erro ao carregar recomendações:', err);
        notify.error(err?.message || 'Erro ao carregar recomendações');
      }
    };
    fetchRecs();
  }, [notify]);

  const availableRegions = useMemo(() => {
    const regions = new Set(recommendations.map(rec => rec.region));
    return ['ALL', ...Array.from(regions)];
  }, [recommendations]);

  const filteredRecommendations = useMemo(() => {
    return recommendations
      .filter(rec => statusFilter === 'ALL' || rec.status === statusFilter)
      .filter(rec => regionFilter === 'ALL' || rec.region === regionFilter)
      .filter(rec => 
        rec.resourceId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        rec.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
        rec.region.toLowerCase().includes(searchTerm.toLowerCase())
      );
  }, [recommendations, statusFilter, regionFilter, searchTerm]);


  const handleExecute = async (recommendationId: string) => {
    setIsExecuting(true);
    notify.info(`Executando recomendação ${recommendationId}...`);

    try {
      // Chamada real à API para executar recomendação
      await apiClient.post(`/recommendations/${recommendationId}/execute`);

      setRecommendations((prev) =>
        prev.map((rec) => (rec.id === recommendationId ? { ...rec, status: 'EXECUTED' } : rec))
      );
      notify.success('Recomendação executada com sucesso!');
      setSelectedRec(null);
    } catch (err: any) {
      console.error('Erro ao executar recomendação:', err);
      notify.error(err?.message || 'Falha ao executar recomendação');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Recomendações de Otimização"
        description="Encontre e execute ações para reduzir seus custos na AWS de forma inteligente."
      />

      {/* Seção Como Funciona */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-xl">Como Nossas Recomendações Funcionam</CardTitle>
          </CardHeader>
          <CardContent className="grid md:grid-cols-3 gap-8">
            {processSteps.map((step, index) => (
              <div key={index} className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-primary/10 text-primary rounded-lg flex items-center justify-center">
                  <step.icon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </motion.div>

      {/* Filtros e Lista de Recomendações */}
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Filtros</CardTitle>
            <SlidersHorizontal className="w-5 h-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex-1">
              <Input 
                placeholder="Buscar por ID do recurso, tipo ou região..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)} >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filtrar por status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos os Status</SelectItem>
                <SelectItem value="ACTIVE">Ativas</SelectItem>
                <SelectItem value="EXECUTED">Executadas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={regionFilter} onValueChange={(value) => setRegionFilter(value)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filtrar por região" />
              </SelectTrigger>
              <SelectContent>
                {availableRegions.map(region => (
                  <SelectItem key={region} value={region}>
                    {region === 'ALL' ? 'Todas as Regiões' : region}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredRecommendations.map((rec) => {
            const Icon = recommendationTypeIcon[rec.type] || recommendationTypeIcon.default;
            return (
              <Card key={rec.id} className="flex flex-col">
                <CardHeader className="flex-row items-start gap-4 space-y-0">
                  <div className="flex-shrink-0 w-10 h-10 bg-primary/10 text-primary rounded-lg flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-base mb-1">{rec.type.replace(/_/g, ' ')}</CardTitle>
                    <p className="text-xs font-mono text-muted-foreground">{rec.resourceId}</p>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Economia Potencial</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">${rec.potentialSaving.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant={recommendationStatusVariant[rec.status]}>{rec.status}</Badge>
                  </div>
                </CardContent>
                <div className="p-4 pt-0">
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setSelectedRec(rec)}>
                    Ver Detalhes e Ações
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
        {filteredRecommendations.length === 0 && (
          <Card className="text-center py-12">
            <CardContent>
              <Tag className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">Nenhuma Recomendação Encontrada</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Não encontramos recomendações com os filtros aplicados.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Painel de Detalhes da Recomendação */}
      <Sheet open={!!selectedRec} onOpenChange={(open: boolean) => !open && setSelectedRec(null)}>
        <SheetContent className="w-[400px] sm:w-[540px]">
          {selectedRec && (
            <>
              <SheetHeader>
                <SheetTitle>Detalhes da Recomendação</SheetTitle>
                <SheetDescription>
                  Revise os detalhes abaixo antes de executar a ação.
                </SheetDescription>
              </SheetHeader>
              <div className="py-4 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Tipo:</span>
                  <span className="font-semibold">{selectedRec.type.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Recurso:</span>
                  <span className="font-mono text-sm">{selectedRec.resourceId}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Economia Potencial:</span>
                  <span className="font-bold text-lg text-green-600">${selectedRec.potentialSaving.toFixed(2)}</span>
                </div>
                <Card className="bg-muted/50">
                  <CardHeader className="flex-row items-center gap-3 space-y-0">
                    <Info className="w-5 h-5 text-muted-foreground" />
                    <CardTitle className="text-base">Motivo</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{selectedRec.reason}</p>
                  </CardContent>
                </Card>
              </div>
              <SheetFooter>
                {selectedRec.status === 'ACTIVE' ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button className="w-full" disabled={isExecuting}>
                        <Zap className="mr-2 h-4 w-4" /> {isExecuting ? 'Executando...' : 'Executar Ação'}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Confirmar Execução?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta ação executará a otimização recomendada no recurso <strong className="font-mono">{selectedRec.resourceId}</strong>. A ação é segura e projetada para ser reversível sempre que possível. Deseja continuar?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleExecute(selectedRec.id)}>Confirmar e Executar</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <div className="flex items-center justify-center w-full text-green-600 gap-2">
                    <CheckCircle className="w-5 h-5" />
                    <span className="font-semibold">Esta recomendação já foi executada.</span>
                  </div>
                )}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}