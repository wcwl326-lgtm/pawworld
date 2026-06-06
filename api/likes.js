export const config = { runtime: 'edge' };

export default async function handler(req) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 }); }
  const { post_id, action } = body; // action: 'like' | 'unlike'

  const userId = await getUserId(authHeader, SUPABASE_URL, SUPABASE_KEY);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  if (action === 'like') {
    await fetch(`${SUPABASE_URL}/rest/v1/likes`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY, 'Authorization': authHeader,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ post_id, user_id: userId })
    });
  } else {
    await fetch(`${SUPABASE_URL}/rest/v1/likes?post_id=eq.${post_id}&user_id=eq.${userId}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': authHeader }
    });
  }

  // Get updated likes count
  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/posts?id=eq.${post_id}&select=likes_count`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const countData = await countRes.json();
  return new Response(JSON.stringify({ likes_count: countData[0]?.likes_count ?? 0 }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
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
