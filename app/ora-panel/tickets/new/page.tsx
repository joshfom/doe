'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useCreateTicket,
  useTicketCategories,
  useCommunities,
  useProjects,
} from '@/lib/cms/hooks';
import { ChevronRight, ArrowLeft } from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const;

const REQUEST_TYPES = [
  { value: 'general_inquiry', label: 'General inquiry' },
  { value: 'noc', label: 'NOC' },
  { value: 'move_in', label: 'Move-in' },
  { value: 'move_out', label: 'Move-out' },
  { value: 'gate_pass', label: 'Gate pass' },
  { value: 'technician_visit', label: 'Technician visit' },
  { value: 'construction_material_delivery', label: 'Construction material delivery' },
  { value: 'vendor_access', label: 'Vendor access' },
  { value: 'maintenance_request', label: 'Maintenance request' },
] as const;

// ── Validation helpers ───────────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

interface FormErrors {
  subject?: string;
  description?: string;
  contactName?: string;
  contactEmail?: string;
  priority?: string;
}

function validateForm(fields: {
  subject: string;
  description: string;
  contactName: string;
  contactEmail: string;
}): FormErrors {
  const errors: FormErrors = {};

  if (!fields.subject.trim()) {
    errors.subject = 'Subject is required';
  }
  if (!fields.description.trim()) {
    errors.description = 'Description is required';
  }
  if (!fields.contactName.trim()) {
    errors.contactName = 'Contact name is required';
  }
  if (!fields.contactEmail.trim()) {
    errors.contactEmail = 'Contact email is required';
  } else if (!isValidEmail(fields.contactEmail.trim())) {
    errors.contactEmail = 'Invalid email format';
  }

  return errors;
}

// ── Page Component ───────────────────────────────────────────────────────────

export default function NewTicketPage() {
  const router = useRouter();
  const createTicket = useCreateTicket();
  const { data: categories } = useTicketCategories();

  // Form state
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [priority, setPriority] = useState('medium');
  const [category, setCategory] = useState('');
  const [requestType, setRequestType] = useState('general_inquiry');
  const [communityId, setCommunityId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [unitNumber, setUnitNumber] = useState('');

  const { data: communities } = useCommunities();
  const { data: projects } = useProjects(
    communityId ? { communityId } : undefined
  );

  // Validation state
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);

    const validationErrors = validateForm({
      subject,
      description,
      contactName,
      contactEmail,
    });

    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    try {
      const result = await createTicket.mutateAsync({
        subject: subject.trim(),
        description: description.trim(),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim() || undefined,
        priority,
        category: category || undefined,
        source: 'manual',
        requestType,
        communityId: communityId || null,
        projectId: projectId || null,
        unitNumber: unitNumber.trim() || null,
      });
      router.push(`/ora-panel/tickets/${result.ticketId}`);
    } catch {
      // error handled by mutation state
    }
  };

  // Re-validate on change if the form has been submitted once
  const handleFieldChange = (
    field: keyof FormErrors,
    value: string,
    setter: (v: string) => void
  ) => {
    setter(value);
    if (submitted) {
      const updated = { subject, description, contactName, contactEmail, [field]: value };
      const newErrors = validateForm(updated);
      setErrors((prev) => ({ ...prev, [field]: newErrors[field] }));
    }
  };

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/tickets" className="hover:text-ora-charcoal transition-colors">
          Tickets
        </Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">New Ticket</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/ora-panel/tickets"
          className="inline-flex h-8 w-8 items-center justify-center text-ora-muted hover:text-ora-charcoal transition-colors"
        >
          <ArrowLeft className="h-4 w-4 stroke-1" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">New Ticket</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">
            Create a new support ticket for a lead or customer inquiry
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Subject */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                Subject <span className="text-ora-error">*</span>
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => handleFieldChange('subject', e.target.value, setSubject)}
                placeholder="Brief summary of the inquiry"
                className={`h-10 w-full border bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none ${
                  errors.subject ? 'border-ora-error' : 'border-ora-stone'
                }`}
              />
              {errors.subject && (
                <p className="mt-1 text-xs text-ora-error">{errors.subject}</p>
              )}
            </div>

            {/* Description */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                Description <span className="text-ora-error">*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => handleFieldChange('description', e.target.value, setDescription)}
                placeholder="Detailed description of the issue or inquiry…"
                rows={6}
                className={`w-full border bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none resize-y ${
                  errors.description ? 'border-ora-error' : 'border-ora-stone'
                }`}
              />
              {errors.description && (
                <p className="mt-1 text-xs text-ora-error">{errors.description}</p>
              )}
            </div>

            {/* Contact Information */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <h2 className="mb-4 text-sm font-semibold text-ora-charcoal">Contact Information</h2>
              <div className="space-y-4">
                {/* Contact Name */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                    Name <span className="text-ora-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) =>
                      handleFieldChange('contactName', e.target.value, setContactName)
                    }
                    placeholder="Contact's full name"
                    className={`h-10 w-full border bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none ${
                      errors.contactName ? 'border-ora-error' : 'border-ora-stone'
                    }`}
                  />
                  {errors.contactName && (
                    <p className="mt-1 text-xs text-ora-error">{errors.contactName}</p>
                  )}
                </div>

                {/* Contact Email */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                    Email <span className="text-ora-error">*</span>
                  </label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) =>
                      handleFieldChange('contactEmail', e.target.value, setContactEmail)
                    }
                    placeholder="contact@example.com"
                    className={`h-10 w-full border bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none ${
                      errors.contactEmail ? 'border-ora-error' : 'border-ora-stone'
                    }`}
                  />
                  {errors.contactEmail && (
                    <p className="mt-1 text-xs text-ora-error">{errors.contactEmail}</p>
                  )}
                </div>

                {/* Contact Phone (optional) */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                    Phone <span className="text-xs text-ora-muted">(optional)</span>
                  </label>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Priority */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Category */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              >
                <option value="">No category</option>
                {categories?.map((cat) => (
                  <option key={cat.id} value={cat.name}>
                    {cat.displayName}
                  </option>
                ))}
              </select>
            </div>

            {/* Request type */}
            <div className="border border-ora-sand/60 bg-ora-white p-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                  Request type
                </label>
                <select
                  value={requestType}
                  onChange={(e) => setRequestType(e.target.value)}
                  className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                >
                  {REQUEST_TYPES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {requestType !== 'general_inquiry' && (
                  <p className="mt-2 text-[11px] text-ora-muted">
                    Structured fields (e.g. NOC dates, gate-pass visitor) can be filled in on the next screen.
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                  Community
                </label>
                <select
                  value={communityId}
                  onChange={(e) => {
                    setCommunityId(e.target.value);
                    setProjectId('');
                  }}
                  className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                >
                  <option value="">— None —</option>
                  {communities?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameEn}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                  Project
                </label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={!communityId}
                  className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none disabled:opacity-50"
                >
                  <option value="">— None —</option>
                  {projects?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nameEn}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                  Unit number
                </label>
                <input
                  type="text"
                  value={unitNumber}
                  onChange={(e) => setUnitNumber(e.target.value)}
                  placeholder="e.g. A-1204"
                  className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                />
              </div>
            </div>

            {/* Submit */}
            <div className="space-y-3">
              {createTicket.isError && (
                <p className="text-sm text-ora-error">
                  Failed to create ticket. Please try again.
                </p>
              )}
              <button
                type="submit"
                disabled={createTicket.isPending}
                className="h-10 w-full bg-ora-charcoal text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
              >
                {createTicket.isPending ? 'Creating…' : 'Create Ticket'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
