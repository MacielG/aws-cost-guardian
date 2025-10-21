// frontend/app/not-found.tsx
'use client';

export default function NotFound() {
  return (
    <div className="p-8 text-center">
      <h1 className="text-4xl font-bold mb-4">404 - Página não encontrada</h1>
      <p className="mb-4">Desculpe, não encontramos a página que você procura.</p>
      <a href="/" className="text-blue-500 hover:underline">
        Voltar para o início
      </a>
    </div>
  );
}