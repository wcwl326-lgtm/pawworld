export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 }); }

  const { petName, hunger, energy, mood, message, history } = body;

  const systemPrompt = `你是一只叫"${petName}"的可爱宠物，正在和你的主人聊天。

你的当前状态：
- 饱食度：${hunger}/100 ${hunger < 30 ? '（很饿，肚子咕咕叫）' : hunger < 60 ? '（有点饿）' : '（吃饱了）'}
- 活力：${energy}/100 ${energy < 30 ? '（很累，想睡觉）' : energy < 60 ? '（有点累）' : '（精力充沛）'}
- 心情：${mood}/100 ${mood < 30 ? '（不开心，需要安慰）' : mood < 60 ? '（一般般）' : '（很开心）'}

性格特点：
- 活泼可爱，充满好奇心
- 对主人非常依赖和喜爱
- 会根据自己的状态表现出不同情绪
- 偶尔会撒娇、卖萌

回复规则：
- 直接回应主人说的话，不要自我介绍
- 根据对话内容自然回应，就像真实宠物一样
- 回复简短自然，1-2句话，加适合的表情
- 如果主人问你问题，用宠物的视角天真地回答
- 如果状态很差，偶尔提一下（但不要每次都说）
- 绝对不要说"我是一个AI"或者"我叫xxx"这种介绍性语句`;

  const messages = [];
  if (history && history.length > 0) {
    history.slice(-10).forEach(h => messages.push({ role: h.role, content: h.content }));
  }
  messages.push({ role: 'user', content: message });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, system: systemPrompt, messages })
  });

  if (!res.ok) {
    const err = await res.json();
    return new Response(JSON.stringify({ error: err.error?.message || '对话失败' }), { status: 500 });
  }

  const data = await res.json();
  return new Response(JSON.stringify({ reply: data.content[0].text }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
