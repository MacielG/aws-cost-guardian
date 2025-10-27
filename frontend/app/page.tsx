'use client';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { BarChart3, Shield, TrendingDown } from 'lucide-react';

export default function Home() {
  const { t } = useTranslation();

return (
<main className="min-h-screen bg-background-dark flex items-center justify-center p-6">
<div className="max-w-4xl w-full text-center">
<div className="mb-8">
    <h1 className="heading-1 mb-4">AWS Cost Guardian</h1>
    <p className="paragraph mb-6">Automate AWS refunds and optimize your cloud spending with intelligent cost monitoring</p>
  <div className="flex justify-center space-x-8 mb-8">
      <div className="flex items-center space-x-2">
          <BarChart3 className="w-5 h-5 text-primary-blue" />
            <span className="text-text-light">Real-time Monitoring</span>
            </div>
            <div className="flex items-center space-x-2">
              <Shield className="w-5 h-5 text-secondary-green" />
              <span className="text-text-light">Automated Refunds</span>
            </div>
            <div className="flex items-center space-x-2">
              <TrendingDown className="w-5 h-5 text-secondary-orange" />
              <span className="text-text-light">Cost Optimization</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/onboard">
            <Button size="lg" className="px-8">
              Start Onboarding
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline" size="lg" className="px-8">
              View Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}