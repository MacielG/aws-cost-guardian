"use client";

import React from "react";

interface PageShellProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export default function PageShell({ title, subtitle, actions, children }: PageShellProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="mt-2 text-gray-600">{subtitle}</p>}
        </div>

        {actions && <div className="flex items-center">{actions}</div>}
      </div>

      <div>{children}</div>
    </div>
  );
}
