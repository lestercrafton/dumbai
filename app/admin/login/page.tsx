"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Logo } from "@/components/brand/Logo";
import { brand } from "@/lib/branding";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) { setError("Invalid email or password"); } else { window.location.href = "/admin"; }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="flex justify-center mb-4"><Logo /></div>
          <h1 className="text-xl font-semibold">Team sign in</h1>
          <p className="mt-1 text-sm text-ink-muted">{brand.productName} admin</p>
        </div>
        <div className="card space-y-6">
          <button onClick={() => signIn("google", { callbackUrl: "/admin" })} className="btn-secondary w-full justify-center gap-2">
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-ink-muted">or</span></div>
          </div>
          <form onSubmit={handleCredentials} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-ink-muted">Email</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none transition focus:border-brand focus:shadow-ring" />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-ink-muted">Password</label>
              <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none transition focus:border-brand focus:shadow-ring" />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center">{loading ? "Signing in…" : "Sign in"}</button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-ink-muted">© {new Date().getFullYear()} {brand.legalName}</p>
      </div>
    </div>
  );
}
