"use client";

import React from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import AppLayout from "./AppLayout";

export default function AuthLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, isLoadingAuth } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Carregando...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return <AppLayout>{children}</AppLayout>;
  }

  return <>{children}</>;
}
