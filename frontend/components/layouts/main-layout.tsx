import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { Sidebar } from '../ui/sidebar';
import { Header } from '../ui/header';

interface MainLayoutProps {
  children: React.ReactNode;
  title: string;
}

export function MainLayout({ children, title }: MainLayoutProps) {
const pathname = usePathname();

return (
<div className="flex min-h-screen bg-background-dark">
<Sidebar />
<div className="flex-1 flex flex-col">
<Header title={title} />
<AnimatePresence mode="wait">
    <motion.main
        key={pathname}
          initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="flex-1 p-6"
          >
            {children}
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  );
}
