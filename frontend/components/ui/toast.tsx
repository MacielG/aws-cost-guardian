import * as React from "react";
import { cn } from "@/lib/utils";

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "success" | "error" | "info";
  message: string;
}

export function Toast({ variant = "info", message, className, ...props }: ToastProps) {
  const color =
    variant === "success"
      ? "bg-accent-green text-white"
      : variant === "error"
      ? "bg-accent-red text-white"
      : "bg-primary text-white";
  return (
    <div
      className={cn(
        "px-4 py-2 rounded shadow-md flex items-center gap-2 text-sm font-medium transition-colors duration-150",
        color,
        className
      )}
      {...props}
    >
      {message}
    </div>
  );
}
