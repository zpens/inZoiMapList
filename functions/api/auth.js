// 비밀번호 인증 API
const PASSWORD = '$worldteam';
const SALT = 'inzoi_map_2025';

async function generateToken() {
  const data = new TextEncoder().encode(PASSWORD + SALT);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// POST: 비밀번호 확인 → 토큰 발급
export async function onRequestPost(context) {
  try {
    const { password } = await context.request.json();
    if (password === PASSWORD) {
      const token = await generateToken();
      return new Response(JSON.stringify({ ok: true, token }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ ok: false, error: '비밀번호가 틀렸습니다.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Bad request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// GET: 토큰 검증
export async function onRequestGet(context) {
  const token = context.request.headers.get('X-Auth-Token');
  const expected = await generateToken();
  if (token === expected) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ ok: false }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}
