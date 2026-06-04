// Edge runtime - only starts Replicate job, returns immediately
export const config = { runtime: 'edge' };

const SUPPORTED_SPECIES = ['dog', 'cat', 'rabbit', 'hamster', 'bird', 'turtle'];

function buildAvatarPrompt(traits) {
  const { species, breed_display, appearance, morphology } = traits;
  const furDesc = [
    appearance?.fur_color_primary || '',
    appearance?.fur_color_secondary ? `and ${appearance.fur_color_secondary}` : '',
    appearance?.fur_length ? `${appearance.fur_length} fur` : ''
  ].filter(Boolean).join(' ');
  const earDesc = morphology?.ear_type === 'pointy' ? 'pointed ears' :
                  morphology?.ear_type === 'floppy' ? 'floppy ears' :
                  morphology?.ear_type === 'round'  ? 'round ears' : 'ears';
  const tailDesc = morphology?.tail_type === 'curly' ? 'curled tail' :
                   morphology?.tail_type === 'long'  ? 'long tail' :
                   morphology?.tail_type === 'short' ? 'short stubby tail' :
                   morphology?.tail_type === 'none'  ? 'no tail' : 'tail';
  return [
    `anthropomorphic ${species} character`,
    breed_display || '',
    furDesc, earDesc, tailDesc,
    'standing upright on two legs',
    'Zootopia Disney animation style',
    '2D cartoon illustration',
    'full body head to toe visible',
    'centered in frame',
    'arms relaxed at sides',
    'friendly happy expression',
    'pure white background #FFFFFF',
    'clean studio lighting',
    'high quality Disney concept art'
  ].filter(Boolean).join(', ');
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const REPLICATE_KEY = process.env.REPLICATE_API_KEY;
  const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!REPLICATE_KEY) {
    return new Response(JSON.stringify({ error: 'API keys not configured' }), { status: 500 });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
  }

  const { traits, petName, pollId, userToken } = body;

  // ── POLL MODE: check Replicate status (fast, <2s) ──────────
  if (pollId) {
    try {
      const pollRes  = await fetch(`https://api.replicate.com/v1/predictions/${pollId}`, {
        headers: { 'Authorization': 'Bearer ' + REPLICATE_KEY }
      });
      const pollData = await pollRes.json();

      if (pollData.status === 'succeeded') {
        const tempUrl = pollData.output?.[0];
        if (!tempUrl) return new Response(JSON.stringify({ status: 'failed', error: '图片生成失败' }), { status: 500 });
        const permanentUrl = await uploadToStorage(tempUrl, SUPABASE_URL, SUPABASE_KEY, userToken);
        return new Response(JSON.stringify({ status: 'done', imageUrl: permanentUrl || tempUrl }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      if (pollData.status === 'failed') {
        return new Response(JSON.stringify({ status: 'failed', error: '图片生成失败，请重试' }), { status: 500 });
      }
      return new Response(JSON.stringify({ status: 'pending' }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    } catch {
      return new Response(JSON.stringify({ status: 'pending' }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // ── START MODE: kick off Replicate with pre-analyzed traits ─
  if (!traits || !traits.species) {
    return new Response(JSON.stringify({ error: '缺少宠物特征数据' }), { status: 400 });
  }
  if (!SUPPORTED_SPECIES.includes(traits.species)) {
    return new Response(JSON.stringify({
      error: 'unsupported_species',
      message: '抱歉，目前只支持狗、猫、兔子、仓鼠、鸟和乌龟 🐾'
    }), { status: 422 });
  }

  const prompt = buildAvatarPrompt(traits);

  try {
    const replicateRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + REPLICATE_KEY,
      },
      body: JSON.stringify({
        input: {
          prompt,
          num_outputs:         1,
          aspect_ratio:        '2:3',
          output_format:       'webp',
          output_quality:      85,
          num_inference_steps: 28,
          guidance:            3.5
        }
      })
    });

    if (!replicateRes.ok) {
      return new Response(JSON.stringify({ error: '图片生成启动失败，请重试' }), { status: 500 });
    }

    const replicateData = await replicateRes.json();

    // Sync result (rare)
    if (replicateData.output?.[0]) {
      const permanentUrl = await uploadToStorage(replicateData.output[0], SUPABASE_URL, SUPABASE_KEY, userToken);
      return new Response(JSON.stringify({
        status:   'done',
        imageUrl: permanentUrl || replicateData.output[0]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Async: return predictionId for polling
    return new Response(JSON.stringify({
      status:       'pending',
      predictionId: replicateData.id
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: '图片生成启动失败，请重试' }), { status: 500 });
  }
}

async function uploadToStorage(tempUrl, supabaseUrl, supabaseKey, userToken) {
  try {
    const imgRes = await fetch(tempUrl);
    if (!imgRes.ok) return null;
    const imgBlob = await imgRes.arrayBuffer();
    const filename = `pets/${Date.now()}_${Math.random().toString(36).slice(2)}.webp`;
    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/pet-images/${filename}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken || supabaseKey}`,
        'apikey':        supabaseKey,
        'Content-Type':  'image/webp',
        'x-upsert':      'true'
      },
      body: imgBlob
    });
    if (!uploadRes.ok) return null;
    return `${supabaseUrl}/storage/v1/object/public/pet-images/${filename}`;
  } catch { return null; }
}
