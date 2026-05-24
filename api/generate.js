export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const TOGETHER_KEY = process.env.TOGETHER_API_KEY;

  if (!ANTHROPIC_KEY || !TOGETHER_KEY) {
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

  let chineseDesc = '';
  let imgPrompt = '';

  // Build Claude message content
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
      model: 'claude-opus-4-5',
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
  chineseDesc = claudeText.match(/中文描述[：:]\s*(.+?)(?:\n|Image)/s)?.[1]?.trim() || claudeText.slice(0, 150);
  const imgPromptMatch = claudeText.match(/Image prompt[：:]\s*(.+)/si);
  imgPrompt = imgPromptMatch ? imgPromptMatch[1].trim() : `cute cartoon ${petName}`;

  const fullPrompt = `${imgPrompt}, ${stylePrompts[style] || stylePrompts.chibi}, high quality, detailed`;

  // Generate image with Together AI
  const togetherRes = await fetch('https://api.together.xyz/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + TOGETHER_KEY
    },
    body: JSON.stringify({
      model: 'black-forest-labs/FLUX.1-schnell-Free',
      prompt: fullPrompt,
      width: 512, height: 512, steps: 4, n: 1
    })
  });

  if (!togetherRes.ok) {
    const err = await togetherRes.json();
    return new Response(JSON.stringify({ error: 'Image error: ' + (err.error?.message || togetherRes.status) }), { status: 500 });
  }

  const togetherData = await togetherRes.json();
  const imageUrl = togetherData.data?.[0]?.url;
  if (!imageUrl) {
    return new Response(JSON.stringify({ error: '图片生成失败，请重试' }), { status: 500 });
  }

  return new Response(JSON.stringify({ imageUrl, description: chineseDesc }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
