import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgentAvailability } from './useAgentAvailability';

// Focused hook test for the Agent_Availability_Check → Degraded_Mode decision
// (Req 11.1, 11.2, 11.3, 11.6). The pure decision lives in `degrade.ts` (task
// 2.1, property-tested there); this verifies the hook applies it to the probe
// it gathers from `GET /api/home/health`.

function okHealth(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  });
}

describe('useAgentAvailability', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is not degraded when the probe reports available within the timeout', async () => {
    vi.stubGlobal('fetch', okHealth({ available: true, latencyMs: 12 }));
    const { result } = renderHook(() => useAgentAvailability());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.degraded).toBe(false);
  });

  it('degrades when the probe reports unavailable (Req 11.2)', async () => {
    vi.stubGlobal('fetch', okHealth({ available: false, latencyMs: 5 }));
    const { result } = renderHook(() => useAgentAvailability());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.degraded).toBe(true);
  });

  it('degrades when the health request rejects / is unreachable (Req 11.2/11.3)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')));
    const { result } = renderHook(() => useAgentAvailability());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.degraded).toBe(true);
  });

  it('degrades when the health endpoint returns a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({}),
      })
    );
    const { result } = renderHook(() => useAgentAvailability());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.degraded).toBe(true);
  });
});
