export const config = { runtime: 'edge' };

export default async function handler(req) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  // ── GET: fetch most recent pet ──────────────
  if (req.method === 'GET') {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pets?select=*&order=created_at.desc&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': authHeader } }
    );
    const data = await res.json();
    return new Response(JSON.stringify({ pet: data[0] || null }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  // ── POST: create new pet ────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
    }

    // Ensure avatar_version is always set on creation
    const petData = {
      ...body,
      avatar_version: body.avatar_version || 'ai_v1',
      // avatar_traits is already a JSON object from generate.js, Supabase JSONB handles it
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/pets`, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': authHeader,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation'
      },
      body: JSON.stringify(petData)
    });
    const data = await res.json();
    return new Response(JSON.stringify({ pet: data[0] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  // ── PATCH: update pet ───────────────────────
  if (req.method === 'PATCH') {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
    }

    const { id, ...updates } = body;
    updates.updated_at = new Date().toISOString();

    const res = await fetch(`${SUPABASE_URL}/rest/v1/pets?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': authHeader,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation'
      },
      body: JSON.stringify(updates)
    });
    const data = await res.json();
    return new Response(JSON.stringify({ pet: data[0] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
