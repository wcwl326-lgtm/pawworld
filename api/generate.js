export const config = { runtime: 'edge', maxDuration: 60 };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const REPLICATE_KEY = process.env.REPLICATE_API_KEY;

  if (!ANTHROPIC_KEY || !REPLICATE_KEY) {
    return new Response(JSON.stringify({ error: 'API keys not configured' }), { status: 500 });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  const { imageBase64, mediaType, petName, petDesc, style } = body;
  if (!petName || !style) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  const styleNames = { chibi: 'Q版萌系卡通', pixel: '16位像素游戏风格', watercolor: '水彩插画风格' };
  const stylePrompts = {
    chibi: 'chibi anime style, big round eyes, cute chubby proportions, soft pastel colors, kawaii illustration, white background',
    pixel: '16-bit pixel art style, retro video game sprite, bright colors, pixelated, clean pixel grid, white background',
    watercolor: 'soft watercolor illustration, dreamy artistic style, gentle color washes, painterly texture, white background'
  };

  // Step 1: Claude analyzes photo and/or description
  const contentParts = [];
  if (imageBase64 && mediaType) {
    contentParts.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } });
  }
  let textPrompt = `宠物名字叫"${petName}"。`;
  if (petDesc) textPrompt += `主人描述：${petDesc}。`;
  if (imageBase64) textPrompt += `请结合照片和描述，`;
  else textPrompt += `请根据描述，`;
  textPrompt += `用中文2-3句话描述这只宠物的外貌特征，然后用英文写一段适合AI图片生成的提示词，将这只宠物画成${styleNames[style]}风格的卡通形象。格式：\n中文描述：[描述]\nImage prompt: [英文prompt]`;
  contentParts.push({ type: 'text', text: textPrompt });

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: contentParts }]
    })
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.json();
    return new Response(JSON.stringify({ error: 'Claude error: ' + (err.error?.message || claudeRes.status) }), { status: 500 });
  }

  const claudeData = await claudeRes.json();
  const claudeText = claudeData.content[0].text;
  const chineseDesc = claudeText.match(/中文描述[：:]\s*(.+?)(?:\n|Image)/s)?.[1]?.trim() || claudeText.slice(0, 150);
  const imgPromptMatch = claudeText.match(/Image prompt[：:]\s*(.+)/si);
  const imgPrompt = imgPromptMatch ? imgPromptMatch[1].trim() : `cute cartoon ${petName}, adorable pet`;
  const fullPrompt = `${imgPrompt}, ${stylePrompts[style] || stylePrompts.chibi}, high quality, detailed`;

  // Step 2: Replicate sync prediction
  const replicateRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + REPLICATE_KEY,
      'Prefer': 'wait'
    },
    body: JSON.stringify({
      input: {
        prompt: fullPrompt,
        num_outputs: 1,
        aspect_ratio: '1:1',
        output_format: 'webp',
        output_quality: 80,
        num_inference_steps: 4
      }
    })
  });

  if (!replicateRes.ok) {
    const err = await replicateRes.json();
    return new Response(JSON.stringify({ error: 'Replicate error: ' + (err.detail || JSON.stringify(err)) }), { status: 500 });
  }

  const replicateData = await replicateRes.json();
  let imageUrl = replicateData.output?.[0];

  if (!imageUrl && replicateData.urls?.get) {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(replicateData.urls.get, {
        headers: { 'Authorization': 'Bearer ' + REPLICATE_KEY }
      });
      const pollData = await pollRes.json();
      if (pollData.status === 'succeeded') { imageUrl = pollData.output?.[0]; break; }
      if (pollData.status === 'failed') {
        return new Response(JSON.stringify({ error: '图片生成失败：' + (pollData.error || '未知错误') }), { status: 500 });
      }
    }
  }

  if (!imageUrl) {
    return new Response(JSON.stringify({ error: '图片生成超时，请重试' }), { status: 500 });
  }

  return new Response(JSON.stringify({ imageUrl, description: chineseDesc }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
