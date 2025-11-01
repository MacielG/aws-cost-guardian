// frontend/app/sla-claims/page.tsx
'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Activity, Calculator, FileWarning, FileText, Download } from 'lucide-react';
import { PageAnimator } from '@/components/layout/PageAnimator';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// Mock data - substitua pela chamada de API
const mockClaims = [
  { id: 'claim-001', incidentId: 'inc-abc-123', service: 'EC2', region: 'us-east-1', status: 'CREDIT_RECOVERED', creditAmount: 150.75, incidentStart: '2023-10-25T10:00:00Z', incidentEnd: '2023-10-25T11:30:00Z', impactedCost: 1507.50, reportUrl: '#' },
  { id: 'claim-002', incidentId: 'inc-def-456', service: 'RDS', region: 'sa-east-1', status: 'SUBMITTED', creditAmount: 45.20, incidentStart: '2023-10-28T14:00:00Z', incidentEnd: '2023-10-28T14:45:00Z', impactedCost: 452.00, reportUrl: '#' },
  { id: 'claim-003', incidentId: 'inc-ghi-789', service: 'S3', region: 'us-east-1', status: 'ANALYSIS_COMPLETE', creditAmount: 0, incidentStart: '2023-11-01T08:00:00Z', incidentEnd: '2023-11-01T08:15:00Z', impactedCost: 10.00, reportUrl: null },
];

const processSteps = [
    { icon: Activity, title: "1. Detecção do Evento", description: "Monitoramos o AWS Health Dashboard da sua conta. Tudo começa quando a AWS relata oficialmente uma falha de serviço que afetou seus recursos." },
    { icon: Calculator, title: "2. Cálculo de Impacto", description: "Usando a API do Cost Explorer, calculamos com precisão o custo dos recursos afetados, somente durante o período exato da falha." },
    { icon: FileWarning, title: "3. Verificação de Violação do SLA", description: "Comparamos a duração da falha com o tempo de atividade prometido no SLA do serviço. Se o tempo de inatividade exceder o limite, há uma violação." },
    { icon: ShieldCheck, title: "4. Reivindicação e Relatório", description: "Geramos um relatório em PDF com todas as provas e abrimos um caso de suporte em seu nome, solicitando o crédito de 10% a 30% do custo impactado." },
];

const statusConfig: { [key: string]: { variant: "success" | "warning" | "default" | "secondary", label: string } } = {
    'CREDIT_RECOVERED': { variant: 'success', label: 'Crédito Recuperado' },
    'SUBMITTED': { variant: 'default', label: 'Submetido à AWS' },
    'ANALYSIS_COMPLETE': { variant: 'secondary', label: 'Análise Concluída' },
    'DETECTED': { variant: 'secondary', label: 'Incidente Detectado' },
};

export default function SlaClaimsPage() {

  const getDuration = (start: string, end: string) => {
    const durationMs = new Date(end).getTime() - new Date(start).getTime();
    return (durationMs / 60000).toFixed(0);
  }

  return (
    <PageAnimator>
      <PageHeader
        title="Reivindicações de Crédito SLA"
        description="Monitoramos falhas de serviço da AWS e recuperamos automaticamente os créditos a que você tem direito."
      />

      {/* Seção Explicativa com Timeline */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-xl">Nosso Processo de Recuperação de Crédito</CardTitle>
            <CardDescription>Transparência total em como transformamos uma falha da AWS em dinheiro de volta para você.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative">
              {/* Linha da timeline */}
              <div className="absolute left-6 top-6 h-full border-l-2 border-dashed border-border -z-10" />
              <div className="space-y-8">
                {processSteps.map((step, index) => (
                  <div key={index} className="flex items-start gap-6">
                    <div className="flex-shrink-0 w-12 h-12 bg-background border-2 border-primary/20 text-primary rounded-full flex items-center justify-center z-10">
                      <step.icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg mb-1">{step.title}</h3>
                      <p className="text-muted-foreground">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Lista de Claims */}
      <Card>
        <CardHeader>
          <CardTitle>Suas Reivindicações de SLA</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {mockClaims.map((claim) => (
              <AccordionItem key={claim.id} value={claim.id}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <div className="flex items-center gap-4 text-left">
                      <div className={`w-3 h-3 rounded-full ${statusConfig[claim.status]?.variant === 'success' ? 'bg-green-500' : 'bg-blue-500'}`} />
                      <div>
                        <p className="font-semibold">{claim.service} - {claim.region}</p>
                        <p className="text-sm text-muted-foreground">Incidente: {claim.incidentId}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {claim.status === 'CREDIT_RECOVERED' && (
                         <span className="font-bold text-green-600 dark:text-green-400 text-lg">
                            +${claim.creditAmount.toFixed(2)}
                         </span>
                      )}
                      <Badge variant={statusConfig[claim.status]?.variant || 'default'}>
                        {statusConfig[claim.status]?.label || claim.status}
                      </Badge>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="p-4 bg-muted/50 rounded-md space-y-3">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Duração da Falha:</span>
                      <span className="font-medium">{getDuration(claim.incidentStart, claim.incidentEnd)} minutos</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Custo Impactado no Período:</span>
                      <span className="font-medium">${claim.impactedCost.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Crédito Solicitado (10%):</span>
                      <span className="font-semibold">${(claim.impactedCost * 0.1).toFixed(2)}</span>
                    </div>
                    {claim.reportUrl && (
                      <div className="pt-4">
                        <Button variant="outline" size="sm" asChild>
                          <a href={claim.reportUrl} target="_blank" rel="noopener noreferrer">
                            <Download className="mr-2 h-4 w-4" />
                            Baixar Relatório PDF
                          </a>
                        </Button>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </PageAnimator>
  );
}