"use client";
import React from "react";
import Link from "next/link";
import { Bell, User, LogOut, Settings, LayoutDashboard } from "lucide-react";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// import { useAuth } from '@/contexts/AuthContext'; // Descomente quando o contexto de auth estiver pronto
 
export function Header() {
  // const { user, signOut } = useAuth(); // Descomente
  const user = { name: "Usuário Teste" }; // Mock
  const signOut = () => console.log("Sign out"); // Mock
 
  return (
    <header className="flex h-16 items-center justify-end border-b border-border bg-background/80 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="rounded-full">
          <Bell className="h-5 w-5" />
          <span className="sr-only">Toggle notifications</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" className="rounded-full">
              <User className="h-5 w-5" />
              <span className="sr-only">Toggle user menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{user?.name || "Minha Conta"}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile"><User className="mr-2 h-4 w-4" />Meu Perfil</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings"><Settings className="mr-2 h-4 w-4" />Configurações</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive focus:bg-destructive/10">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sair</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
