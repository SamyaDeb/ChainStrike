import { Navbar } from '@/components/layout/navbar';
import { RequireAuth } from '@/components/auth/require-auth';

export default function TradingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <RequireAuth context="investor" publicPaths={['/markets']}>
          {children}
        </RequireAuth>
      </main>
    </div>
  );
}
