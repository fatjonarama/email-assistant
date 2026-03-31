export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/?error=access_denied');
  }

  if (!code) {
    return res.redirect('/?error=no_code');
  }

  try {
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

    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const userData = await userResponse.json();
    const userEmail = userData.email || 'Unknown';
    const userName = userData.name || userEmail;

    // Krijo Gmail labels automatikisht
    const gmailLabels = ['needs_reply', 'FYI', 'junk'];
    for (const labelName of gmailLabels) {
      await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: labelName })
      }).catch(() => {});
    }

    const notionBody = {
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        Name: {
          title: [{ text: { content: userName } }]
        },
        Email: {
          email: userEmail
        },
        'Refresh Token': {
          rich_text: [{ text: { content: refresh_token || 'no_refresh_token' } }]
        },
        'Connected At': {
          date: { start: new Date().toISOString() }
        },
        Status: {
          select: { name: 'In progress' }  // ← NDRYSHUAR
        }
      }
    };

    const notionResponse = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(notionBody)
    });

    const notionData = await notionResponse.json();
    console.log('Notion response:', JSON.stringify(notionData));

    if (!notionData.id) {
      console.error('Notion error:', notionData);
      return res.redirect('/?error=notion_failed');
    }

    return res.redirect('/?success=true');  // ← FSHIRË webhook trigger

  } catch (err) {
    console.error('Error:', err);
    return res.redirect('/?error=server_error');
  }
}