import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewInboxPanel, BatchActivityLog } from './components';
import type { QueueItemRow, BatchActivityEntry } from './types';

// ── UI component tests (task 10.5) ────────────────────────────────────────────
//
// Presentational coverage for the Approval Queue / Review Inbox panel and the
// persisted Agent_Activity_Log fallback. Both components are pure props + callbacks
// — no fetching lives here — so the tests drive them with fixtures + spy callbacks,
// matching the existing UI test pattern (`_home/HomeChat.test.tsx`): vitest globals
// + @testing-library/react under the jsdom environment configured in
// `vitest.config.ts`.
//
// Covers: Req 4.1 (present draft + fit + lawful-basis), Req 4.3 (approve), Req 4.4
// (reject), Req 5.1 (bulk approve), and the activity-feed fallback rendering
// (error banner per Req 3.6, persisted entries, onView).

// fitScore arrives as a numeric-column STRING over the wire, never a number.
function makeItem(overrides: Partial<QueueItemRow> = {}): QueueItemRow {
  return {
    id: 'q1',
    batchRunId: 'run-1',
    targetId: 't1',
    draftId: 'd1',
    eligibility: 'cold_eligible',
    fitScore: '0.82',
    fitRationale: {
      score: 0.82,
      signals: [
        { dimension: 'titles', weight: 0.5, similarity: 0.9, expected: ['Founder'], matched: ['Founder'] },
      ],
      summary: 'Strong title + geography overlap with the cluster ICP.',
    },
    lawfulBasis: 'GDPR legitimate-interest',
    dataSource: 'apollo',
    acquiredAt: '2026-01-10T00:00:00.000Z',
    status: 'pending',
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    draftSubject: 'An opportunity at Palm Jumeirah',
    draftBody: 'Hello, I wanted to reach out about a cluster that fits your portfolio.',
    draftChannel: 'email',
    draftLanguage: 'en',
    draftStatus: 'draft',
    targetType: 'person',
    targetDisplayName: 'Jane Investor',
    targetCompanyName: 'Acme Capital',
    targetTitle: 'Managing Partner',
    targetEmail: 'jane@example.com',
    targetPhoneHash: 'hash-abc',
    targetCountry: 'AE',
    targetStatus: 'new',
    ...overrides,
  };
}

function makeActivityEntry(overrides: Partial<BatchActivityEntry> = {}): BatchActivityEntry {
  return {
    id: 'a1',
    batchRunId: 'run-1',
    seq: 1,
    action: 'discovered',
    reason: 'candidate_found',
    targetId: 't1',
    payload: null,
    at: '2026-01-10T08:30:00.000Z',
    ...overrides,
  };
}

const noop = () => {};

function renderInbox(props: Partial<React.ComponentProps<typeof ReviewInboxPanel>> = {}) {
  const defaults: React.ComponentProps<typeof ReviewInboxPanel> = {
    items: [makeItem()],
    selectedIds: new Set<string>(),
    busyId: null,
    bulkBusy: false,
    onToggleSelect: noop,
    onToggleAll: noop,
    onEdit: noop,
    onApprove: noop,
    onReject: noop,
    onBulkApprove: noop,
  };
  return render(<ReviewInboxPanel {...defaults} {...props} />);
}

describe('ReviewInboxPanel', () => {
  it('renders each queue item with its draft content, fit score, and lawful-basis provenance (Req 4.1)', () => {
    renderInbox({ items: [makeItem()] });

    // Prospect + draft content.
    expect(screen.getByText('Jane Investor')).toBeDefined();
    expect(
      (screen.getByDisplayValue('An opportunity at Palm Jumeirah') as HTMLInputElement).value
    ).toBe('An opportunity at Palm Jumeirah');
    expect(screen.getByDisplayValue(/wanted to reach out/i)).toBeDefined();

    // Fit score rendered as a rounded percentage ("0.82" → 82%).
    expect(screen.getByText(/82% fit/i)).toBeDefined();

    // Lawful-basis provenance (CC-Provenance / Req 10.1).
    expect(screen.getByText('GDPR legitimate-interest')).toBeDefined();
    expect(screen.getByText(/via apollo/i)).toBeDefined();
  });

  it('renders the empty state when there are no items', () => {
    renderInbox({ items: [] });
    expect(screen.getByText(/No drafts awaiting review/i)).toBeDefined();
  });

  it('fires onApprove with the item id when Approve & send is clicked (Req 4.3)', () => {
    const onApprove = vi.fn();
    renderInbox({ items: [makeItem({ id: 'q-approve' })], onApprove });

    fireEvent.click(screen.getByRole('button', { name: /approve & send/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith('q-approve');
  });

  it('fires onReject with the item id when Reject is clicked (Req 4.4)', () => {
    const onReject = vi.fn();
    renderInbox({ items: [makeItem({ id: 'q-reject' })], onReject });

    fireEvent.click(screen.getByRole('button', { name: /^reject$/i }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith('q-reject');
  });

  it('fires onToggleSelect with the item id when the row checkbox is clicked', () => {
    const onToggleSelect = vi.fn();
    renderInbox({ items: [makeItem({ id: 'q-sel' })], onToggleSelect });

    fireEvent.click(screen.getByRole('button', { name: /select item/i }));
    expect(onToggleSelect).toHaveBeenCalledWith('q-sel');
  });

  it('fires onBulkApprove when items are selected and Bulk approve is clicked (Req 5.1)', () => {
    const onBulkApprove = vi.fn();
    const item = makeItem({ id: 'q-bulk' });
    renderInbox({
      items: [item],
      selectedIds: new Set(['q-bulk']),
      onBulkApprove,
    });

    const bulkBtn = screen.getByRole('button', { name: /bulk approve/i });
    expect((bulkBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(bulkBtn);
    expect(onBulkApprove).toHaveBeenCalledTimes(1);
  });

  it('disables Bulk approve when nothing is selected (Req 5.1 guardrail)', () => {
    renderInbox({ items: [makeItem()], selectedIds: new Set<string>() });
    const bulkBtn = screen.getByRole('button', { name: /bulk approve/i });
    expect((bulkBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('fires onEdit with the edited subject + body after the draft is changed (Req 4.2)', () => {
    const onEdit = vi.fn();
    renderInbox({ items: [makeItem({ id: 'q-edit' })], onEdit });

    const body = screen.getByDisplayValue(/wanted to reach out/i) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: 'Edited body content.' } });

    fireEvent.click(screen.getByRole('button', { name: /save edits/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(
      'q-edit',
      'An opportunity at Palm Jumeirah',
      'Edited body content.'
    );
  });
});

function renderActivity(props: Partial<React.ComponentProps<typeof BatchActivityLog>> = {}) {
  const defaults: React.ComponentProps<typeof BatchActivityLog> = {
    runId: 'run-1',
    entries: [],
    busy: false,
    error: null,
    loaded: false,
    onView: noop,
  };
  return render(<BatchActivityLog {...defaults} {...props} />);
}

describe('BatchActivityLog', () => {
  it('renders the persisted entries once loaded', () => {
    renderActivity({
      loaded: true,
      entries: [
        makeActivityEntry({ id: 'a1', seq: 1, action: 'discovered', reason: 'candidate_found' }),
        makeActivityEntry({ id: 'a2', seq: 2, action: 'skipped', reason: 'already_in_salesforce' }),
      ],
    });

    // Action chips + humanised reasons (underscores stripped) are shown.
    expect(screen.getByText('Discovered')).toBeDefined();
    expect(screen.getByText('Skipped')).toBeDefined();
    expect(screen.getByText('candidate found')).toBeDefined();
    expect(screen.getByText('already in salesforce')).toBeDefined();
  });

  it('renders an explicit error banner on a retrieval failure, not an empty success (Req 3.6)', () => {
    renderActivity({
      loaded: true,
      entries: [],
      error: 'activity log unavailable: upstream 500',
    });

    expect(screen.getByText(/Could not retrieve the activity log/i)).toBeDefined();
    expect(screen.getByText(/activity log unavailable: upstream 500/i)).toBeDefined();
    // The empty-success message must NOT be shown when there is an error.
    expect(screen.queryByText(/No activity recorded for this run yet/i)).toBeNull();
  });

  it('fires onView with the run id when the view button is clicked', () => {
    const onView = vi.fn();
    renderActivity({ runId: 'run-42', onView });

    fireEvent.click(screen.getByRole('button', { name: /view activity log/i }));
    expect(onView).toHaveBeenCalledTimes(1);
    expect(onView).toHaveBeenCalledWith('run-42');
  });
});
