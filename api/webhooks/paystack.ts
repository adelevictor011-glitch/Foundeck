import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { db } from '../_utils/firebase';

export const config = {
  api: {
    bodyParser: false,
  },
};

// Must match paystackConfig in src/App.tsx (amount is in the smallest unit: cents).
const PRO_AMOUNT = 1500 * 100;
const PRO_CURRENCY = 'USD';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return res.status(500).send("Server configuration error");

  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks);
    const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    const sent = String(req.headers['x-paystack-signature'] || '');
    const ok = sent.length === hash.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(hash));
    if (!ok) {
      return res.status(401).send("Invalid signature");
    }

    try {
      const event = JSON.parse(rawBody.toString('utf8'));
      
      if (event.event === 'charge.success') {
        const userId = event.data.metadata?.userId;
        // Only the Pro price unlocks Pro: any other charge on the same Paystack account
        // (a different product, a 1-cent test) carrying a userId must not.
        const paidEnough = event.data.status === 'success' &&
          String(event.data.currency).toUpperCase() === PRO_CURRENCY &&
          Number(event.data.amount) >= PRO_AMOUNT;
        if (!paidEnough) {
          console.warn(`Ignored charge ${event.data.reference}: ${event.data.amount} ${event.data.currency}`);
        } else if (userId) {
          await db.collection('users').doc(userId).update({
            isPro: true
          });
          console.log(`Successfully upgraded user ${userId} to Pro via Vercel Webhook`);
        }
      }

      res.status(200).send("Webhook received");
    } catch (error) {
      console.error(error);
      res.status(500).send("Database error");
    }
  });
}
