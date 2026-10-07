/** Reference's old reference addresses (`/docs`, `/docs/api`) lead to the public developer reference (TW-API-149). A plain 302, as there. */
export function GET() {
  return new Response(null, { status: 302, headers: { Location: '/developers/docs' } });
}
