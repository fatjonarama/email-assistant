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

    // Hapi 2: Krijo Gmail credential në n8n
    const credentialResponse = await fetch(`${process.env.N8N_URL}/api/v1/credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': process.env.N8N_API_KEY
      },
     body: JSON.stringify({
  name: `Gmail - ${Date.now()}`,
  type: 'gmailOAuth2',
  data: {
    useDynamicClientRegistration: false,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    oauthTokenData: JSON.stringify({
      access_token: access_token,
      refresh_token: refresh_token,
      scope: 'https://www.googleapis.com/auth/gmail.modify',
      token_type: 'Bearer',
      expiry_date: Date.now() + 3600000
    })
  }
})
    });

    const credentialData = await credentialResponse.json();
    console.log('Credential created:', credentialData);

    if (!credentialData.id) {
      console.error('Credential error:', credentialData);
      return res.redirect('/?error=credential_failed');
    }

    const credentialId = credentialData.id;

    // Hapi 3: Merr workflow-in Fixer
    const workflowResponse = await fetch(`${process.env.N8N_URL}/api/v1/workflows/${process.env.N8N_WORKFLOW_ID}`, {
      headers: {
        'X-N8N-API-KEY': process.env.N8N_API_KEY
      }
    });

    const workflowData = await workflowResponse.json();

    // Hapi 4: Dupliko workflow-in
    const newWorkflow = {
      ...workflowData,
      name: `Fixer - ${Date.now()}`,
      active: false
    };

    delete newWorkflow.id;
    delete newWorkflow.createdAt;
    delete newWorkflow.updatedAt;

    const createResponse = await fetch(`${process.env.N8N_URL}/api/v1/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': process.env.N8N_API_KEY
      },
      body: JSON.stringify(newWorkflow)
    });

    const newWorkflowData = await createResponse.json();
    console.log('Workflow created:', newWorkflowData.id);

    if (!newWorkflowData.id) {
      console.error('Workflow error:', newWorkflowData);
      return res.redirect('/?error=workflow_failed');
    }

    // Hapi 5: Aktivizo workflow-in e ri
    await fetch(`${process.env.N8N_URL}/api/v1/workflows/${newWorkflowData.id}/activate`, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': process.env.N8N_API_KEY
      }
    });

    // Hapi 6: Ridrejto te success page
    return res.redirect('/?success=true');

  } catch (err) {
    console.error('Error:', err);
    return res.redirect('/?error=server_error');
  }
}