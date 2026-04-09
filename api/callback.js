import { checkRateLimit } from './middleware.js';

export default async function handler(req, res) {
  // Rate limit — max 10 requests per 15 min per IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).send('Too many requests. Please try again later.');
  }

  const { code, error } = req.query;

  if (error) return res.redirect('/?error=access_denied');
  if (!code) return res.redirect('/?error=no_code');

  try {
    // Step 1: Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
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

    if (!refresh_token) {
      console.error('No refresh_token received');
      return res.redirect('/?error=no_refresh_token');
    }

    // Step 2: Get user info
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const userData = await userResponse.json();
    const userEmail = userData.email || 'Unknown';
    const userName = userData.name || userEmail;

    // Step 3: Create Gmail labels
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

    // Step 4: Check if employee already exists in Notion
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
            email: { equals: userEmail }
          },
          page_size: 1
        })
      }
    );

    const queryData = await queryResponse.json();
    const existingPage = queryData.results?.[0];

    if (existingPage) {
      // UPDATE — user reconnected
      await fetch(`https://api.notion.com/v1/pages/${existingPage.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          properties: {
            'Refresh Token': {
              rich_text: [{ text: { content: refresh_token } }]
            },
            'Connected At': {
              date: { start: new Date().toISOString() }
            },
            Status: {
              select: { name: 'In progress' }
            }
          }
        })
      });
    } else {
      // CREATE — new user
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
              rich_text: [{ text: { content: refresh_token } }]
            },
            'Connected At': {
              date: { start: new Date().toISOString() }
            },
            Status: {
              select: { name: 'In progress' }
            }
          }
        })
      });

      const notionData = await notionResponse.json();
      if (!notionData.id) {
        console.error('Notion error:', notionData);
        return res.redirect('/?error=notion_failed');
      }
    }

    return res.redirect('/?success=true');

  } catch (err) {
    console.error('Error:', err);
    return res.redirect('/?error=server_error');
  }
}