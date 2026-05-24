export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const TOGETHER_KEY = process.env.TOGETHER_API_KEY;

  if (!ANTHROPIC_KEY || !TOGETHER_KEY) {
    return new Response(JSON.stringify({ error: 'API keys not configured on server' }), { status: 500 });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  const { imageBase64, mediaType, petName, style } = body;
  if (!imageBase64 || !mediaType || !petName || !style) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  const styleNames = { chibi: 'Q版萌系', pixel: '像素风', watercolor: '水彩插画' };
  const stylePrompts = {
    chibi: 'chibi anime style, big round eyes, cute chubby proportions, soft pastel colors, kawaii illustration, white background',
    pixel: '16-bit pixel art style, retro video game sprite, bright colors, pixelated, clean pixel grid, white background',
    watercolor: 'soft watercolor illustration, dreamy artistic style, gentle color washes, painterly texture, white background'
  };

  // Step 1: Claude analyzes photo
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
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: `这是一张宠物照片，宠物名字叫"${petName}"。请用中文简短描述这只宠物的外貌特征（颜色、毛发、体型、表情、品种等），2-3句话。同时用英文输出AI图片生成提示词，描述这只宠物的卡通版本，风格为${styleNames[style] || style}。格式：\n中文描述：[描述]\nImage prompt: [英文prompt]` }
        ]
      }]
    })
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.json();
    return new Response(JSON.stringify({ error: 'Claude error: ' + (err.error?.message || claudeRes.status) }), { status: 500 });
  }

  const claudeData = await claudeRes.json();
  const claudeText = claudeData.content[0].text;
  const chineseDesc = claudeText.match(/中文描述[：:]\s*(.+?)(?:\n|Image)/s)?.[1]?.trim() || claudeText;
  const imgPromptMatch = claudeText.match(/Image prompt[：:]\s*(.+)/si);
  const imgPrompt = imgPromptMatch ? imgPromptMatch[1].trim() : `cute cartoon ${petName}, adorable pet`;
  const fullPrompt = `${imgPrompt}, ${stylePrompts[style] || stylePrompts.chibi}, high quality`;

  // Step 2: Together AI generates image
  const togetherRes = await fetch('https://api.together.xyz/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + TOGETHER_KEY
    },
    body: JSON.stringify({
      model: 'black-forest-labs/FLUX.1-schnell-Free',
      prompt: fullPrompt,
      width: 512,
      height: 512,
      steps: 4,
      n: 1
    })
  });

  if (!togetherRes.ok) {
    const err = await togetherRes.json();
    return new Response(JSON.stringify({ error: 'Together AI error: ' + (err.error?.message || togetherRes.status) }), { status: 500 });
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
