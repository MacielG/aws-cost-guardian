'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { useAuth } from '@/components/auth/AuthProvider';
import { updatePassword } from 'aws-amplify/auth';

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
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Meu Perfil</h1>
        <p className="mt-2 text-gray-600">
          Gerencie suas informações pessoais e configurações de conta
        </p>
      </div>

      {/* Informações da Conta */}
      <Card>
        <CardHeader>
          <CardTitle>Informações da Conta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <div className="flex items-center gap-3">
                <div className="flex-1 px-4 py-2 bg-gray-50 rounded-md border border-gray-200">
                  <p className="text-gray-900">{user?.email || user?.username}</p>
                </div>
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100">
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              <p className="mt-1 text-xs text-gray-500">Email verificado</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                User ID
              </label>
              <div className="px-4 py-2 bg-gray-50 rounded-md border border-gray-200">
                <p className="text-gray-900 font-mono text-xs">{user?.userId}</p>
              </div>
              <p className="mt-1 text-xs text-gray-500">Identificador único</p>
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

      {/* Segurança - Alterar Senha */}
      <Card>
        <CardHeader>
          <CardTitle>Segurança</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Senha Atual
              </label>
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Digite sua senha atual"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nova Senha
              </label>
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Digite sua nova senha"
                required
                minLength={8}
              />
              <p className="mt-1 text-xs text-gray-500">
                Mínimo 8 caracteres, incluindo maiúsculas, minúsculas, números e símbolos
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Confirmar Nova Senha
              </label>
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Confirme sua nova senha"
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
            >
              Alterar Senha
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Preferências */}
      <Card>
        <CardHeader>
          <CardTitle>Preferências</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-gray-200">
            <div>
              <h4 className="font-medium text-gray-900">Notificações por Email</h4>
              <p className="text-sm text-gray-600">Receber alertas de novas recomendações e SLA claims</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-gray-200">
            <div>
              <h4 className="font-medium text-gray-900">Relatórios Semanais</h4>
              <p className="text-sm text-gray-600">Resumo semanal de economias e atividades</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <h4 className="font-medium text-gray-900">Alertas de Economia Alta</h4>
              <p className="text-sm text-gray-600">Notificar quando uma recomendação pode economizar mais de $500</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
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

      {/* Zona de Perigo */}
      <Card>
        <CardHeader>
          <CardTitle className="text-red-600">Zona de Perigo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 border border-red-200 rounded-lg bg-red-50">
            <h4 className="font-medium text-red-900">Excluir Conta</h4>
            <p className="mt-1 text-sm text-red-700">
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
    </div>
  );
}
