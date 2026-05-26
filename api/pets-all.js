export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/pets?select=*&order=created_at.asc`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': authHeader }
  });
  const data = await res.json();
  return new Response(JSON.stringify({ pets: Array.isArray(data) ? data : [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
