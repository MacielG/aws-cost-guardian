"use client"; // Marca este componente como um Client Component

import React from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n'; // Importe sua instância i18n configurada

// Este componente encapsula a lógica de contexto do i18next
export function I18nClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // O I18nextProvider usa React Context e DEVE estar
  // dentro de um "use client"
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}