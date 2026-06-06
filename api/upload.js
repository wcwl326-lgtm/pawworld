// Image upload to Supabase Storage for posts
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 }); }

  const { imageBase64, mediaType } = body;
  if (!imageBase64) return new Response(JSON.stringify({ error: 'Missing image' }), { status: 400 });

  try {
    const binary = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
    const ext = mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : 'jpg';
    const filename = `posts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/pet-images/${filename}`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'apikey': SUPABASE_KEY,
        'Content-Type': mediaType || 'image/jpeg',
        'x-upsert': 'true'
      },
      body: binary
    });

    if (!uploadRes.ok) return new Response(JSON.stringify({ error: '上传失败' }), { status: 500 });
    const url = `${SUPABASE_URL}/storage/v1/object/public/pet-images/${filename}`;
    return new Response(JSON.stringify({ url }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ error: '上传失败' }), { status: 500 });
  }
}
