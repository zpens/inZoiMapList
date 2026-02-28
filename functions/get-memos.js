export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const { GITHUB_TOKEN, REPO_OWNER = 'zpens', REPO_NAME = 'inZoiMapList' } = context.env;
  const FILE_PATH = 'data/memos.json';
  const BRANCH = 'master';

  if (!GITHUB_TOKEN) {
    return Response.json({ error: 'GitHub token not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}?ref=${BRANCH}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'inzoi-map-editor' } }
    );

    if (!res.ok) {
      return Response.json({ Gangnam: [], RedCity: [], Cahaya: [] }, {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await res.json();
    const content = atob(data.content.replace(/\n/g, ''));
    const decoded = new TextDecoder().decode(Uint8Array.from(content, c => c.charCodeAt(0)));

    return new Response(decoded, {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
