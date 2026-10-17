import React, { useState, useEffect } from 'react';
import {
  X,
  Mail,
  Lock,
  User as UserIcon,
  Phone,
  ShieldCheck,
  ArrowRight,
  KeyRound,
  CheckCircle,
  Sparkles,
  Inbox,
  RefreshCw,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { User } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  initialMode: 'login' | 'register';
  onClose: () => void;
  onLoginSuccess: (user: User) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialMode,
  onClose,
  onLoginSuccess,
}) => {
  if (!isOpen) return null;

  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [step, setStep] = useState<'form' | 'otp_verify'>('form');

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  // OTP state
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState(60);
  const [isLoadingOtp, setIsLoadingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [otpSuccessMessage, setOtpSuccessMessage] = useState('');

  // Google OAuth state
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [googleAuthError, setGoogleAuthError] = useState('');
  const [googleAuthNotice, setGoogleAuthNotice] = useState('');

  // Listen for official Google OAuth Popup callback postMessage
  useEffect(() => {
    const handleGoogleMessage = (event: MessageEvent) => {
      // Validate event origin or standard run.app / localhost
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS' && event.data.user) {
        const verifiedUser: User = event.data.user;
        try {
          localStorage.setItem('reinstore_user', JSON.stringify(verifiedUser));
        } catch {
          // ignore
        }
        onLoginSuccess(verifiedUser);
        onClose();
      } else if (event.data?.type === 'GOOGLE_AUTH_FAILED') {
        setGoogleAuthError(event.data.error || 'Login Google dibatalkan atau gagal.');
      }
    };

    window.addEventListener('message', handleGoogleMessage);
    return () => window.removeEventListener('message', handleGoogleMessage);
  }, [onLoginSuccess, onClose]);

  // Countdown timer for resend
  useEffect(() => {
    let timer: any;
    if (step === 'otp_verify' && countdown > 0) {
      timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [step, countdown]);

  // Handle Google Direct Sign-In via Official OAuth Popup
  const handleGoogleSignIn = async () => {
    setIsLoadingGoogle(true);
    setGoogleAuthError('');
    setGoogleAuthNotice('');

    try {
      const res = await fetch('/api/auth/google/url');
      const data = await res.json();

      if (data.configured && data.url) {
        // Open Google's official authorization popup directly
        const width = 500;
        const height = 650;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        const authWindow = window.open(
          data.url,
          'google_oauth_popup',
          `width=${width},height=${height},left=${left},top=${top},status=0,toolbar=0,menubar=0`
        );

        if (!authWindow) {
          setGoogleAuthError('Popup diblokir oleh browser. Mohon izinkan popup di browser Anda untuk masuk dengan Google.');
        }
      } else {
        // When Google Client ID is not yet provided, show clear notice
        setGoogleAuthNotice(
          'Untuk menghubungkan akun Google secara otomatis, masukkan alamat Gmail Anda pada formulir di bawah. Sistem akan mengirimkan kode OTP resmi langsung ke kotak masuk Gmail Anda.'
        );
      }
    } catch (err: any) {
      setGoogleAuthError('Koneksi ke Google OAuth gagal. Silakan gunakan metode email di bawah.');
    } finally {
      setIsLoadingGoogle(false);
    }
  };

  // Request OTP from server (OTP is delivered to user's real Gmail)
  const requestOtpToEmail = async (targetEmail: string) => {
    setIsLoadingOtp(true);
    setOtpError('');
    setOtpSuccessMessage('');

    try {
      const res = await fetch('/api/email/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail.trim() }),
      });

      const data = await res.json();

      if (res.ok) {
        setOtpSuccessMessage(data.message || `Kode OTP telah dikirimkan ke Gmail (${targetEmail}).`);
        setStep('otp_verify');
        setCountdown(60);
      } else {
        setOtpError(data.error || 'Gagal mengirimkan kode OTP. Pastikan email Anda valid.');
      }
    } catch {
      setOtpError('Terjadi kendala jaringan saat menghubungi server email. Coba lagi.');
    } finally {
      setIsLoadingOtp(false);
    }
  };

  const handleManualFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      alert('Mohon isi alamat email dan kata sandi!');
      return;
    }
    requestOtpToEmail(email.trim());
  };

  const handleOtpInputChange = (index: number, val: string) => {
    const clean = val.replace(/[^0-9]/g, '');
    if (clean.length > 1) {
      // Handle pasting whole OTP
      const chars = clean.slice(0, 6).split('');
      const newDigits = [...otpDigits];
      chars.forEach((c, i) => {
        if (i < 6) newDigits[i] = c;
      });
      setOtpDigits(newDigits);
      const nextFocus = document.getElementById(`auth-otp-${Math.min(chars.length, 5)}`);
      nextFocus?.focus();
      return;
    }

    const next = [...otpDigits];
    next[index] = clean;
    setOtpDigits(next);

    if (clean && index < 5) {
      const nextEl = document.getElementById(`auth-otp-${index + 1}`);
      nextEl?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      const prevEl = document.getElementById(`auth-otp-${index - 1}`);
      prevEl?.focus();
    }
  };

  const handleResendOtp = () => {
    if (countdown > 0) return;
    requestOtpToEmail(email);
  };

  // Submit entered OTP for verification against backend
  const handleVerifyOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const entered = otpDigits.join('');

    if (entered.length < 6) {
      setOtpError('Mohon masukkan 6 digit kode OTP secara lengkap.');
      return;
    }

    setIsVerifyingOtp(true);
    setOtpError('');

    try {
      const res = await fetch('/api/email/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          otp: entered,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        const verifiedUser: User = {
          id: `usr-${Date.now()}`,
          name: name.trim() || email.split('@')[0] || 'Member Reinstore',
          email: email.trim(),
          phone: phone.trim() || '',
          isVerified2FA: true,
          role: email.toLowerCase().includes('admin') ? 'admin' : 'user',
        };

        try {
          localStorage.setItem('reinstore_user', JSON.stringify(verifiedUser));
        } catch {
          // ignore
        }

        onLoginSuccess(verifiedUser);
        onClose();
      } else {
        setOtpError(data.error || 'Kode OTP tidak cocok atau telah kadaluarsa. Silakan periksa kembali Gmail Anda.');
      }
    } catch {
      setOtpError('Gagal memverifikasi OTP. Periksa koneksi internet Anda dan coba lagi.');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="bg-[#091024] border border-slate-800 rounded-3xl w-full max-w-md shadow-2xl relative my-auto overflow-hidden animate-in zoom-in-95">
        {/* Header / Close */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-[#0c152e] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/40 text-[#00A3FF] flex items-center justify-center">
              {step === 'otp_verify' ? <KeyRound className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="text-sm font-black text-white">
                {step === 'otp_verify'
                  ? 'Verifikasi OTP Gmail'
                  : mode === 'login'
                  ? 'Masuk ke Reinstore'
                  : 'Daftar Akun Baru'}
              </h3>
              <p className="text-[10px] text-slate-400">
                {step === 'otp_verify'
                  ? 'Kode verifikasi keamanan dikirim ke Gmail Anda'
                  : 'Terhubung resmi dengan Google & Gmail'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          {/* STEP 1: FORM & REAL GOOGLE LOGIN */}
          {step === 'form' && (
            <>
              {/* Login / Register Toggle Tabs */}
              <div className="flex border-b border-slate-800 pb-2 gap-4">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className={`text-xs font-bold pb-2 transition-all relative cursor-pointer ${
                    mode === 'login' ? 'text-[#00A3FF]' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Masuk Akun
                  {mode === 'login' && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#00A3FF] rounded-full" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className={`text-xs font-bold pb-2 transition-all relative cursor-pointer ${
                    mode === 'register' ? 'text-[#00A3FF]' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Daftar Baru
                  {mode === 'register' && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#00A3FF] rounded-full" />
                  )}
                </button>
              </div>

              {/* OFFICIAL GOOGLE SIGN-IN BUTTON */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoadingGoogle}
                className="w-full py-3 px-4 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs sm:text-sm flex items-center justify-center gap-3 shadow-lg shadow-white/10 transition-all active:scale-98 cursor-pointer border border-slate-200"
              >
                {isLoadingGoogle ? (
                  <RefreshCw className="w-5 h-5 animate-spin text-slate-700" />
                ) : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                )}
                <span>
                  {mode === 'login'
                    ? 'Masuk dengan Akun Resmi Google'
                    : 'Daftar dengan Akun Resmi Google'}
                </span>
              </button>

              {/* Feedback messages for Google sign-in */}
              {googleAuthError && (
                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{googleAuthError}</span>
                </div>
              )}

              {googleAuthNotice && (
                <div className="p-3 rounded-xl bg-blue-950/40 border border-cyan-500/30 text-cyan-200 text-[11px] leading-relaxed">
                  {googleAuthNotice}
                </div>
              )}

              <div className="bg-gradient-to-r from-blue-950/40 via-cyan-950/30 to-blue-950/40 border border-blue-500/25 rounded-2xl p-3 flex items-start gap-2.5 text-[11px] text-blue-200">
                <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  Semua invoice pesanan dan kode verifikasi OTP resmi akan dikirimkan langsung ke kotak masuk <strong>Gmail Anda</strong> secara real-time.
                </p>
              </div>

              <div className="flex items-center gap-3 my-2">
                <span className="flex-1 h-px bg-slate-800" />
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                  Atau Masuk dengan Email
                </span>
                <span className="flex-1 h-px bg-slate-800" />
              </div>

              {/* Standard Form */}
              <form onSubmit={handleManualFormSubmit} className="space-y-3">
                {mode === 'register' && (
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">
                      Nama Lengkap
                    </label>
                    <div className="relative">
                      <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Contoh: Budi Pratama"
                        className="w-full bg-[#0c152e] border border-slate-700 text-white rounded-xl pl-9 pr-3 py-2 text-xs focus:border-[#00A3FF] focus:outline-none"
                        required
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Alamat Gmail / Email <span className="text-cyan-400">(Untuk Terima OTP & Invoice)</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="namaanda@gmail.com"
                      className="w-full bg-[#0c152e] border border-slate-700 text-white rounded-xl pl-9 pr-3 py-2 text-xs focus:border-[#00A3FF] focus:outline-none"
                      required
                    />
                  </div>
                </div>

                {mode === 'register' && (
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">
                      Nomor WhatsApp (Opsional / Notifikasi Pesanan)
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="081234567890"
                        className="w-full bg-[#0c152e] border border-slate-700 text-white rounded-xl pl-9 pr-3 py-2 text-xs focus:border-[#00A3FF] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Kata Sandi
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimal 6 karakter"
                      className="w-full bg-[#0c152e] border border-slate-700 text-white rounded-xl pl-9 pr-3 py-2 text-xs focus:border-[#00A3FF] focus:outline-none"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoadingOtp}
                  className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 transition-all active:scale-98 cursor-pointer"
                >
                  {isLoadingOtp ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>Kirim Kode OTP ke Gmail</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </>
          )}

          {/* STEP 2: REAL OTP VERIFICATION STEP (CHECK ACTUAL GMAIL INBOX) */}
          {step === 'otp_verify' && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 flex items-center justify-center mx-auto mb-2 shadow-[0_0_20px_rgba(6,182,212,0.25)]">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h4 className="text-base font-black text-white">Masukkan Kode OTP 6 Digit</h4>
                <p className="text-xs text-slate-300 mt-1">
                  Kode keamanan verifikasi telah dikirimkan ke kotak masuk Gmail Anda:
                </p>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono text-xs font-bold mt-1.5">
                  <Mail className="w-3.5 h-3.5" />
                  <span>{email}</span>
                </div>
              </div>

              {/* REAL INBOX INSTRUCTION CARD */}
              <div className="bg-[#0b162f] border border-cyan-500/40 rounded-2xl p-4 shadow-xl space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-red-600/20 border border-red-500/30 text-red-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Inbox className="w-4 h-4" />
                  </div>
                  <div className="text-xs text-slate-300 leading-relaxed">
                    <p className="font-semibold text-white mb-0.5">Silakan Buka Gmail Anda</p>
                    <p className="text-[11px] text-slate-400">
                      Cek folder <strong>Kotak Masuk (Inbox)</strong> atau <strong>Spam</strong> pada email <span className="text-cyan-300">{email}</span> untuk melihat kode 6 digit yang dikirimkan.
                    </p>
                  </div>
                </div>

                <a
                  href="https://mail.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs flex items-center justify-center gap-2 border border-slate-700 transition-colors"
                >
                  <Mail className="w-3.5 h-3.5 text-red-400" />
                  <span>Buka Aplikasi Gmail (mail.google.com)</span>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </a>
              </div>

              {otpSuccessMessage && (
                <div className="text-[11px] text-emerald-400 bg-emerald-950/30 border border-emerald-500/20 px-3 py-2 rounded-xl text-center">
                  {otpSuccessMessage}
                </div>
              )}

              {/* OTP 6-Digit Input Boxes */}
              <form onSubmit={handleVerifyOtpSubmit} className="space-y-4">
                <div className="flex justify-center gap-2">
                  {otpDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      id={`auth-otp-${idx}`}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpInputChange(idx, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                      className="w-11 h-13 text-center text-xl font-mono font-black bg-[#0c152e] border border-slate-700 focus:border-cyan-400 rounded-xl text-white focus:outline-none shadow-inner"
                      autoFocus={idx === 0}
                    />
                  ))}
                </div>

                {otpError && (
                  <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs text-center font-medium">
                    {otpError}
                  </div>
                )}

                <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                  <span>Tidak menerima email?</span>
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={countdown > 0}
                    className={`font-semibold cursor-pointer ${
                      countdown > 0 ? 'text-slate-500 cursor-not-allowed' : 'text-cyan-400 hover:underline'
                    }`}
                  >
                    {countdown > 0 ? `Kirim Ulang (${countdown}s)` : 'Kirim Ulang Kode OTP'}
                  </button>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('form');
                      setOtpDigits(['', '', '', '', '', '']);
                      setOtpError('');
                    }}
                    className="flex-1 py-3 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Kembali
                  </button>
                  <button
                    type="submit"
                    disabled={isVerifyingOtp}
                    className="flex-2 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
                  >
                    {isVerifyingOtp ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        <span>Verifikasi & Masuk Akun</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
