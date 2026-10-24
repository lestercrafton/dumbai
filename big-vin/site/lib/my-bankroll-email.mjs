/** Send My Bankroll OTP via Resend when RESEND_API_KEY is set. */
export async function sendOtpEmail({ to, code, from, apiKey }) {
  if (!apiKey) return { sent: false, reason: 'missing-key' };
  const sender = from || 'Big Vin <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: sender,
      to: [to],
      subject: `${code} is your Big Vin code`,
      text: `Your Big Vin My Bankroll sign-in code is ${code}.\n\nIt expires in 15 minutes. If you did not request this, ignore this email.\n\nFor entertainment purposes only — not financial advice.`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Resend send failed', res.status, body.slice(0, 300));
    return { sent: false, reason: 'send-failed', status: res.status };
  }
  return { sent: true };
}
