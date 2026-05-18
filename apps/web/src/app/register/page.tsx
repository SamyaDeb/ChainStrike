'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function RegisterPage() {
  return (
    <Suspense>
      <Redirect />
    </Suspense>
  );
}

function Redirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const params = new URLSearchParams();
    const redirect = searchParams.get('redirect');
    const intent = searchParams.get('intent');
    if (redirect) params.set('redirect', redirect);
    if (intent) params.set('intent', intent);
    // Carry mode=register so login page opens the register form immediately
    params.set('mode', 'register');
    router.replace(`/login?${params.toString()}`);
  }, [router, searchParams]);
  return null;
}
