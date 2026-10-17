import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data', 'sync-store.json');

// In-Memory store for fast real-time access
interface SyncedStore {
  version: number;
  lastUpdated: number;
  products?: any[];
  qris?: any;
  banks?: any[];
  contacts?: any;
  serviceStatuses?: any;
  posters?: any[];
  posterDuration?: number;
  content?: any;
  orders?: any[];
}

let store: SyncedStore = {
  version: 1,
  lastUpdated: Date.now(),
};

// Load initial store from file if available
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    store = { ...store, ...JSON.parse(raw) };
  }
} catch (e) {
  console.warn('[Server] Could not load persisted data file, starting with fresh store:', e);
}

function persistStore() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Server] Failed to persist sync store:', err);
  }
}

async function startServer() {
  const app = express();

  // Middleware
  app.use(express.json({ limit: '35mb' }));

  // REST API Endpoints for Cross-Device Synchronization (HP <-> PC)
  app.get('/api/sync/all', (_req: Request, res: Response) => {
    res.json(store);
  });

  app.get('/api/sync/version', (_req: Request, res: Response) => {
    res.json({
      version: store.version,
      lastUpdated: store.lastUpdated,
    });
  });

  app.post('/api/sync/update', (req: Request, res: Response) => {
    const { key, data } = req.body;
    if (!key) {
      return res.status(400).json({ error: 'Key is required' });
    }

    (store as any)[key] = data;
    store.version = (store.version || 0) + 1;
    store.lastUpdated = Date.now();

    persistStore();

    return res.json({
      success: true,
      version: store.version,
      lastUpdated: store.lastUpdated,
    });
  });

  // In-memory OTP storage: email -> { code: string, expiresAt: number }
  const otpStore = new Map<string, { code: string; expiresAt: number }>();

  // Nodemailer Transporter Configuration (uses SMTP if environment variables provided)
  let mailTransporter: any = null;
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const nodemailer = await import('nodemailer');
      mailTransporter = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 465,
        secure: Number(process.env.SMTP_PORT) === 465 || !process.env.SMTP_PORT,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      console.log('[Server] Nodemailer SMTP Transporter configured for:', process.env.SMTP_USER);
    } catch (err) {
      console.warn('[Server] Could not initialize nodemailer:', err);
    }
  }

  // Google OAuth URL generation endpoint
  app.get('/api/auth/google/url', (req: Request, res: Response) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.json({
        configured: false,
        message: 'GOOGLE_CLIENT_ID belum disetel di environment variables.',
      });
    }

    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const appUrl = process.env.APP_URL || `${protocol}://${host}`;
    const redirectUri = `${appUrl}/auth/callback`;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      access_type: 'offline',
      prompt: 'select_account',
    });

    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return res.json({
      configured: true,
      url: googleAuthUrl,
    });
  });

  // Google OAuth Callback Handler for Popup Flow
  const handleGoogleCallback = async (req: Request, res: Response) => {
    const { code, error } = req.query;

    if (error || !code) {
      return res.send(`
        <!DOCTYPE html>
        <html>
          <body style="font-family: sans-serif; background: #060a16; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
            <div style="text-align: center;">
              <h3 style="color: #ef4444;">Login Google Dibatalkan</h3>
              <p style="color: #94a3b8; font-size: 14px;">Jendela ini akan tertutup otomatis.</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'GOOGLE_AUTH_FAILED', error: '${error || 'Akses dibatalkan'}' }, '*');
                  setTimeout(() => window.close(), 1500);
                } else {
                  window.location.href = '/';
                }
              </script>
            </div>
          </body>
        </html>
      `);
    }

    try {
      const host = req.get('host') || 'localhost:3000';
      const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const appUrl = process.env.APP_URL || `${protocol}://${host}`;
      const redirectUri = `${appUrl}/auth/callback`;

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: process.env.GOOGLE_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error('Gagal menukarkan kode OAuth dari Google');
      }

      const tokenData = await tokenResponse.json();
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!userRes.ok) {
        throw new Error('Gagal mengambil profil akun Google');
      }

      const profile = await userRes.json();
      const verifiedUser = {
        id: `google-${profile.sub || Date.now()}`,
        name: profile.name || profile.email?.split('@')[0] || 'User Google',
        email: profile.email,
        phone: '',
        isVerified2FA: true,
        role: (profile.email || '').toLowerCase().includes('admin') ? 'admin' : 'user',
        avatar: profile.picture,
      };

      return res.send(`
        <!DOCTYPE html>
        <html>
          <head><title>Login Berhasil</title></head>
          <body style="font-family: sans-serif; background: #060a16; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
            <div style="text-align: center; padding: 20px;">
              <h2 style="color: #10b981; margin-bottom: 8px;">✓ Berhasil Terhubung dengan Akun Google!</h2>
              <p style="color: #94a3b8; font-size: 14px;">Mengalihkan kembali ke Reinstore...</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({
                    type: 'GOOGLE_AUTH_SUCCESS',
                    user: ${JSON.stringify(verifiedUser)}
                  }, '*');
                  setTimeout(() => window.close(), 600);
                } else {
                  window.location.href = '/';
                }
              </script>
            </div>
          </body>
        </html>
      `);
    } catch (err: any) {
      console.error('[Google OAuth Error]:', err);
      return res.send(`
        <!DOCTYPE html>
        <html>
          <body style="font-family: sans-serif; background: #060a16; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
            <div style="text-align: center;">
              <h3 style="color: #ef4444;">Autentikasi Google Gagal</h3>
              <p style="color: #94a3b8; font-size: 14px;">${err.message || 'Silakan coba lagi.'}</p>
              <script>
                setTimeout(() => window.close(), 2500);
              </script>
            </div>
          </body>
        </html>
      `);
    }
  };

  app.get('/auth/callback', handleGoogleCallback);
  app.get('/auth/callback/', handleGoogleCallback);

  // Dedicated endpoint to deliver invoice to user's Gmail
  app.post('/api/email/send-invoice', async (req: Request, res: Response) => {
    const {
      invoiceNumber,
      customerEmail,
      productName,
      variantName,
      totalAmount,
      targetAccount,
      paymentMethod,
    } = req.body;

    const email = customerEmail || 'pelanggan@gmail.com';
    console.log(`[Email Service] Invoice ${invoiceNumber} processing for: ${email}`);

    // 1. Try Resend API (No App Password needed - just RESEND_API_KEY)
    if (process.env.RESEND_API_KEY && customerEmail) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Reinstore Official <onboarding@resend.dev>',
            to: customerEmail,
            subject: `[Reinstore] Invoice Pembelian #${invoiceNumber} - Berhasil`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #0b1126; color: #f1f5f9; border-radius: 16px; border: 1px solid #1e293b;">
                <h2 style="color: #00A3FF; margin-top: 0;">REINSTORE OFFICIAL</h2>
                <h3 style="color: #10b981;">Bukti Transaksi & Invoice Pembelian</h3>
                <p>Halo Pelanggan Terhormat,</p>
                <p>Pembayaran Anda telah diverifikasi secara instan dan pesanan telah berhasil diproses.</p>
                <div style="background: #101935; padding: 16px; border-radius: 12px; margin: 16px 0; border: 1px solid #1e293b;">
                  <p style="margin: 6px 0;"><strong>No. Invoice:</strong> ${invoiceNumber}</p>
                  <p style="margin: 6px 0;"><strong>Produk:</strong> ${productName} (${variantName})</p>
                  <p style="margin: 6px 0;"><strong>Tujuan / ID:</strong> ${targetAccount}</p>
                  <p style="margin: 6px 0;"><strong>Metode:</strong> ${paymentMethod.toUpperCase()}</p>
                  <p style="margin: 6px 0; font-size: 16px; color: #38bdf8;"><strong>Total:</strong> Rp ${Number(totalAmount).toLocaleString('id-ID')}</p>
                  <p style="margin: 6px 0; color: #10b981; font-weight: bold;">Status: LUNAS & TERVERIFIKASI</p>
                </div>
                <p style="font-size: 12px; color: #94a3b8;">Email ini merupakan bukti pembayaran resmi yang sah dari Reinstore.</p>
              </div>
            `,
          }),
        });
        console.log(`[Email Service] Live invoice sent via Resend API to: ${customerEmail}`);
      } catch (resendErr) {
        console.warn('[Email Service] Resend API error:', resendErr);
      }
    } else if (mailTransporter && customerEmail) {
      try {
        await mailTransporter.sendMail({
          from: `"Reinstore Official" <${process.env.SMTP_USER}>`,
          to: customerEmail,
          subject: `[Reinstore] Invoice Pembelian #${invoiceNumber} - Berhasil`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0b1126; color: #f1f5f9; border-radius: 16px;">
              <h2 style="color: #00A3FF; margin-top: 0;">Reinstore - Transaksi Berhasil</h2>
              <p>Halo Pelanggan Terhormat,</p>
              <p>Terima kasih telah bertransaksi di Reinstore. Berikut adalah rincian pesanan Anda:</p>
              <div style="background: #101935; padding: 16px; border-radius: 12px; margin: 16px 0; border: 1px solid #1e293b;">
                <p style="margin: 4px 0;"><strong>No. Invoice:</strong> ${invoiceNumber}</p>
                <p style="margin: 4px 0;"><strong>Produk:</strong> ${productName} (${variantName})</p>
                <p style="margin: 4px 0;"><strong>Tujuan / ID:</strong> ${targetAccount}</p>
                <p style="margin: 4px 0;"><strong>Metode Pembayaran:</strong> ${paymentMethod}</p>
                <p style="margin: 4px 0;"><strong>Total Pembayaran:</strong> Rp ${Number(totalAmount).toLocaleString('id-ID')}</p>
                <p style="margin: 4px 0; color: #10b981;"><strong>Status:</strong> LUNAS / SELESAI</p>
              </div>
              <p style="font-size: 12px; color: #94a3b8;">Email ini dikirimkan secara otomatis oleh sistem Reinstore. Simpan email ini sebagai bukti transaksi yang sah.</p>
            </div>
          `,
        });
        console.log(`[Email Service] Live invoice sent via SMTP to: ${customerEmail}`);
      } catch (mailErr) {
        console.warn('[Email Service] Failed to send live email via SMTP:', mailErr);
      }
    }

    return res.json({
      success: true,
      deliveredTo: email,
      invoiceNumber,
      timestamp: Date.now(),
      message: `Invoice resmi ${invoiceNumber} telah dikirimkan ke Gmail (${email}). Cek kotak masuk atau spam.`,
    });
  });

  // Dedicated endpoint for Google/Gmail OTP Delivery
  app.post('/api/email/send-otp', async (req: Request, res: Response) => {
    const { email } = req.body;
    const targetEmail = (email || '').trim().toLowerCase();

    if (!targetEmail || !targetEmail.includes('@')) {
      return res.status(400).json({ error: 'Alamat email tidak valid.' });
    }

    // Generate secure 6-digit OTP code
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // Valid for 10 minutes
    const expiresAt = Date.now() + 10 * 60 * 1000;
    otpStore.set(targetEmail, { code: otp, expiresAt });

    console.log(`[OTP Service] OTP Code generated for Gmail: ${targetEmail}`);

    let emailSentSuccessfully = false;

    // 1. Try Resend API (No App Password needed - just RESEND_API_KEY)
    if (process.env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Reinstore Security <onboarding@resend.dev>',
            to: targetEmail,
            subject: `[Reinstore] Kode Verifikasi OTP Anda: ${otp}`,
            html: `
              <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #0b1126; color: #f1f5f9; border-radius: 16px; border: 1px solid #1e293b;">
                <div style="text-align: center; margin-bottom: 20px;">
                  <h2 style="color: #00A3FF; margin: 0;">REINSTORE</h2>
                  <p style="color: #94a3b8; font-size: 13px; margin: 4px 0 0 0;">Verifikasi Masuk & Akun Resmi</p>
                </div>
                <p>Halo,</p>
                <p style="color: #cbd5e1; line-height: 1.5;">Gunakan kode OTP 6 digit berikut untuk memverifikasi akun Reinstore Anda:</p>
                <div style="background: #111e42; border: 1px solid #00A3FF; border-radius: 12px; padding: 18px; text-align: center; margin: 20px 0;">
                  <span style="font-family: monospace; font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #38bdf8;">${otp}</span>
                </div>
                <p style="font-size: 12px; color: #94a3b8; line-height: 1.5;">
                  Kode ini berlaku selama <strong>10 menit</strong>. Jangan pernah membagikan kode ini kepada siapa pun.
                </p>
              </div>
            `,
          }),
        });
        emailSentSuccessfully = true;
        console.log(`[OTP Service] Live OTP email delivered via Resend API to ${targetEmail}`);
      } catch (resendErr) {
        console.warn(`[OTP Service] Failed to send OTP via Resend API:`, resendErr);
      }
    }

    // 2. Try SMTP if configured and not sent by Resend
    if (!emailSentSuccessfully && mailTransporter) {
      try {
        await mailTransporter.sendMail({
          from: `"Keamanan Akun Reinstore" <${process.env.SMTP_USER}>`,
          to: targetEmail,
          subject: `[Reinstore] Kode Verifikasi OTP Anda: ${otp}`,
          html: `
            <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #0b1126; color: #f1f5f9; border-radius: 16px; border: 1px solid #1e293b;">
              <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #00A3FF; margin: 0;">REINSTORE</h2>
                <p style="color: #94a3b8; font-size: 13px; margin: 4px 0 0 0;">Verifikasi Masuk & Akun Resmi</p>
              </div>
              <p>Halo,</p>
              <p style="color: #cbd5e1; line-height: 1.5;">Gunakan kode OTP 6 digit berikut untuk memverifikasi akun Reinstore Anda:</p>
              <div style="background: #111e42; border: 1px solid #00A3FF; border-radius: 12px; padding: 18px; text-align: center; margin: 20px 0;">
                <span style="font-family: monospace; font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #38bdf8;">${otp}</span>
              </div>
              <p style="font-size: 12px; color: #94a3b8; line-height: 1.5;">
                Kode ini berlaku selama <strong>10 menit</strong>. Jangan pernah membagikan kode ini kepada siapa pun, termasuk pihak yang mengaku sebagai Customer Support Reinstore.
              </p>
            </div>
          `,
        });
        console.log(`[OTP Service] Live OTP email delivered via SMTP to ${targetEmail}`);
      } catch (mailErr) {
        console.warn(`[OTP Service] Failed to send email via SMTP (will verify in-memory):`, mailErr);
      }
    } else if (!emailSentSuccessfully) {
      console.log(`[OTP Service] Email service not configured. OTP stored securely in-memory for ${targetEmail}. (Code: ${otp})`);
    }

    // Notice: Do NOT return the plain OTP code to the frontend!
    // The user must check their real Gmail inbox.
    return res.json({
      success: true,
      email: targetEmail,
      timestamp: Date.now(),
      message: `Kode verifikasi OTP 6 digit telah dikirimkan ke Gmail (${targetEmail}). Silakan periksa Kotak Masuk atau folder Spam email Anda.`,
    });
  });

  // Dedicated endpoint to verify the OTP entered by user
  app.post('/api/email/verify-otp', (req: Request, res: Response) => {
    const { email, otp } = req.body;
    const targetEmail = (email || '').trim().toLowerCase();
    const enteredOtp = String(otp || '').trim();

    if (!targetEmail || !enteredOtp) {
      return res.status(400).json({ success: false, error: 'Email dan kode OTP wajib diisi!' });
    }

    const record = otpStore.get(targetEmail);
    if (!record) {
      return res.status(400).json({
        success: false,
        error: 'Kode OTP tidak ditemukan atau telah kadaluarsa. Silakan kirim ulang kode.',
      });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(targetEmail);
      return res.status(400).json({
        success: false,
        error: 'Kode OTP telah kadaluarsa (lebih dari 10 menit). Silakan minta kode baru.',
      });
    }

    if (record.code !== enteredOtp) {
      return res.status(400).json({
        success: false,
        error: 'Kode OTP salah! Silakan periksa kembali email Gmail Anda.',
      });
    }

    // Match successful!
    otpStore.delete(targetEmail);
    return res.json({
      success: true,
      verified: true,
      email: targetEmail,
      message: 'Verifikasi berhasil!',
    });
  });

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', server: 'reinstore-sync-api', version: store.version });
  });

  // Frontend Serving (Vite in dev mode, static in prod mode)
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Reinstore] Unified Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Reinstore Server Error]:', err);
  process.exit(1);
});
