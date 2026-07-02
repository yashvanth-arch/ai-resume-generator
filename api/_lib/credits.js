// api/_lib/credits.js
//
// Simple one-time-grant credit system (no auto-refill):
//   - New user gets NEW_USER_CREDITS (5) once, on first sign-in.
//   - One resume generation costs GENERATION_COST (5) credits.
//   - Credits never regenerate on their own. Once a user runs out,
//     generation is blocked with INSUFFICIENT_CREDITS until they buy more
//     (subscriptions are not implemented yet — that's for later).
//
// All reads/writes go through Firestore transactions so concurrent
// requests (e.g. a double-click) can't double-spend.

import { getDb } from './firebaseAdmin.js';

export const NEW_USER_CREDITS = 5;
export const GENERATION_COST = 5;

const USERS_COLLECTION = 'users';

function baseDoc(userInfo, existingData) {
  return {
    email: (userInfo && userInfo.email) || (existingData && existingData.email) || null,
    displayName: (userInfo && userInfo.name) || (existingData && existingData.displayName) || null,
    createdAt: (existingData && existingData.createdAt) || new Date().toISOString()
  };
}

/**
 * Returns the user's current credit balance, creating their Firestore doc
 * with NEW_USER_CREDITS if this is their first time. Never deducts.
 * Used by GET /api/credits.
 */
export async function getCredits(uid, userInfo) {
  const db = getDb();
  const ref = db.collection(USERS_COLLECTION).doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      tx.set(ref, { ...baseDoc(userInfo, null), credits: NEW_USER_CREDITS });
      return NEW_USER_CREDITS;
    }

    const data = snap.data();
    return typeof data.credits === 'number' ? data.credits : NEW_USER_CREDITS;
  });
}

/**
 * Deducts GENERATION_COST if the user has enough credits (creating their
 * doc with NEW_USER_CREDITS first if this is their first call). Throws an
 * Error with .code === 'INSUFFICIENT_CREDITS' (and .credits set to the
 * current balance) if they don't. Returns the new balance on success.
 * Used by POST /api/generate, BEFORE calling Gemini —
 * refundGenerationCredits() should be called if generation subsequently
 * fails.
 */
export async function deductGenerationCredits(uid, userInfo) {
  const db = getDb();
  const ref = db.collection(USERS_COLLECTION).doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const exists = snap.exists;
    const data = exists ? snap.data() : null;
    const credits = exists && typeof data.credits === 'number' ? data.credits : NEW_USER_CREDITS;

    if (credits < GENERATION_COST) {
      const err = new Error(
        `Not enough credits — you have ${credits}, and a resume costs ${GENERATION_COST}.`
      );
      err.code = 'INSUFFICIENT_CREDITS';
      err.credits = credits;
      throw err;
    }

    const newBalance = credits - GENERATION_COST;
    tx.set(ref, { ...baseDoc(userInfo, data), credits: newBalance }, { merge: true });
    return newBalance;
  });
}

/**
 * Refunds GENERATION_COST credits. Called when a generation was charged
 * for but then failed, so the user isn't billed for a resume they never
 * got.
 */
export async function refundGenerationCredits(uid) {
  const db = getDb();
  const ref = db.collection(USERS_COLLECTION).doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    const credits = typeof data.credits === 'number' ? data.credits : 0;
    tx.set(ref, { credits: credits + GENERATION_COST }, { merge: true });
  });
}
