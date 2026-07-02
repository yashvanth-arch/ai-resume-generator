// api/credits.js
//
// GET /api/credits
// Verifies the caller's Firebase ID token, applies the lazy daily refill
// (creating the user's Firestore doc with 5 starting credits on first
// call), and returns their current balance. Never mutates via deduction —
// only /api/generate spends credits.

import { requireAuth } from './_lib/auth.js';
import { getCredits } from './_lib/credits.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  let decoded;
  try {
    decoded = await requireAuth(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message });
  }

  try {
    const credits = await getCredits(decoded.uid, {
      email: decoded.email,
      name: decoded.name
    });
    return res.status(200).json({ credits });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load credits: ' + err.message });
  }
}