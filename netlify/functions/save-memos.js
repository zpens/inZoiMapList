exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO_OWNER = process.env.REPO_OWNER || 'zpens';
  const REPO_NAME = process.env.REPO_NAME || 'inZoiMapList';
  const FILE_PATH = 'data/memos.json';
  const BRANCH = 'master';

  if (!GITHUB_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'GitHub token not configured' }) };
  }

  try {
    const memos = JSON.parse(event.body);

    // Get current file SHA (required for update)
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
    const content = Buffer.from(JSON.stringify(memos, null, 2)).toString('base64');
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
      return { statusCode: putRes.status, body: JSON.stringify({ error: err }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Memos saved' }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
