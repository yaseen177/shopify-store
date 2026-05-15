exports.handler = async function(event) {
  try {
    const { code, shop } = JSON.parse(event.body || '{}');
    
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'ffab0297a93ed82b44faceb6dee8b95e',
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
        code: code
      })
    });
    
    const text = await response.text();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: text
    };
  } catch(err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
