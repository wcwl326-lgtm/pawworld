export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
  }

  const { petName, hoursAway, hunger, energy, mood } = body;

  const urgency = hoursAway > 48 ? 'very sad and desperate' : hoursAway > 24 ? 'sad and missing owner' : 'a little lonely';
  const systemPrompt = `You are ${petName}, a cute pet. Your owner has been away for ${hoursAway} hours. You feel ${urgency}. 
Status: hunger ${hunger}/100, energy ${energy}/100, mood ${mood}/100.
Write a short, emotional message in Chinese (2-3 sentences) to your owner, expressing how much you miss them. 
Be cute, emotional, and use relevant emojis. Make the owner want to come back immediately.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{ role: 'user', content: systemPrompt }]
    })
  });

  if (!res.ok) {
    const err = await res.json();
    return new Response(JSON.stringify({ error: err.error?.message }), { status: 500 });
  }

  const data = await res.json();
  return new Response(JSON.stringify({ message: data.content[0].text }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
