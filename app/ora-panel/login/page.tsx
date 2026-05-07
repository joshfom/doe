'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || '';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        router.replace('/ora-panel');
      } else {
        setError('Invalid credentials');
      }
    } catch {
      setError('Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen font-[family-name:var(--font-poppins)]">
      {/* Left column — background image + hero text */}
      <div className="relative hidden w-1/2 lg:flex">
        {/* Background image */}
        <Image
          src="/bg-desktop.png"
          alt=""
          fill
          className="object-cover"
          priority
        />

        {/* Content over the image */}
        <div className="relative z-10 flex h-full w-full flex-col items-center justify-center p-12">
          {/* Logo */}
          <Image
            src="/logo.svg"
            alt="ORA"
            width={100}
            height={34}
            className="mb-10"
          />

          {/* Title */}
          <h1 className="text-center text-2xl font-medium tracking-tight text-ora-charcoal">
            Digital Operations Engine
          </h1>

          {/* Description */}
          <p className="mt-4 max-w-sm text-center text-sm leading-relaxed text-ora-charcoal-light">
            Manage pages, media, AI assistants, and approvals from one unified control panel.
          </p>
        </div>
      </div>

      {/* Right column — login form */}
      <div className="flex w-full flex-col items-center justify-center bg-white px-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="mb-10 flex justify-center lg:hidden">
            <Image
              src="/logo.svg"
              alt="ORA"
              width={100}
              height={34}
            />
          </div>

          <h2 className="text-2xl font-semibold text-ora-charcoal">Control Panel</h2>
          <p className="mt-1 text-sm text-ora-charcoal-light">
            Sign in to your account
          </p>

          {/* SSO Button */}
          <button
            type="button"
            className="mt-8 flex h-11 w-full items-center justify-center gap-3 border border-ora-sand bg-white text-sm font-medium text-ora-charcoal transition-colors hover:bg-ora-cream-light"
          >
            <svg className="h-5 w-5" viewBox="0 0 21 21" fill="none">
              <path d="M10 0H0V10H10V0Z" fill="#F25022" />
              <path d="M21 0H11V10H21V0Z" fill="#7FBA00" />
              <path d="M10 11H0V21H10V11Z" fill="#00A4EF" />
              <path d="M21 11H11V21H21V11Z" fill="#FFB900" />
            </svg>
            Sign in with Microsoft
          </button>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-ora-sand" />
            <span className="text-xs text-ora-muted">or</span>
            <div className="h-px flex-1 bg-ora-sand" />
          </div>

          {error && (
            <div className="mb-4 rounded bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-xs font-medium text-ora-charcoal-light"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-11 w-full border border-ora-sand bg-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold/60"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-xs font-medium text-ora-charcoal-light"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 w-full border border-ora-sand bg-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold/60"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="h-11 w-full bg-ora-charcoal text-sm font-semibold text-white transition-all hover:bg-ora-charcoal/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
