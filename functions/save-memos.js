export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const { GITHUB_TOKEN, REPO_OWNER = 'zpens', REPO_NAME = 'inZoiMapList' } = context.env;
  const FILE_PATH = 'data/memos.json';
  const BRANCH = 'master';

  if (!GITHUB_TOKEN) {
    return Response.json({ error: 'GitHub token not configured' }, { status: 500 });
  }

  try {
    const memos = await context.request.json();

    // Get current file SHA
    const getRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}?ref=${BRANCH}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'inzoi-map-editor' } }
    );

    let sha = null;
    if (getRes.ok) {
      const current = await getRes.json();
      sha = current.sha;
    }

    // Commit updated memos
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(memos, null, 2))));
    const body = {
      message: `Update memos (${new Date().toISOString().slice(0, 16)})`,
      content,
      branch: BRANCH,
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'inzoi-map-editor',
        },
        body: JSON.stringify(body),
      }
    );

    if (!putRes.ok) {
      const err = await putRes.text();
      return Response.json({ error: err }, { status: putRes.status });
    }

    return Response.json({ success: true, message: 'Memos saved' });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
