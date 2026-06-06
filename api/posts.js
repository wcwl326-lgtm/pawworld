export const config = { runtime: 'edge' };

export default async function handler(req) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authHeader = req.headers.get('authorization');

  // GET: fetch feed (public, no auth needed)
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const cursor = url.searchParams.get('cursor'); // created_at of last item
    const limit = 10;

    let query = `${SUPABASE_URL}/rest/v1/posts?select=id,content,image_url,likes_count,comments_count,created_at,pet_id,user_id,pets(id,name,level,cartoon_url)&order=created_at.desc&limit=${limit}`;
    if (cursor) query += `&created_at=lt.${cursor}`;

    const res = await fetch(query, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const posts = await res.json();

    // If user is logged in, check which posts they liked
    let likedIds = [];
    if (authHeader) {
      const userId = await getUserId(authHeader, SUPABASE_URL, SUPABASE_KEY);
      if (userId && posts.length > 0) {
        const postIds = posts.map(p => `"${p.id}"`).join(',');
        const likesRes = await fetch(
          `${SUPABASE_URL}/rest/v1/likes?user_id=eq.${userId}&post_id=in.(${postIds})&select=post_id`,
          { headers: { 'apikey': SUPABASE_KEY, 'Authorization': authHeader } }
        );
        const likes = await likesRes.json();
        likedIds = likes.map(l => l.post_id);
      }
    }

    const enriched = posts.map(p => ({ ...p, liked: likedIds.includes(p.id) }));
    return new Response(JSON.stringify({ posts: enriched }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  // POST: create post (auth required)
  if (req.method === 'POST') {
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 }); }

    const { pet_id, content, image_url } = body;
    if (!content?.trim()) return new Response(JSON.stringify({ error: '内容不能为空' }), { status: 400 });

    const userId = await getUserId(authHeader, SUPABASE_URL, SUPABASE_KEY);
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const res = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY, 'Authorization': authHeader,
        'Content-Type': 'application/json', 'Prefer': 'return=representation'
      },
      body: JSON.stringify({ pet_id, user_id: userId, content: content.trim(), image_url: image_url || null })
    });
    const data = await res.json();
    return new Response(JSON.stringify({ post: data[0] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  // DELETE: delete post
  if (req.method === 'DELETE') {
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    const url = new URL(req.url);
    const postId = url.searchParams.get('id');
    if (!postId) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });

    await fetch(`${SUPABASE_URL}/rest/v1/posts?id=eq.${postId}`, {
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
