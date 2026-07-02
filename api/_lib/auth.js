// api/_lib/auth.js
//
// Verifies the Firebase ID token sent by the browser in the
// `Authorization: Bearer <token>` header. This is how we know which user
// (uid) a request belongs to, without trusting anything the client claims
// about itself.

import { getAdminAuth } from './firebaseAdmin.js';

export async function requireAuth(req) {
  const header = req.headers.authorization || req.headers.Authorization;

  if (!header || !header.startsWith('Bearer ')) {
    const err = new Error('You must be signed in to do this.');
    err.status = 401;
    throw err;
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    const err = new Error('You must be signed in to do this.');
    err.status = 401;
    throw err;
  }

  try {
    // decoded includes: uid, email, name, picture, etc.
    return await getAdminAuth().verifyIdToken(token);
  } catch (e) {
    const err = new Error('Your session has expired. Please sign in again.');
    err.status = 401;
    throw err;
  }
}
