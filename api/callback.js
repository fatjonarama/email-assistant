export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/?error=access_denied');
  }

  if (!code) {
    return res.redirect('/?error=no_code');
  }

  try {
    // Hapi 1: Shkëmbe code me token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      console.error('Token error:', tokenData);
      return res.redirect('/?error=token_failed');
    }

    const { access_token, refresh_token } = tokenData;

    // Merr email-in e punonjësit
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const userData = await userResponse.json();
    const userEmail = userData.email || 'Unknown';
    const userName = userData.name || userEmail;

    // Hapi 2: Ruaj te Notion
    const notionResponse = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
          Name: {
            title: [{ text: { content: userName } }]
          },
          Email: {
            email: userEmail
          },
          'Refresh Token': {
            rich_text: [{ text: { content: refresh_token || '' } }]
          },
          'Connected At': {
            date: { start: new Date().toISOString() }
          },
          Status: {
            select: { name: 'Pending' }
          }
        }
      })
    });

    const notionData = await notionResponse.json();
    console.log('Notion saved:', notionData.id);

    if (!notionData.id) {
      console.error('Notion error:', notionData);
      return res.redirect('/?error=notion_failed');
    }

    return res.redirect('/?success=true');

  } catch (err) {
    console.error('Error:', err);
    return res.redirect('/?error=server_error');
  }
}