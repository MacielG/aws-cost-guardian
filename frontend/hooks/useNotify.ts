import { useToaster } from '@/components/ui/toaster';

export function useNotify() {
  const { showToast } = useToaster();

  return {
    success: (message: string) => showToast({ variant: 'success', message }),
    error: (message: string) => showToast({ variant: 'error', message }),
    info: (message: string) => showToast({ variant: 'info', message }),
  };
}
