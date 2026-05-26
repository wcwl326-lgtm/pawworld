export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const REPLICATE_KEY = process.env.REPLICATE_API_KEY;
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!ANTHROPIC_KEY || !REPLICATE_KEY) {
    return new Response(JSON.stringify({ error: 'API keys not configured' }), { status: 500 });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  const { imageBase64, mediaType, petName, petDesc, style, pollId, userToken } = body;

  // Poll mode: check existing prediction
  if (pollId) {
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${pollId}`, {
      headers: { 'Authorization': 'Bearer ' + REPLICATE_KEY }
    });
    const pollData = await pollRes.json();

    if (pollData.status === 'succeeded') {
      const tempUrl = pollData.output?.[0];
      if (!tempUrl) return new Response(JSON.stringify({ status: 'failed', error: '图片生成失败' }), { status: 500 });

      // Upload to Supabase Storage for permanent URL
      const permanentUrl = await uploadToStorage(tempUrl, SUPABASE_URL, SUPABASE_KEY, userToken);
      return new Response(JSON.stringify({
        status: 'done',
        imageUrl: permanentUrl || tempUrl
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (pollData.status === 'failed') {
      return new Response(JSON.stringify({ status: 'failed', error: pollData.error || '生成失败' }), { status: 500 });
    }
    return new Response(JSON.stringify({ status: 'pending' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Generate mode
  if (!petName || !style) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  const styleNames = {
    pixar: '皮克斯3D动画风格',
    realistic3d: '写实3D渲染风格',
    chibi: 'Q版萌系卡通风格'
  };
  // Fixed pose for accurate accessory layering
  const POSE = 'full body character portrait, facing directly toward camera, entire body fully visible, centered in frame, PURE WHITE BACKGROUND ONLY #FFFFFF, no background scenery, no branches, no environment, white studio backdrop, clean isolated character, white background is mandatory';

  const stylePrompts = {
    pixar: 'Pixar 3D animation style, adorable fluffy character, vibrant expressive eyes, smooth glossy fur, soft studio lighting, ultra detailed 3D render, ' + POSE + ', Disney Pixar quality',
    realistic3d: 'photorealistic 3D render, cute pet character, studio lighting, subsurface scattering fur, high detail, octane render, soft shadows, ' + POSE + ', professional CGI quality',
    chibi: 'chibi 3D render, super cute proportions, big sparkling eyes, smooth rounded shapes, pastel colors, soft lighting, ' + POSE + ', adorable kawaii 3D style'
  };

  // Step 1: Claude analyzes
  const contentParts = [];
  if (imageBase64 && mediaType) {
    contentParts.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } });
  }
  let textPrompt = `宠物名字叫"${petName}"。`;
  if (petDesc) textPrompt += `主人描述：${petDesc}。`;
  if (imageBase64) textPrompt += `请结合照片和描述，`;
  else textPrompt += `请根据描述，`;
  textPrompt += `用中文2-3句话描述这只宠物的外貌特征，然后用英文写一段适合AI图片生成的提示词，将这只宠物渲染成${styleNames[style] || styleNames.pixar}的3D卡通形象。格式：\n中文描述：[描述]\nImage prompt: [英文prompt]`;
  contentParts.push({ type: 'text', text: textPrompt });

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: contentParts }] })
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.json();
    return new Response(JSON.stringify({ error: 'Claude error: ' + (err.error?.message || claudeRes.status) }), { status: 500 });
  }

  const claudeData = await claudeRes.json();
  const claudeText = claudeData.content[0].text;
  const chineseDesc = claudeText.match(/中文描述[：:]\s*(.+?)(?:\n|Image)/s)?.[1]?.trim() || claudeText.slice(0, 150);
  const imgPromptMatch = claudeText.match(/Image prompt[：:]\s*(.+)/si);
  const imgPrompt = imgPromptMatch ? imgPromptMatch[1].trim() : `cute 3D cartoon ${petName}`;
  const fullPrompt = `${imgPrompt}, ${stylePrompts[style] || stylePrompts.pixar}, high quality, 4k`;

  // Step 2: Start Replicate prediction
  const replicateRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + REPLICATE_KEY,
    },
    body: JSON.stringify({
      input: {
        prompt: fullPrompt,
        num_outputs: 1,
        aspect_ratio: '2:3',
        output_format: 'webp',
        output_quality: 85,
        num_inference_steps: 28,
        guidance: 3.5
      }
    })
  });

  if (!replicateRes.ok) {
    const err = await replicateRes.json();
    return new Response(JSON.stringify({ error: 'Replicate error: ' + (err.detail || JSON.stringify(err)) }), { status: 500 });
  }

  const replicateData = await replicateRes.json();

  // If already done (sync), upload immediately
  if (replicateData.output?.[0]) {
    const tempUrl = replicateData.output[0];
    const permanentUrl = await uploadToStorage(tempUrl, SUPABASE_URL, SUPABASE_KEY, userToken);
    return new Response(JSON.stringify({
      status: 'done',
      imageUrl: permanentUrl || tempUrl,
      description: chineseDesc
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    status: 'pending',
    predictionId: replicateData.id,
    description: chineseDesc
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function uploadToStorage(tempUrl, supabaseUrl, supabaseKey, userToken) {
  try {
    // Download image from Replicate
    const imgRes = await fetch(tempUrl);
    if (!imgRes.ok) return null;
    const imgBlob = await imgRes.arrayBuffer();

    // Generate unique filename
    const filename = `pets/${Date.now()}_${Math.random().toString(36).slice(2)}.webp`;

    // Upload to Supabase Storage using service key or anon key
    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/pet-images/${filename}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken || supabaseKey}`,
        'apikey': supabaseKey,
        'Content-Type': 'image/webp',
        'x-upsert': 'true'
      },
      body: imgBlob
    });

    if (!uploadRes.ok) return null;

    // Return permanent public URL
    return `${supabaseUrl}/storage/v1/object/public/pet-images/${filename}`;
  } catch {
    return null;
  }
}
