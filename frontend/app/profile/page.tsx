'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { useAuth } from '@/components/auth/AuthProvider';
import { updatePassword } from 'aws-amplify/auth';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageAnimator } from '@/components/layout/PageAnimator';
import { UnfoldAnimator } from '@/components/layout/UnfoldAnimator';
import { Input } from '@/components/ui/input';

export default function ProfilePage() {
  const { user } = useAuth();
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    // Validações
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('As senhas não coincidem');
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      setPasswordError('A nova senha deve ter pelo menos 8 caracteres');
      return;
    }

    try {
      setIsChangingPassword(true);
      
      await updatePassword({
        oldPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });

      setPasswordSuccess(true);
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (err: any) {
      console.error('Erro ao alterar senha:', err);
      setPasswordError(err.message || 'Erro ao alterar senha. Verifique se a senha atual está correta.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <PageAnimator>
      <div className="space-y-6">
        <PageHeader title="PERFIL_USUARIO" description="Configurações e preferências da conta" />

      {/* Informações da Conta */}
      <UnfoldAnimator>
        <Card>
          <CardHeader>
            <CardTitle className="neon-text-primary">INFORMACOES_CONTA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-mono text-muted-foreground mb-1">
                  EMAIL
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex-1 px-4 py-2 bg-background/50 rounded-md border border-border">
                    <p className="text-foreground">{user?.email || user?.username}</p>
                  </div>
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20">
                    <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Email verificado</p>
              </div>

              <div>
                <label className="block text-xs font-mono text-muted-foreground mb-1">
                  USER_ID
                </label>
                <div className="px-4 py-2 bg-background/50 rounded-md border border-border">
                  <p className="text-foreground font-mono text-xs">{user?.userId}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Identificador único</p>
              </div>
            </div>

            <Alert variant="info">
              <h4 className="font-semibold">Informação</h4>
              <p className="mt-1 text-sm">
                O email não pode ser alterado após a criação da conta. Se precisar usar outro email, 
                entre em contato com o suporte.
              </p>
            </Alert>
          </CardContent>
        </Card>
      </UnfoldAnimator>

      {/* Segurança - Alterar Senha */}
      <UnfoldAnimator delay={0.1}>
        <Card>
          <CardHeader>
            <CardTitle className="neon-text-secondary">SEGURANCA</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-muted-foreground mb-1">
                  SENHA_ATUAL
                </label>
                <Input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  placeholder="> ********"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-muted-foreground mb-1">
                  NOVA_SENHA
                </label>
                <Input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  placeholder="> ********"
                  required
                  minLength={8}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Mínimo 8 caracteres, incluindo maiúsculas, minúsculas, números e símbolos
                </p>
              </div>

              <div>
                <label className="block text-xs font-mono text-muted-foreground mb-1">
                  CONFIRMAR_NOVA_SENHA
                </label>
                <Input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  placeholder="> ********"
                  required
                />
              </div>

              {passwordError && (
                <Alert variant="error">
                  <p className="text-sm">{passwordError}</p>
                </Alert>
              )}

              {passwordSuccess && (
                <Alert variant="success">
                  <h4 className="font-semibold">Senha alterada com sucesso!</h4>
                  <p className="mt-1 text-sm">Sua senha foi atualizada.</p>
                </Alert>
              )}

              <Button 
                type="submit" 
                isLoading={isChangingPassword}
                className="w-full md:w-auto"
                variant="secondary"
              >
                ALTERAR_SENHA
              </Button>
            </form>
          </CardContent>
        </Card>
      </UnfoldAnimator>

      {/* Preferências */}
      <UnfoldAnimator delay={0.2}>
        <Card>
        <CardHeader>
          <CardTitle>PREFERENCIAS</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <h4 className="font-medium text-foreground">Notificações por Email</h4>
              <p className="text-sm text-muted-foreground">Receber alertas de novas recomendações e SLA claims</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-accent peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-background after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <h4 className="font-medium text-foreground">Relatórios Semanais</h4>
              <p className="text-sm text-muted-foreground">Resumo semanal de economias e atividades</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-accent peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-background after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <h4 className="font-medium text-foreground">Alertas de Economia Alta</h4>
              <p className="text-sm text-muted-foreground">Notificar quando uma recomendação pode economizar mais de $500</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-accent peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-background after:border-border after:border after:rounded-full after:h-5 after'w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          <Alert variant="warning">
            <h4 className="font-semibold">Em Desenvolvimento</h4>
            <p className="mt-1 text-sm">
              As configurações de preferências serão salvas na próxima atualização.
            </p>
          </Alert>
        </CardContent>
        </Card>
      </UnfoldAnimator>

        {/* Zona de Perigo */}
      <UnfoldAnimator delay={0.3}>
        <Card className="border-destructive/50 bg-destructive/10">
          <CardHeader>
            <CardTitle className="text-destructive">ZONA_DE_PERIGO</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 border border-destructive/30 rounded-lg bg-destructive/10">
              <h4 className="font-medium text-destructive-foreground">Excluir Conta</h4>
              <p className="mt-1 text-sm text-destructive-foreground/80">
                Uma vez que você exclua sua conta, não há como voltar atrás. 
                Todos os seus dados serão permanentemente removidos.
              </p>
              <Button 
                variant="danger" 
                className="mt-4"
                onClick={() => alert('Funcionalidade de exclusão de conta será implementada em breve')}
              >
                Excluir Minha Conta
              </Button>
            </div>
          </CardContent>
        </Card>
      </UnfoldAnimator>
      </div>
    </PageAnimator>
    );
}
