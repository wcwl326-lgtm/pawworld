export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 }); }

  const { petName, hunger, energy, mood, message, history } = body;

  const systemPrompt = `你是一只叫"${petName}"的可爱宠物。你的当前状态：饱食度${hunger}/100，活力${energy}/100，心情${mood}/100。
根据你的状态来回应主人：饱食度低时想吃东西，活力低时想休息，心情低时需要安慰。
用可爱活泼的语气回复，1-2句话，加上适合的表情符号。不要说你是AI。`;

  const messages = [];
  if (history && history.length > 0) {
    history.slice(-6).forEach(h => messages.push({ role: h.role, content: h.content }));
  }
  messages.push({ role: 'user', content: message });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, system: systemPrompt, messages })
  });

  if (!res.ok) {
    const err = await res.json();
    return new Response(JSON.stringify({ error: err.error?.message || '对话失败' }), { status: 500 });
  }

  const data = await res.json();
  return new Response(JSON.stringify({ reply: data.content[0].text }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
