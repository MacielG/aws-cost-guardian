import * as React from "react";
import { Toast, ToastProps } from "./toast";

interface ToasterContextProps {
  showToast: (props: ToastProps) => void;
}

const ToasterContext = React.createContext<ToasterContextProps | undefined>(undefined);

export function useToaster() {
  const context = React.useContext(ToasterContext);
  if (!context) throw new Error("useToaster must be used within ToasterProvider");
  return context;
}

export function ToasterProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastProps[]>([]);

  const showToast = (props: ToastProps) => {
    setToasts((prev) => [...prev, props]);
    setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 3500);
  };

  return (
    <ToasterContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast, idx) => (
          <Toast key={idx} {...toast} />
        ))}
      </div>
    </ToasterContext.Provider>
  );
}
