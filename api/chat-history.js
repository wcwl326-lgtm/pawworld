export const config = { runtime: 'edge' };

export default async function handler(req) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const url = new URL(req.url);
  const petId = url.searchParams.get('pet_id');

  // GET: load history for a pet
  if (req.method === 'GET') {
    if (!petId) return new Response(JSON.stringify({ error: 'Missing pet_id' }), { status: 400 });
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages?pet_id=eq.${petId}&order=created_at.asc&limit=200&select=id,role,content,created_at`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': authHeader } }
    );
    const data = await res.json();
    return new Response(JSON.stringify({ messages: data }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  // POST: save a message
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 }); }
    const { pet_id, role, content } = body;
    if (!pet_id || !role || !content) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });

    const userId = await getUserId(authHeader, SUPABASE_URL, SUPABASE_KEY);
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY, 'Authorization': authHeader,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ pet_id, user_id: userId, role, content })
    });
    if (!res.ok) return new Response(JSON.stringify({ error: '保存失败' }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // DELETE: clear all history for a pet
  if (req.method === 'DELETE') {
    if (!petId) return new Response(JSON.stringify({ error: 'Missing pet_id' }), { status: 400 });
    await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages?pet_id=eq.${petId}`,
      { method: 'DELETE', headers: { 'apikey': SUPABASE_KEY, 'Authorization': authHeader } }
    );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}

async function getUserId(authHeader, supabaseUrl, supabaseKey) {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'apikey': supabaseKey, 'Authorization': authHeader }
    });
    const data = await res.json();
    return data.id || null;
  } catch { return null; }
}
