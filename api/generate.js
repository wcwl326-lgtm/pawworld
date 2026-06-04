export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────
// Supported species whitelist
// ─────────────────────────────────────────────
const SUPPORTED_SPECIES = ['dog', 'cat', 'rabbit', 'hamster', 'bird', 'turtle'];

const SPECIES_NAMES_ZH = {
  dog: '狗', cat: '猫', rabbit: '兔子',
  hamster: '仓鼠', bird: '鸟', turtle: '乌龟'
};

// ─────────────────────────────────────────────
// Claude prompt: Step 1 — Trait extraction
// ─────────────────────────────────────────────
function buildTraitPrompt(petName, petDesc) {
  return `You are a pet trait extractor for a virtual pet app. Analyze the photo and/or description carefully.

Pet name: "${petName}"
${petDesc ? `Owner description: ${petDesc}` : ''}

Your job has TWO parts:

PART A — Species validation:
Determine if the pet belongs to one of these 6 supported species: dog, cat, rabbit, hamster, bird, turtle.
If it does NOT belong to any of these 6, set "supported": false and stop.
If the photo is not an animal at all, set "supported": false and stop.
If the photo is unclear/blurry, still try your best but set "confidence" lower.

PART B — Trait extraction (only if supported):
Extract detailed traits for future avatar system migration.

Respond ONLY with valid JSON, no markdown, no explanation:

{
  "supported": true,
  "species": "dog",
  "breed": "shiba_inu",
  "breed_display": "柴犬",
  "confidence": 0.92,
  "morphology": {
    "ear_type": "pointy",
    "ear_size": "medium",
    "tail_type": "curly",
    "tail_length": "medium",
    "body_size": "small",
    "snout_length": "medium",
    "face_shape": "round"
  },
  "appearance": {
    "fur_color_primary": "brown",
    "fur_color_secondary": "white",
    "fur_color_accent": null,
    "fur_pattern": "saddle",
    "fur_length": "short",
    "eye_color": "brown",
    "nose_color": "black"
  },
  "personality_hints": ["energetic", "loyal", "playful"],
  "description_zh": "棕白色柴犬，卷尾立耳，短毛，眼神灵动",
  "description_en": "Shiba Inu with brown and white fur, curly tail, pointed ears, short coat"
}

If not supported, respond:
{
  "supported": false,
  "reason": "unsupported_species",
  "detected": "what you saw (e.g. 'lizard', 'not an animal')",
  "message_zh": "抱歉，目前只支持狗、猫、兔子、仓鼠、鸟和乌龟六种宠物 🐾"
}`;
}

// ─────────────────────────────────────────────
// Build Zootopia-style prompt from traits
// ─────────────────────────────────────────────
function buildAvatarPrompt(traits, petName) {
  const { species, breed_display, appearance, morphology, description_en } = traits;

  const POSE = [
    'standing upright on two legs like a human',
    'Zootopia Disney animation style',
    '2D cartoon anthropomorphic character',
    'full body visible',
    'centered in frame',
    'pure white background #FFFFFF',
    'facing directly toward camera',
    'arms at sides',
    'friendly expression',
    'clean studio lighting'
  ].join(', ');

  const furDesc = [
    appearance.fur_color_primary,
    appearance.fur_color_secondary ? `and ${appearance.fur_color_secondary}` : '',
    appearance.fur_pattern !== 'solid' ? `${appearance.fur_pattern} pattern` : '',
    `${appearance.fur_length} fur`
  ].filter(Boolean).join(' ');

  const morphDesc = [
    morphology.ear_type === 'pointy' ? 'pointed upright ears' :
    morphology.ear_type === 'floppy' ? 'floppy drooping ears' :
    morphology.ear_type === 'round'  ? 'small round ears' : 'ears',
    morphology.tail_type === 'curly' ? 'curled tail' :
    morphology.tail_type === 'long'  ? 'long flowing tail' :
    morphology.tail_type === 'short' ? 'short stubby tail' :
    morphology.tail_type === 'none'  ? 'no tail' : 'tail'
  ].join(', ');

  return `anthropomorphic ${species} character, ${breed_display || description_en}, ${furDesc}, ${morphDesc}, ${POSE}, high quality illustration, 4k`;
}

// ─────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────
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
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  const { imageBase64, mediaType, petName, petDesc, style, pollId, userToken } = body;

  // ── Poll mode ──────────────────────────────
  if (pollId) {
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
      return new Response(JSON.stringify({ status: 'failed', error: pollData.error || '生成失败' }), { status: 500 });
    }
    return new Response(JSON.stringify({ status: 'pending' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  // ── Generate mode ──────────────────────────
  if (!petName) {
    return new Response(JSON.stringify({ error: 'Missing petName' }), { status: 400 });
  }

  // ── Step 1: Claude extracts traits ─────────
  const contentParts = [];
  if (imageBase64 && mediaType) {
    contentParts.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } });
  }
  contentParts.push({ type: 'text', text: buildTraitPrompt(petName, petDesc) });

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: contentParts }]
    })
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.json();
    return new Response(JSON.stringify({ error: 'Claude error: ' + (err.error?.message || claudeRes.status) }), { status: 500 });
  }

  const claudeData = await claudeRes.json();
  let claudeText = claudeData.content[0].text.trim();

  // Strip markdown code fences if present
  claudeText = claudeText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

  let traits;
  try {
    traits = JSON.parse(claudeText);
  } catch {
    return new Response(JSON.stringify({ error: '特征识别失败，请重试' }), { status: 500 });
  }

  // ── Species validation ──────────────────────
  if (!traits.supported) {
    return new Response(JSON.stringify({
      error: 'unsupported_species',
      detected: traits.detected || 'unknown',
      message: traits.message_zh || '抱歉，目前只支持狗、猫、兔子、仓鼠、鸟和乌龟六种宠物 🐾'
    }), { status: 422 });
  }

  // Double-check species against whitelist
  if (!SUPPORTED_SPECIES.includes(traits.species)) {
    return new Response(JSON.stringify({
      error: 'unsupported_species',
      detected: traits.species,
      message: '抱歉，目前只支持狗、猫、兔子、仓鼠、鸟和乌龟六种宠物 🐾'
    }), { status: 422 });
  }

  // ── Step 2: Build avatar prompt from traits ─
  const fullPrompt = buildAvatarPrompt(traits, petName);

  // Save traits + prompt for future migration
  const avatarTraits = {
    schema_version: '1.0',
    avatar_version: 'ai_v1',
    species:        traits.species,
    breed:          traits.breed,
    breed_display:  traits.breed_display,
    confidence:     traits.confidence,
    morphology:     traits.morphology,
    appearance:     traits.appearance,
    personality_hints: traits.personality_hints || [],
    generation: {
      generated_prompt: fullPrompt,
      model:            'flux-dev',
      style:            style || 'zootopia',
      generated_at:     new Date().toISOString()
    }
  };

  // ── Step 3: Start Replicate prediction ──────
  const replicateRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + REPLICATE_KEY,
    },
    body: JSON.stringify({
      input: {
        prompt:               fullPrompt,
        num_outputs:          1,
        aspect_ratio:         '2:3',
        output_format:        'webp',
        output_quality:       85,
        num_inference_steps:  28,
        guidance:             3.5
      }
    })
  });

  if (!replicateRes.ok) {
    const err = await replicateRes.json();
    return new Response(JSON.stringify({ error: 'Replicate error: ' + (err.detail || JSON.stringify(err)) }), { status: 500 });
  }

  const replicateData = await replicateRes.json();

  // If already done (sync mode)
  if (replicateData.output?.[0]) {
    const tempUrl      = replicateData.output[0];
    const permanentUrl = await uploadToStorage(tempUrl, SUPABASE_URL, SUPABASE_KEY, userToken);
    return new Response(JSON.stringify({
      status:       'done',
      imageUrl:     permanentUrl || tempUrl,
      description:  traits.description_zh,
      avatarTraits  // return to frontend so pet.js can save it
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Async polling mode
  return new Response(JSON.stringify({
    status:       'pending',
    predictionId: replicateData.id,
    description:  traits.description_zh,
    avatarTraits  // return early so frontend can save with pet record
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ─────────────────────────────────────────────
// Upload to Supabase Storage
// ─────────────────────────────────────────────
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
  } catch {
    return null;
  }
}
