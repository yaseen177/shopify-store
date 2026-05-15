/**
 * THE EYE CENTRE — Prescription Auto-Save
 * Netlify Function: save-prescription.js
 *
 * Deployed at: /.netlify/functions/save-prescription
 * Called directly from the storefront snippet (no App Proxy needed).
 *
 * ENVIRONMENT VARIABLES (set in Netlify → Site configuration → Environment variables):
 *   SHOPIFY_STORE_DOMAIN   e.g.  the-eye-centre.myshopify.com
 *   SHOPIFY_CUSTOM_DOMAIN  e.g.  www.theeyecentre.com  (your real domain — add if different)
 *   SHOPIFY_ADMIN_TOKEN    Client Secret from Dev Dashboard → Settings → Credentials
 *
 * REQUEST (POST, JSON body):
 *   {
 *     customer_id  : "7123456789012",
 *     prescription : { ... }
 *   }
 *
 * RESPONSE:
 *   { ok: true }   or   { ok: false, error: "..." }
 */

const SHOPIFY_API_VERSION = '2024-01';

/* ── Fetch existing prescriptions metafield ──────────────────────────────── */
async function getExistingPrescriptions(customerId, domain, token) {
  const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/customers/${customerId}/metafields.json?namespace=eyecentre&key=prescriptions`;
  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);
  const data = await res.json();
  const metafield = data.metafields?.[0];
  if (!metafield) return { existing: [], metafieldId: null };
  let existing = [];
  try { existing = JSON.parse(metafield.value); } catch (e) {}
  return { existing: Array.isArray(existing) ? existing : [], metafieldId: metafield.id };
}

/* ── Write prescriptions back to the metafield ───────────────────────────── */
async function savePrescriptions(customerId, prescriptions, metafieldId, domain, token) {
  const body = metafieldId
    ? { metafield: { id: metafieldId, value: JSON.stringify(prescriptions), type: 'json' } }
    : { metafield: { namespace: 'eyecentre', key: 'prescriptions', value: JSON.stringify(prescriptions), type: 'json' } };

  const url = metafieldId
    ? `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/metafields/${metafieldId}.json`
    : `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/customers/${customerId}/metafields.json`;

  const res = await fetch(url, {
    method: metafieldId ? 'PUT' : 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Shopify write error: ${res.status} — ${err}`);
  }
}

/* ── Main handler ─────────────────────────────────────────────────────────── */
exports.handler = async function (event) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const customDomain = process.env.SHOPIFY_CUSTOM_DOMAIN;

  /* CORS — accept requests from your store's myshopify domain AND custom domain */
  const allowedOrigins = [
    domain        ? `https://${domain}` : null,
    customDomain  ? `https://${customDomain}` : null,
  ].filter(Boolean);

  const requestOrigin = event.headers.origin || event.headers.Origin || '';
  const allowOrigin = allowedOrigins.find(o => o === requestOrigin) || allowedOrigins[0] || '*';

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  /* Handle browser pre-flight request */
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  /* Only accept POST */
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  try {
    const { customer_id, prescription } = JSON.parse(event.body || '{}');

    if (!customer_id || !prescription) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Missing customer_id or prescription' }) };
    }

    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!domain || !token) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'Server not configured — check environment variables' }) };
    }

    /* Load existing prescriptions and append / update */
    const { existing, metafieldId } = await getExistingPrescriptions(customer_id, domain, token);

    const existingIndex = existing.findIndex(rx => rx.id === prescription.id);
    let updated;
    if (existingIndex >= 0) {
      updated = [...existing];
      updated[existingIndex] = prescription;   /* update in place — no duplicates */
    } else {
      updated = [...existing, prescription];   /* new record */
    }

    await savePrescriptions(customer_id, updated, metafieldId, domain, token);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, count: updated.length }),
    };

  } catch (err) {
    console.error('save-prescription error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};