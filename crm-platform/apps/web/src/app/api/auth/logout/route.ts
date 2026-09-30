import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { clearSessionCookies } from '@/lib/auth/cookies';

export async function POST() {
  clearSessionCookies(await cookies());
  return new NextResponse(null, { status: 204 });
}
