import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/server';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  if ((await getSession()).user) redirect('/dashboard');
  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center px-4">
      <LoginForm />
    </main>
  );
}
