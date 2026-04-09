export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'No email provided' });

  try {
    // Step 1: Get refresh token from Notion
    const queryResponse = await fetch(
      `https://api.notion.com/v1/databases/${process.env.NOTION_DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          filter: {
            property: 'Email',
            email: { equals: email }
          },
          page_size: 1
        })
      }
    );

    const queryData = await queryResponse.json();
    const page = queryData.results?.[0];

    if (!page) {
      return res.status(404).json({ error: 'User not found' });
    }

    const refresh_token = page.properties['Refresh Token']?.rich_text?.[0]?.plain_text;

    // Step 2: Revoke token from Google
    if (refresh_token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${refresh_token}`, {
        method: 'POST'
      }).catch(() => {});
    }

    // Step 3: Update Notion status to disconnected
    await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        properties: {
          Status: { select: { name: 'Disconnected' } },
          'Refresh Token': { rich_text: [{ text: { content: '' } }] }
        }
      })
    });

    // Step 4: Clear cookie
    res.setHeader('Set-Cookie', 'mailmind_user=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Disconnect error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}