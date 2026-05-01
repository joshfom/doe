'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { ChevronRight, Save } from 'lucide-react';

export default function NewClientPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [nationality, setNationality] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'ar'>('en');
  const [notes, setNotes] = useState('');

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch('/api/ai/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to create client');
        return r.json();
      }),
    onSuccess: () => router.push('/ora-panel/ai/clients'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;
    create.mutate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      nationality: nationality.trim() || undefined,
      preferredLanguage,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div>
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">Dashboard</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/ai/clients" className="hover:text-ora-charcoal transition-colors">AI Clients</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">New Client</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">New Client</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">Add a new client record</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <div className="border border-ora-sand/60 bg-ora-white p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">First Name</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Last Name</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Phone</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971…" className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Nationality</label>
              <input type="text" value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="e.g. UAE" className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Preferred Language</label>
              <select value={preferredLanguage} onChange={(e) => setPreferredLanguage(e.target.value as 'en' | 'ar')} className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none">
                <option value="en">English</option>
                <option value="ar">Arabic</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional notes…" className="w-full border border-ora-stone bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none resize-y" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {create.isError && <p className="text-sm text-ora-error">Failed to create client.</p>}
          <button type="submit" disabled={create.isPending || !firstName.trim() || !lastName.trim()} className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50">
            <Save className="h-3.5 w-3.5 stroke-1" />
            {create.isPending ? 'Creating…' : 'Create Client'}
          </button>
        </div>
      </form>
    </div>
  );
}
