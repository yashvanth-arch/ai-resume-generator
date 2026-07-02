// api/generate.js
//
// POST /api/generate
// Vercel Serverless Function (Node.js runtime).
//
// 1. Verifies the caller's Firebase ID token (they must be signed in).
// 2. Applies the daily credit refill, then deducts GENERATION_COST (5)
//    credits — refuses with 402 if the user doesn't have enough.
// 3. Calls Gemini using GEMINI_API_KEY (server-side only, never sent to
//    the browser).
// 4. Refunds the deducted credits if anything after step 2 fails, so
//    users are only charged for resumes they actually receive.

import { requireAuth } from './_lib/auth.js';
import { deductGenerationCredits, refundGenerationCredits } from './_lib/credits.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server is not configured: GEMINI_API_KEY environment variable is missing.'
    });
  }

  let decoded;
  try {
    decoded = await requireAuth(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }
  }

  const { systemPrompt, userPrompt, schema } = body || {};
  if (!systemPrompt || !userPrompt) {
    return res.status(400).json({ error: 'systemPrompt and userPrompt are required.' });
  }

  const userInfo = { email: decoded.email, name: decoded.name };

  // --- Deduct credits BEFORE calling Gemini ---
  let remainingCredits;
  try {
    remainingCredits = await deductGenerationCredits(decoded.uid, userInfo);
  } catch (err) {
    if (err.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({ error: err.message, credits: err.credits });
    }
    return res.status(500).json({ error: 'Failed to check credits: ' + err.message });
  }

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' +
    encodeURIComponent(apiKey);

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema: schema
        }
      })
    });

    const data = await geminiRes.json().catch(() => null);

    if (!geminiRes.ok) {
      await refundGenerationCredits(decoded.uid);
      const msg =
        (data && data.error && data.error.message) ||
        `Gemini request failed (${geminiRes.status}).`;
      return res.status(geminiRes.status).json({ error: msg, credits: remainingCredits + 5 });
    }

    const candidate = data && data.candidates && data.candidates[0];
    if (!candidate) {
      await refundGenerationCredits(decoded.uid);
      return res.status(502).json({ error: 'No response returned by the model.', credits: remainingCredits + 5 });
    }
    if (candidate.finishReason === 'SAFETY') {
      await refundGenerationCredits(decoded.uid);
      return res.status(422).json({
        error: "The response was blocked by Gemini's safety filters. Try rephrasing your input.",
        credits: remainingCredits + 5
      });
    }

    const parts = (candidate.content && candidate.content.parts) || [];
    const text = parts.map((p) => p.text || '').join('\n');
    if (!text) {
      await refundGenerationCredits(decoded.uid);
      return res.status(502).json({ error: 'Empty response from model.', credits: remainingCredits + 5 });
    }

    let cleaned = text
      .trim()
      .replace(/^```json/i, '')
      .replace(/^```/, '')
      .replace(/```$/, '')
      .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1);
    }

    let resumeData;
    try {
      resumeData = JSON.parse(cleaned);
    } catch (e) {
      await refundGenerationCredits(decoded.uid);
      return res.status(502).json({ error: 'Model returned invalid JSON.', credits: remainingCredits + 5 });
    }

    return res.status(200).json({ resume: resumeData, credits: remainingCredits });
  } catch (err) {
    await refundGenerationCredits(decoded.uid).catch(() => {});
    return res.status(500).json({ error: 'Failed to reach Gemini: ' + err.message, credits: remainingCredits + 5 });
  }
}
