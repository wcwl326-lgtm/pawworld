export const config = { runtime: 'edge' };

export default async function handler(req) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  if (req.method === 'GET') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pets?select=*&order=created_at.desc&limit=1`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': authHeader }
    });
    const data = await res.json();
    return new Response(JSON.stringify({ pet: data[0] || null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 }); }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pets`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': authHeader, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return new Response(JSON.stringify({ pet: data[0] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (req.method === 'PATCH') {
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 }); }
    const { id, ...updates } = body;
    updates.updated_at = new Date().toISOString();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pets?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': authHeader, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(updates)
    });
    const data = await res.json();
    return new Response(JSON.stringify({ pet: data[0] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
