export const config = { runtime: 'edge' };

export default async function handler(req) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const userId = await getUserId(authHeader, SUPABASE_URL, SUPABASE_KEY);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  // GET: fetch notifications + unread count
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    if (action === 'count') {
      // Just return unread count (for badge)
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${userId}&is_read=eq.false&select=id`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': authHeader, 'Prefer': 'count=exact' } }
      );
      const count = parseInt(res.headers.get('content-range')?.split('/')[1] || '0');
      return new Response(JSON.stringify({ count }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Full list
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${userId}&order=created_at.desc&limit=30`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': authHeader } }
    );
    const data = await res.json();
    return new Response(JSON.stringify({ notifications: data }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  // PATCH: mark all as read
  if (req.method === 'PATCH') {
    await fetch(
      `${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${userId}&is_read=eq.false`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY, 'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ is_read: true })
      }
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
