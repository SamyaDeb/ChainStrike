import { IssuerNavbar } from '@/components/layout/issuer-navbar';
import { RequireAuth } from '@/components/auth/require-auth';

export default function IssuerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <IssuerNavbar />
      <main className="flex-1">
        <RequireAuth context="issuer">{children}</RequireAuth>
      </main>
    </div>
  );
}
