'use client';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function Home() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">{t('welcome')}</h1>
      <Link href="/onboard">
        <Button className="mt-4">{t('onboarding')}</Button>
      </Link>
      <Link href="/dashboard">
        <Button variant="outline" className="mt-2">{t('dashboard')}</Button>
      </Link>
    </main>
  );
}