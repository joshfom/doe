import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';

// ── Sequences UI component tests (task 8.5) ──────────────────────────────────
//
// Coverage for the new Sequences Index + Detail/Builder pages and the lifecycle
// gating helper. The pages auth-gate + fetch on mount, so `global.fetch` is
// routed by URL to fixtures and `next/navigation` / `next/link` are mocked. The
// shared Review_Inbox rendering of person/company/intermediary items is asserted
// through the Detail page's inbox (it reuses `ReviewInboxPanel`).
//
// Covers: Req 6.2 (index required fields), 6.4 (link to detail), 7.1/7.4 (detail
// config/enrolled/inbox/activity), 7.2/12.3 (lifecycle controls allowed by the
// state machine), 12.1 (consistent person/company/intermediary inbox rendering).

import type { QueueItemRow, SequenceDetail, SequenceRow } from './types';

// ── Module mocks (hoisted before the page imports) ───────────────────────────
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), id: 'seq-1' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => ({ id: nav.id }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import SequencesIndexPage, { SequenceStatusBadge } from './page';
import SequenceDetailPage, { allowedActions } from './[id]/page';

const SESSION = {
  ok: true,
  json: async () => ({ data: { userId: 'rep-1', permissions: ['leads:read'], roles: [] } }),
};

function jsonRes(body: unknown) {
  return { ok: true, json: async () => body };
}

/** Route `global.fetch` by URL to the supplied fixtures. */
function installFetch(routes: Record<string, unknown>) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/auth/session')) return SESSION as unknown as Response;
    for (const [frag, body] of Object.entries(routes)) {
      if (url.includes(frag)) return jsonRes(body) as unknown as Response;
    }
    return jsonRes({}) as unknown as Response;
  }) as typeof fetch;
}

function makeSeqRow(overrides: Partial<SequenceRow> = {}): SequenceRow {
  return {
    id: 'seq-1',
    ownerRep: 'rep-1',
    name: 'Palm villas — UHNW',
    description: 'High-end villa buyers',
    subject: { kind: 'cluster', clusterId: 'c1' },
    targetCount: 10,
    mode: 'live',
    status: 'live',
    refreshIntervalMinutes: 1440,
    lastRefreshedAt: '2026-03-01T09:00:00.000Z',
    nextRefreshAt: '2026-03-02T09:00:00.000Z',
    enrollmentCap: 200,
    enrollmentPeriod: 'month',
    archivedAt: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-03-01T09:00:00.000Z',
    enrolledProspects: 7,
    pendingProspects: 3,
    ...overrides,
  };
}

function makeQueueItem(
  type: 'person' | 'company' | 'intermediary',
  id: string
): QueueItemRow {
  return {
    id,
    batchRunId: 'run-1',
    targetId: `t-${id}`,
    draftId: `d-${id}`,
    eligibility: 'cold_eligible',
    fitScore: '0.8',
    fitRationale: null,
    lawfulBasis: 'legitimate_interest',
    dataSource: 'apollo',
    acquiredAt: '2026-01-10T00:00:00.000Z',
    status: 'pending',
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    draftSubject: `Subject ${id}`,
    draftBody: `Body ${id}`,
    draftChannel: 'email',
    draftLanguage: 'en',
    draftStatus: 'draft',
    targetType: type,
    targetDisplayName: type === 'person' ? `Person ${id}` : null,
    targetCompanyName: type === 'person' ? null : `Company ${id}`,
    targetTitle: type === 'intermediary' ? 'Broker' : 'Investor',
    targetEmail: `c-${id}@example.com`,
    targetPhoneHash: `hash-${id}`,
    targetCountry: 'AE',
    targetStatus: 'new',
  };
}

function makeDetail(overrides: Partial<SequenceDetail> = {}): SequenceDetail {
  return {
    sequence: makeSeqRow({ status: 'draft', mode: 'draft', lastRefreshedAt: null }),
    count: 3,
    queueItems: [
      makeQueueItem('person', 'q1'),
      makeQueueItem('company', 'q2'),
      makeQueueItem('intermediary', 'q3'),
    ],
    enrolledProspects: [
      {
        id: 'e1',
        targetId: 't-q1',
        batchRunId: 'run-1',
        periodBucket: '2026-03',
        createdAt: '2026-03-01T00:00:00.000Z',
        targetType: 'person',
        targetDisplayName: 'Jane Investor',
        targetCompanyName: 'Acme Capital',
        targetTitle: 'Partner',
        targetEmail: 'jane@example.com',
        targetPhoneHash: 'hash-e1',
        targetCountry: 'AE',
        targetStatus: 'new',
      },
    ],
    enrolledCount: 1,
    activity: [
      {
        id: 'a1',
        batchRunId: 'run-1',
        seq: 1,
        action: 'discovered',
        reason: null,
        targetId: null,
        payload: { candidates: 5 },
        at: '2026-03-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('allowedActions — lifecycle gating (mirrors applyTransition)', () => {
  it('a draft can publish or archive', () => {
    expect(allowedActions('draft')).toEqual(['publish', 'archive']);
  });
  it('a live sequence can pause or archive', () => {
    expect(allowedActions('live')).toEqual(['pause', 'archive']);
  });
  it('a paused sequence can resume or archive', () => {
    expect(allowedActions('paused')).toEqual(['resume', 'archive']);
  });
  it('an archived sequence is terminal (no actions)', () => {
    expect(allowedActions('archived')).toEqual([]);
  });
});

describe('SequenceStatusBadge', () => {
  it('renders each lifecycle status label', () => {
    const { rerender } = render(<SequenceStatusBadge status="draft" />);
    expect(screen.getByText('Draft')).toBeTruthy();
    rerender(<SequenceStatusBadge status="live" />);
    expect(screen.getByText('Live')).toBeTruthy();
    rerender(<SequenceStatusBadge status="paused" />);
    expect(screen.getByText('Paused')).toBeTruthy();
    rerender(<SequenceStatusBadge status="archived" />);
    expect(screen.getByText('Archived')).toBeTruthy();
  });
});

describe('Sequences Index page', () => {
  beforeEach(() => {
    installFetch({
      '/prospecting/sequences': {
        count: 2,
        sequences: [
          makeSeqRow({ id: 'seq-1', name: 'Palm villas — UHNW', status: 'live' }),
          makeSeqRow({
            id: 'seq-2',
            name: 'Marina apartments',
            status: 'draft',
            lastRefreshedAt: null,
            enrolledProspects: 0,
            pendingProspects: 0,
          }),
        ],
      },
    });
  });

  it('renders each sequence with name, status, counts, and a link to its detail (Req 6.2, 6.4)', async () => {
    render(<SequencesIndexPage />);

    const list = await screen.findByTestId('sequence-list');
    expect(within(list).getByText('Palm villas — UHNW')).toBeTruthy();
    expect(within(list).getByText('Marina apartments')).toBeTruthy();
    expect(within(list).getByText('Live')).toBeTruthy();
    expect(within(list).getByText('Draft')).toBeTruthy();

    // Each row links to its detail page (Req 6.4).
    const links = within(list).getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/ora-panel/prospecting/sequences/seq-1');
    expect(hrefs).toContain('/ora-panel/prospecting/sequences/seq-2');
  });

  it('shows an em dash for a never-refreshed sequence (Req 6.5)', async () => {
    render(<SequencesIndexPage />);
    const list = await screen.findByTestId('sequence-list');
    // The draft sequence (seq-2) was never refreshed → em dash present.
    expect(within(list).getByText('—')).toBeTruthy();
  });
});

describe('Sequence Detail page', () => {
  beforeEach(() => {
    nav.id = 'seq-1';
    installFetch({
      '/prospecting/sequences/seq-1': makeDetail(),
      '/prospecting/own-catalog': { communities: [], projects: [], clusters: [] },
    });
  });

  it('renders the config, enrolled, inbox and activity sections (Req 7.1, 7.4)', async () => {
    render(<SequenceDetailPage />);

    expect(await screen.findByTestId('config-section')).toBeTruthy();
    expect(screen.getByTestId('enrolled-section')).toBeTruthy();
    expect(screen.getByText('Review inbox')).toBeTruthy();
    expect(screen.getByText('Activity log')).toBeTruthy();

    // Enrolled prospect rendered.
    const enrolled = screen.getByTestId('enrolled-section');
    expect(within(enrolled).getByText('Jane Investor')).toBeTruthy();
  });

  it('shows only the lifecycle controls the state machine allows for a draft (Req 7.2, 12.3)', async () => {
    render(<SequenceDetailPage />);
    const controls = await screen.findByTestId('lifecycle-controls');
    // draft → publish | archive (no pause/resume).
    expect(within(controls).getByText('Publish')).toBeTruthy();
    expect(within(controls).getByText('Archive')).toBeTruthy();
    expect(within(controls).queryByText('Pause')).toBeNull();
    expect(within(controls).queryByText('Resume')).toBeNull();
  });

  it('renders person, company and intermediary inbox items consistently (Req 12.1)', async () => {
    render(<SequenceDetailPage />);
    // Wait for detail load, then assert all three target-type drafts render.
    await screen.findByTestId('config-section');
    await waitFor(() => {
      expect(screen.getAllByText('Person q1').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Company q2').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Company q3').length).toBeGreaterThan(0);
    });
  });
});
