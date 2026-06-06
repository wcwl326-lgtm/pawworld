export const config = { runtime: 'edge' };

export default async function handler(req) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authHeader = req.headers.get('authorization');

  // GET: fetch comments for a post
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const postId = url.searchParams.get('post_id');
    if (!postId) return new Response(JSON.stringify({ error: 'Missing post_id' }), { status: 400 });

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/comments?post_id=eq.${postId}&order=created_at.asc&select=*`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    return new Response(JSON.stringify({ comments: data }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  // POST: create comment
  if (req.method === 'POST') {
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 }); }

    const { post_id, pet_id, pet_name, pet_avatar, content } = body;
    if (!content?.trim()) return new Response(JSON.stringify({ error: '评论不能为空' }), { status: 400 });

    const userId = await getUserId(authHeader, SUPABASE_URL, SUPABASE_KEY);
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const res = await fetch(`${SUPABASE_URL}/rest/v1/comments`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY, 'Authorization': authHeader,
        'Content-Type': 'application/json', 'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        post_id, pet_id, user_id: userId,
        content: content.trim(),
        pet_name: pet_name || '宠物',
        pet_avatar: pet_avatar || null
      })
    });
    const data = await res.json();
    return new Response(JSON.stringify({ comment: data[0] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  // DELETE: delete comment
  if (req.method === 'DELETE') {
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    const url = new URL(req.url);
    const commentId = url.searchParams.get('id');
    if (!commentId) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });

    await fetch(`${SUPABASE_URL}/rest/v1/comments?id=eq.${commentId}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': authHeader }
    });
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
