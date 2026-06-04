// Edge runtime - Claude analysis only (~3-5s, safe for edge)
export const config = { runtime: 'edge' };

const SUPPORTED_SPECIES = ['dog', 'cat', 'rabbit', 'hamster', 'bird', 'turtle'];

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500 });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
  }

  const { imageBase64, mediaType, petName } = body;
  if (!imageBase64 || !petName) {
    return new Response(JSON.stringify({ error: '缺少必要参数' }), { status: 400 });
  }

  const prompt = `You are a pet trait extractor for a virtual pet app.

Pet name: "${petName}"

Look at this photo and:
1. Check if it's one of: dog, cat, rabbit, hamster, bird, turtle
2. If NOT → set "supported": false
3. If YES → extract traits

Reply ONLY with valid JSON, no markdown, no explanation:

Supported example:
{"supported":true,"species":"dog","breed":"golden_retriever","breed_display":"金毛寻回犬","confidence":0.95,"morphology":{"ear_type":"floppy","tail_type":"long","body_size":"large","snout_length":"medium"},"appearance":{"fur_color_primary":"golden","fur_color_secondary":null,"fur_pattern":"solid","fur_length":"long","eye_color":"brown"},"personality_hints":["friendly","energetic"],"description_zh":"金色长毛金毛犬，垂耳长尾","description_en":"Golden Retriever with golden long fur, floppy ears"}

Not supported example:
{"supported":false,"detected":"lizard","message_zh":"抱歉，目前只支持狗、猫、兔子、仓鼠、鸟和乌龟 🐾"}`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    if (!claudeRes.ok) {
      return new Response(JSON.stringify({ error: '特征识别失败，请重试' }), { status: 500 });
    }

    const claudeData = await claudeRes.json();
    let text = claudeData.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    const traits = JSON.parse(text);

    // Validate
    if (!traits.supported) {
      return new Response(JSON.stringify({
        supported: false,
        detected:  traits.detected || 'unknown',
        message:   traits.message_zh || '抱歉，目前只支持狗、猫、兔子、仓鼠、鸟和乌龟 🐾'
      }), { status: 422 });
    }
    if (!SUPPORTED_SPECIES.includes(traits.species)) {
      return new Response(JSON.stringify({
        supported: false,
        message:   '抱歉，目前只支持狗、猫、兔子、仓鼠、鸟和乌龟 🐾'
      }), { status: 422 });
    }

    return new Response(JSON.stringify({ supported: true, traits }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch {
    return new Response(JSON.stringify({ error: '特征识别失败，请重试' }), { status: 500 });
  }
}
