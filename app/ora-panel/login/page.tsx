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
    <div className="relative min-h-screen font-[family-name:var(--font-poppins)]">
      {/* Background image */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/auth-bg.webp"
          alt=""
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      </div>

      {/* Container */}
      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl">
        {/* Left column — branding */}
        <div className="hidden w-1/2 flex-col justify-between p-12 lg:flex">
          <div>
            <Image
              src="/logo.svg"
              alt="ORA"
              width={120}
              height={40}
              className="brightness-0 invert"
            />
          </div>
          <div>
            <h1 className="text-7xl font-light leading-[0.95] tracking-tight text-white uppercase">
              Craft
              <br />
              Beautiful
              <br />
              Experiences.
            </h1>
            <p className="mt-6 max-w-sm text-base text-white/60">
              Where luxury meets simplicity. Manage your content with elegance.
            </p>
            <p className="mt-10 max-w-sm text-xs text-white/30 italic">
              &ldquo;Design is not just what it looks like and feels like.
              Design is how it works.&rdquo;
            </p>
          </div>
          <p className="text-xs text-white/30">
            &copy; {new Date().getFullYear()} ORA. All rights reserved.
          </p>
        </div>

        {/* Right column — glassmorphic login card */}
        <div className="flex w-full items-center justify-center px-6 lg:w-1/2">
          <div className="w-full max-w-md bg-white/5 p-10 shadow-lg shadow-black/10 backdrop-blur-md">
            {/* Mobile logo */}
            <div className="mb-8 flex justify-center lg:hidden">
              <Image
                src="/logo.svg"
                alt="ORA"
                width={100}
                height={34}
                className="brightness-0 invert"
              />
            </div>

            <h2 className="text-2xl font-semibold text-white">Welcome back</h2>
            <p className="mt-1 text-sm text-white/50">
              Sign in to ORA Panel
            </p>

            {error && (
              <div className="mt-4 bg-ora-error/20 px-4 py-2.5 text-sm text-red-200">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-xs font-medium text-white/60"
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
                  className="h-11 w-full border border-white/15 bg-white/10 px-4 text-sm text-white placeholder:text-white/30 backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold/60"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-xs font-medium text-white/60"
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
                  className="h-11 w-full border border-white/15 bg-white/10 px-4 text-sm text-white placeholder:text-white/30 backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold/60"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="h-11 w-full bg-ora-gold text-sm font-semibold text-white transition-all hover:bg-ora-gold-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
