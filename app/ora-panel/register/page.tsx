'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || '';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, email, password }),
      });

      if (res.ok) {
        router.replace('/ora-panel');
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Registration failed');
      }
    } catch {
      setError('Something went wrong. Please try again.');
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
              Start
              <br />
              Building
              <br />
              Something
              <br />
              Great.
            </h1>
            <p className="mt-6 max-w-sm text-base text-white/60">
              Join ORA and bring your vision to life with our intuitive content platform.
            </p>
            <p className="mt-10 max-w-sm text-xs text-white/30 italic">
              &ldquo;The details are not the details. They make the design.&rdquo;
            </p>
          </div>
          <p className="text-xs text-white/30">
            &copy; {new Date().getFullYear()} ORA. All rights reserved.
          </p>
        </div>

        {/* Right column — glassmorphic register card */}
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

            <h2 className="text-2xl font-semibold text-white">Create account</h2>
            <p className="mt-1 text-sm text-white/60">
              Get started with ORA Panel
            </p>

            {error && (
              <div className="mt-4 bg-ora-error/20 px-4 py-2.5 text-sm text-red-200">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div>
                <label
                  htmlFor="name"
                  className="mb-1.5 block text-xs font-medium text-white/70"
                >
                  Full Name
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  className="h-11 w-full border border-white/15 bg-white/10 px-4 text-sm text-white placeholder:text-white/40 backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold/60"
                />
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-xs font-medium text-white/70"
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
                  className="h-11 w-full border border-white/15 bg-white/10 px-4 text-sm text-white placeholder:text-white/40 backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold/60"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-xs font-medium text-white/70"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="h-11 w-full border border-white/15 bg-white/10 px-4 text-sm text-white placeholder:text-white/40 backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold/60"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="h-11 w-full bg-ora-gold text-sm font-semibold text-white transition-all hover:bg-ora-gold-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating account…' : 'Create Account'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
