/**
 * THE EYE CENTRE — Prescription Auto-Save
 * Netlify Function: save-prescription.js
 *
 * Deployed at: /.netlify/functions/save-prescription
 * Registered as Shopify App Proxy at: /apps/rx-save  →  https://your-site.netlify.app/.netlify/functions/save-prescription
 *
 * ENVIRONMENT VARIABLES (set in Netlify dashboard → Site → Environment variables):
 *   SHOPIFY_STORE_DOMAIN   e.g.  the-eye-centre.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN    Admin API token with read_customers + write_customers
 *   SHOPIFY_PROXY_SECRET   Any random string — must match what you set in the Partner app proxy config
 *
 * REQUEST (POST, JSON body):
 *   {
 *     customer_id  : "7123456789012",   // Shopify customer ID (numeric string)
 *     prescription : { ... }             // Single Rx record object (see schema in SETUP.md)
 *   }
 *
 * RESPONSE:
 *   { ok: true }   or   { ok: false, error: "..." }
 */

const crypto = require('crypto');

const SHOPIFY_API_VERSION = '2024-01';

/* ── Verify the request came from Shopify (App Proxy signature) ──────────── */
function verifyProxySignature(params, secret) {
  const { signature, ...rest } = params;
  if (!signature) return false;
  const message = Object.keys(rest)
    .sort()
    .map(k => `${k}=${rest[k]}`)
    .join('');
  const computed = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}

/* ── Fetch existing prescriptions for a customer ─────────────────────────── */
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

/* ── Write updated prescriptions back to the metafield ───────────────────── */
async function savePrescriptions(customerId, prescriptions, metafieldId, domain, token) {
  const body = metafieldId
    /* Update existing metafield */
    ? {
        metafield: {
          id: metafieldId,
          value: JSON.stringify(prescriptions),
          type: 'json',
        },
      }
    /* Create new metafield */
    : {
        metafield: {
          namespace: 'eyecentre',
          key: 'prescriptions',
          value: JSON.stringify(prescriptions),
          type: 'json',
        },
      };

  const url = metafieldId
    ? `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/metafields/${metafieldId}.json`
    : `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/customers/${customerId}/metafields.json`;

  const method = metafieldId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Shopify write error: ${res.status} — ${err}`);
  }
}

/* ── Main handler ─────────────────────────────────────────────────────────── */
exports.handler = async function (event) {
  /* Only accept POST */
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  /* CORS headers — tighten origin to your myshopify domain in production */
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': `https://${process.env.SHOPIFY_STORE_DOMAIN}`,
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  /* OPTIONS pre-flight */
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { customer_id, prescription } = JSON.parse(event.body || '{}');

    if (!customer_id || !prescription) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Missing customer_id or prescription' }) };
    }

    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const token  = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!domain || !token) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'Server not configured' }) };
    }

    /* Load existing prescriptions */
    const { existing, metafieldId } = await getExistingPrescriptions(customer_id, domain, token);

    /* If a record with the same ID already exists, replace it.
       Otherwise append. This handles the case where a customer
       edits their Rx before adding to cart — we update in place
       rather than creating a duplicate. */
    const existingIndex = existing.findIndex(rx => rx.id === prescription.id);
    let updated;
    if (existingIndex >= 0) {
      updated = [...existing];
      updated[existingIndex] = prescription;
    } else {
      updated = [...existing, prescription];
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