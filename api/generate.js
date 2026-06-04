// Node.js runtime
export const config = { runtime: 'nodejs', maxDuration: 60 };

const SUPPORTED_SPECIES = ['dog', 'cat', 'rabbit', 'hamster', 'bird', 'turtle'];

function buildTraitPrompt(petName) {
  return `You are a pet trait extractor. Analyze this photo carefully.

Pet name: "${petName}"

PART A: Check if the pet is one of: dog, cat, rabbit, hamster, bird, turtle.
If NOT one of these 6, set "supported": false.
If the image is not an animal, set "supported": false.

PART B: If supported, extract traits.

Reply ONLY with valid JSON, no markdown:

If supported:
{"supported":true,"species":"dog","breed":"golden_retriever","breed_display":"金毛寻回犬","confidence":0.95,"morphology":{"ear_type":"floppy","tail_type":"long","body_size":"large","snout_length":"medium"},"appearance":{"fur_color_primary":"golden","fur_color_secondary":null,"fur_pattern":"solid","fur_length":"long","eye_color":"brown"},"personality_hints":["friendly","energetic"],"description_zh":"金色长毛金毛犬，垂耳长尾，眼神温柔","description_en":"Golden Retriever with golden long fur, floppy ears, long tail"}

If not supported:
{"supported":false,"detected":"lizard","message_zh":"抱歉，目前只支持狗、猫、兔子、仓鼠、鸟和乌龟 🐾"}`;
}

function buildAvatarPrompt(traits) {
  const { species, breed_display, appearance, morphology } = traits;

  const furDesc = [
    appearance.fur_color_primary,
    appearance.fur_color_secondary ? `and ${appearance.fur_color_secondary}` : '',
    appearance.fur_length ? `${appearance.fur_length} fur` : ''
  ].filter(Boolean).join(' ');

  const earDesc = morphology.ear_type === 'pointy' ? 'pointed ears' :
                  morphology.ear_type === 'floppy' ? 'floppy ears' :
                  morphology.ear_type === 'round'  ? 'round ears' : 'ears';

  const tailDesc = morphology.tail_type === 'curly' ? 'curled tail' :
                   morphology.tail_type === 'long'  ? 'long tail' :
                   morphology.tail_type === 'short' ? 'short tail' :
                   morphology.tail_type === 'none'  ? 'no tail' : 'tail';

  return [
    `anthropomorphic ${species} character`,
    breed_display || '',
    furDesc,
    earDesc,
    tailDesc,
    'standing upright on two legs',
    'Zootopia Disney animation style',
    '2D cartoon illustration',
    'full body head to toe',
    'centered in frame',
    'arms relaxed at sides',
    'friendly expression',
    'pure white background',
    'clean studio lighting',
    'high quality'
  ].filter(Boolean).join(', ');
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const REPLICATE_KEY = process.env.REPLICATE_API_KEY;
  const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!ANTHROPIC_KEY || !REPLICATE_KEY) {
    return new Response(JSON.stringify({ error: 'API keys not configured' }), { status: 500 });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
  }

  const { imageBase64, mediaType, petName, pollId, userToken } = body;

  // ── POLL MODE: just check Replicate status ──────────────────
  // This is fast (<2s), no timeout risk
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
      // still processing
      return new Response(JSON.stringify({ status: 'pending' }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    } catch {
      return new Response(JSON.stringify({ status: 'pending' }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // ── GENERATE MODE ───────────────────────────────────────────
  if (!petName) {
    return new Response(JSON.stringify({ error: '请填写宠物名字' }), { status: 400 });
  }
  if (!imageBase64) {
    return new Response(JSON.stringify({ error: '请上传宠物照片' }), { status: 400 });
  }

  // Step 1: Claude analyzes traits (~3-5s, well within timeout)
  const contentParts = [
    { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
    { type: 'text', text: buildTraitPrompt(petName) }
  ];

  let traits;
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: contentParts }]
      })
    });

    if (!claudeRes.ok) {
      return new Response(JSON.stringify({ error: '特征识别失败，请重试' }), { status: 500 });
    }

    const claudeData = await claudeRes.json();
    let claudeText = claudeData.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    traits = JSON.parse(claudeText);
  } catch {
    return new Response(JSON.stringify({ error: '特征识别失败，请重试' }), { status: 500 });
  }

  // Species check
  if (!traits.supported) {
    return new Response(JSON.stringify({
      error: 'unsupported_species',
      message: traits.message_zh || '抱歉，目前只支持狗、猫、兔子、仓鼠、鸟和乌龟 🐾'
    }), { status: 422 });
  }
  if (!SUPPORTED_SPECIES.includes(traits.species)) {
    return new Response(JSON.stringify({
      error: 'unsupported_species',
      message: '抱歉，目前只支持狗、猫、兔子、仓鼠、鸟和乌龟 🐾'
    }), { status: 422 });
  }

  // Step 2: Start Replicate — fire and return predictionId immediately
  // Replicate is async, frontend polls separately
  const prompt = buildAvatarPrompt(traits);

  const avatarTraits = {
    schema_version: '1.0',
    avatar_version: 'ai_v1',
    species:  traits.species,
    breed:    traits.breed,
    breed_display: traits.breed_display,
    confidence: traits.confidence,
    morphology: traits.morphology,
    appearance: traits.appearance,
    personality_hints: traits.personality_hints || [],
    generation: {
      generated_prompt: prompt,
      model: 'flux-dev',
      style: 'zootopia',
      generated_at: new Date().toISOString()
    }
  };

  try {
    const replicateRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + REPLICATE_KEY,
        'Prefer':        'respond-async' // tell Replicate to return immediately
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
      const err = await replicateRes.json();
      return new Response(JSON.stringify({ error: '图片生成启动失败，请重试' }), { status: 500 });
    }

    const replicateData = await replicateRes.json();

    // If Replicate returned synchronously (rare)
    if (replicateData.output?.[0]) {
      const permanentUrl = await uploadToStorage(replicateData.output[0], SUPABASE_URL, SUPABASE_KEY, userToken);
      return new Response(JSON.stringify({
        status:       'done',
        imageUrl:     permanentUrl || replicateData.output[0],
        description:  traits.description_zh,
        avatarTraits
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Normal: return predictionId for frontend polling
    return new Response(JSON.stringify({
      status:       'pending',
      predictionId: replicateData.id,
      description:  traits.description_zh,
      avatarTraits
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch {
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
