// api/_lib/firebaseAdmin.js
//
// Shared Firebase Admin SDK initialization. Files/folders in /api that
// start with an underscore are not deployed as their own Vercel functions —
// this is a plain helper module imported by the real endpoints.
//
// Requires these Vercel environment variables (Project Settings →
// Environment Variables), taken from a Firebase service account:
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY
//
// Get a service account key from:
//   Firebase Console → Project settings → Service accounts →
//   "Generate new private key" (downloads a JSON file).
// Copy project_id → FIREBASE_PROJECT_ID, client_email → FIREBASE_CLIENT_EMAIL,
// and private_key → FIREBASE_PRIVATE_KEY.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp() {
  const existing = getApps();
  if (existing.length) return existing[0];

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Server is not configured: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY environment variables are required.'
    );
  }

  // Vercel env vars store newlines as the literal characters "\n" —
  // convert them back to real newlines for the PEM key.
  privateKey = privateKey.replace(/\\n/g, '\n');

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey })
  });
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getDb() {
  return getFirestore(getAdminApp());
}
