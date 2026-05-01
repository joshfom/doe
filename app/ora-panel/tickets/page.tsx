'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useTickets, useTicketCategories, useUsers } from '@/lib/cms/hooks';
import type { TicketFilters } from '@/lib/cms/hooks';
import {
  REQUEST_TYPES,
  REQUEST_TYPE_LABELS,
} from '@/lib/cms/tickets/request-types';
import {
  Search,
  Plus,
  Ticket,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

const STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'closed'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const SOURCES = ['manual', 'api', 'form'] as const;
const PAGE_SIZE = 20;

// Quick-filter chips for the most operational request types
const QUICK_REQUEST_TYPES: Array<{ value: string; label: string }> = [
  { value: 'noc', label: 'NOC' },
  { value: 'move_in', label: 'Move-in' },
  { value: 'gate_pass', label: 'Gate pass' },
  { value: 'technician_visit', label: 'Technician' },
  { value: 'construction_material_delivery', label: 'Construction' },
  { value: 'vendor_access', label: 'Vendor access' },
  { value: 'maintenance_request', label: 'Maintenance' },
];

// ── Status badge styling ─────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-ora-success/10 text-ora-success',
  assigned: 'bg-ora-info/10 text-ora-info',
  in_progress: 'bg-ora-warning/10 text-ora-warning',
  resolved: 'bg-ora-gold/10 text-ora-gold-dark',
  closed: 'bg-ora-sand text-ora-charcoal-light',
};

const PRIORITY_STYLES: Record<string, string> = {
  low: 'bg-ora-sand text-ora-charcoal-light',
  medium: 'bg-ora-info/10 text-ora-info',
  high: 'bg-ora-warning/10 text-ora-warning',
  urgent: 'bg-ora-error/10 text-ora-error',
};

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ── Page Component ───────────────────────────────────────────────────────────

export default function TicketListingPage() {
  // Filter state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [requestTypeFilter, setRequestTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  // Build filters object
  const filters: TicketFilters = useMemo(() => {
    const f: TicketFilters = { page, pageSize: PAGE_SIZE };
    if (search) f.search = search;
    if (statusFilter) f.status = statusFilter;
    if (priorityFilter) f.priority = priorityFilter;
    if (categoryFilter) f.category = categoryFilter;
    if (assigneeFilter) f.assigneeId = assigneeFilter;
    if (sourceFilter) f.source = sourceFilter;
    if (requestTypeFilter) f.requestType = requestTypeFilter;
    if (dateFrom) f.dateFrom = dateFrom;
    if (dateTo) f.dateTo = dateTo;
    return f;
  }, [search, statusFilter, priorityFilter, categoryFilter, assigneeFilter, sourceFilter, requestTypeFilter, dateFrom, dateTo, page]);

  // Data fetching
  const { data, isLoading } = useTickets(filters);
  const { data: categories } = useTicketCategories();
  const { data: users } = useUsers();

  const ticketList = data?.data ?? [];
  const total = data?.total ?? 0;
  const statusCounts = data?.statusCounts ?? {};
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Build a user lookup for assignee names
  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    if (users) {
      for (const u of users) {
        map.set(u.id, u.name);
      }
    }
    return map;
  }, [users]);

  // Reset page when filters change
  const handleFilterChange = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Tickets</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">
            Manage support tickets and inquiries
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/ora-panel/tickets/approvals"
            className="inline-flex h-10 items-center gap-2 border border-ora-sand bg-ora-white px-4 text-sm text-ora-charcoal hover:bg-ora-cream transition-colors"
          >
            Pending approvals
          </Link>
          <Link
            href="/ora-panel/tickets/new"
            className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
          >
            <Plus className="h-4 w-4 stroke-1" />
            New Ticket
          </Link>
        </div>
      </div>

      {/* Status count summary badges */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const c = statusCounts[s] ?? 0;
          const isActive = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => handleFilterChange(setStatusFilter)(isActive ? '' : s)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-ora-charcoal text-white'
                  : STATUS_STYLES[s] ?? 'bg-ora-sand text-ora-charcoal-light'
              }`}
            >
              {formatStatus(s)}
              <span className={`inline-flex h-5 min-w-5 items-center justify-center px-1 text-[10px] font-bold ${
                isActive ? 'bg-ora-white/20 text-white' : 'bg-ora-charcoal/10 text-inherit'
              }`}>
                {c}
              </span>
            </button>
          );
        })}
      </div>

      {/* Request-type quick-filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-ora-muted">
          Type
        </span>
        <button
          onClick={() => handleFilterChange(setRequestTypeFilter)('')}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            requestTypeFilter === ''
              ? 'bg-ora-charcoal text-white'
              : 'bg-ora-sand text-ora-charcoal-light hover:bg-ora-cream'
          }`}
        >
          All
        </button>
        {QUICK_REQUEST_TYPES.map((t) => {
          const isActive = requestTypeFilter === t.value;
          return (
            <button
              key={t.value}
              onClick={() =>
                handleFilterChange(setRequestTypeFilter)(isActive ? '' : t.value)
              }
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-ora-gold text-ora-charcoal'
                  : 'bg-ora-sand/60 text-ora-charcoal-light hover:bg-ora-cream'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Search and filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        {/* Search bar */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-1 text-ora-muted" />
          <input
            type="text"
            placeholder="Search by ticket #, subject, contact name or email…"
            value={search}
            onChange={(e) => handleFilterChange(setSearch)(e.target.value)}
            className="h-10 w-full border border-ora-stone bg-ora-white pl-10 pr-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
        </div>

        {/* Priority filter */}
        <select
          value={priorityFilter}
          onChange={(e) => handleFilterChange(setPriorityFilter)(e.target.value)}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>

        {/* Category filter */}
        <select
          value={categoryFilter}
          onChange={(e) => handleFilterChange(setCategoryFilter)(e.target.value)}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All categories</option>
          {categories?.map((cat) => (
            <option key={cat.id} value={cat.name}>
              {cat.displayName}
            </option>
          ))}
        </select>

        {/* Assignee filter */}
        <select
          value={assigneeFilter}
          onChange={(e) => handleFilterChange(setAssigneeFilter)(e.target.value)}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All assignees</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>

        {/* Source filter */}
        <select
          value={sourceFilter}
          onChange={(e) => handleFilterChange(setSourceFilter)(e.target.value)}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        {/* Request-type filter (full enum, mirrors quick chips) */}
        <select
          value={requestTypeFilter}
          onChange={(e) => handleFilterChange(setRequestTypeFilter)(e.target.value)}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All request types</option>
          {REQUEST_TYPES.map((rt) => (
            <option key={rt} value={rt}>
              {REQUEST_TYPE_LABELS[rt]}
            </option>
          ))}
        </select>
      </div>

      {/* Date range filters */}
      <div className="mb-4 flex gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-ora-charcoal-light">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => handleFilterChange(setDateFrom)(e.target.value)}
            className="h-10 border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-ora-charcoal-light">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => handleFilterChange(setDateTo)(e.target.value)}
            className="h-10 border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
        </div>
      </div>

      {/* Ticket list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 animate-pulse bg-ora-sand/60" />
          ))}
        </div>
      ) : ticketList.length === 0 ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
          <Ticket className="mx-auto mb-3 h-10 w-10 stroke-1 text-ora-muted" />
          <p className="text-sm text-ora-muted">No tickets found</p>
        </div>
      ) : (
        <>
          {/* Table header */}
          <div className="hidden border border-ora-sand/60 bg-ora-cream px-4 py-2.5 text-xs font-medium text-ora-charcoal-light md:grid md:grid-cols-[120px_1fr_100px_80px_100px_120px_100px]">
            <span>Ticket #</span>
            <span>Subject</span>
            <span>Status</span>
            <span>Priority</span>
            <span>Category</span>
            <span>Assignee</span>
            <span>Created</span>
          </div>

          {/* Table rows */}
          <div className="space-y-0">
            {ticketList.map((ticket) => (
              <Link
                key={ticket.id}
                href={`/ora-panel/tickets/${ticket.id}`}
                className="flex flex-col gap-2 border border-t-0 border-ora-sand/60 bg-ora-white px-4 py-3 transition-colors hover:bg-ora-cream-light md:grid md:grid-cols-[120px_1fr_100px_80px_100px_120px_100px] md:items-center md:gap-4 first:border-t"
              >
                {/* Ticket number */}
                <span className="text-xs font-mono text-ora-charcoal">
                  {ticket.ticketNumber}
                </span>

                {/* Subject */}
                <span className="flex items-center gap-2 truncate text-sm text-ora-charcoal">
                  {ticket.requestType && ticket.requestType !== 'general_inquiry' && (
                    <span className="shrink-0 bg-ora-gold/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ora-gold-dark">
                      {REQUEST_TYPE_LABELS[
                        ticket.requestType as keyof typeof REQUEST_TYPE_LABELS
                      ] ?? ticket.requestType}
                    </span>
                  )}
                  <span className="truncate">{ticket.subject}</span>
                </span>

                {/* Status */}
                <span>
                  <span
                    className={`inline-block rounded-full px-3 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[ticket.status] ?? 'bg-ora-sand text-ora-charcoal-light'
                    }`}
                  >
                    {formatStatus(ticket.status)}
                  </span>
                </span>

                {/* Priority */}
                <span>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      PRIORITY_STYLES[ticket.priority] ?? 'bg-ora-sand text-ora-charcoal-light'
                    }`}
                  >
                    {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
                  </span>
                </span>

                {/* Category */}
                <span className="text-xs text-ora-charcoal-light truncate">
                  {ticket.category ?? '—'}
                </span>

                {/* Assignee */}
                <span className="text-xs text-ora-charcoal-light truncate">
                  {ticket.assigneeId ? (userMap.get(ticket.assigneeId) ?? ticket.assigneeId.slice(0, 8) + '…') : '—'}
                </span>

                {/* Created date */}
                <span className="text-xs text-ora-muted">
                  {formatDate(ticket.createdAt)}
                </span>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-ora-muted">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} tickets
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex h-9 w-9 items-center justify-center border border-ora-sand bg-ora-white text-ora-charcoal transition-colors hover:bg-ora-cream-light disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4 stroke-1" />
              </button>
              <span className="inline-flex h-9 items-center px-3 text-xs text-ora-charcoal-light">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="inline-flex h-9 w-9 items-center justify-center border border-ora-sand bg-ora-white text-ora-charcoal transition-colors hover:bg-ora-cream-light disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="h-4 w-4 stroke-1" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
