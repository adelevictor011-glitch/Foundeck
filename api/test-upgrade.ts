import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import { db } from './_utils/firebase';

// TEST ONLY. Unlocks Pro without paying, for trying the app before Paystack is set up.
// Off unless ALLOW_TEST_UPGRADE=true in Vercel, and even then it only upgrades the
// signed-in caller (proved with their Firebase ID token), never an arbitrary userId.
// Real payments unlock Pro through api/webhooks/paystack.ts.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.ALLOW_TEST_UPGRADE !== 'true') return res.status(404).send('Not found');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).send('Sign in first');

  let uid: string;
  try {
    uid = (await admin.auth().verifyIdToken(token)).uid;
  } catch {
    return res.status(401).send('Sign in again');
  }

  try {
    await db.collection('users').doc(uid).update({ isPro: true });
    res.status(200).send('Test upgrade successful');
  } catch (error) {
    console.error('Error in test upgrade:', error);
    res.status(500).send('Database error');
  }
}
