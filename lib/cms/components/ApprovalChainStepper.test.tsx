import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApprovalChainStepper, ChainStep, ChainDecision } from './ApprovalChainStepper';

// ── Test Data ────────────────────────────────────────────────────────────────

const threeStepChain: ChainStep[] = [
  { userId: 'user-1', userName: 'Alice Johnson', position: 1 },
  { userId: 'user-2', userName: 'Bob Smith', position: 2 },
  { userId: 'user-3', userName: 'Charlie Brown', position: 3 },
];

function makeDecision(overrides: Partial<ChainDecision> = {}): ChainDecision {
  return {
    chainStep: 1,
    approverId: 'user-1',
    approverName: 'Alice Johnson',
    decision: 'approved',
    comment: null,
    createdAt: '2025-01-15T10:30:00Z',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ApprovalChainStepper', () => {
  // ── Completed steps show green checkmark with approver name and timestamp ──

  describe('completed steps', () => {
    it('shows green checkmark icon for completed steps', () => {
      const decisions: ChainDecision[] = [
        makeDecision({ chainStep: 1, approverName: 'Alice Johnson', createdAt: '2025-01-15T10:30:00Z' }),
      ];

      const { container } = render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={decisions}
          currentStep={2}
          totalSteps={3}
          requestStatus="pending"
        />
      );

      // Completed step should have green checkmark container
      const greenIcons = container.querySelectorAll('.bg-green-100.text-green-600');
      expect(greenIcons.length).toBe(1);
    });

    it('shows actual approver name for completed steps', () => {
      const decisions: ChainDecision[] = [
        makeDecision({ chainStep: 1, approverId: 'user-99', approverName: 'Delegate Dave', createdAt: '2025-01-15T10:30:00Z' }),
      ];

      render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={decisions}
          currentStep={2}
          totalSteps={3}
          requestStatus="pending"
        />
      );

      // Should show the actual approver (Delegate Dave), not the nominal approver (Alice Johnson)
      expect(screen.getByText('Delegate Dave')).toBeDefined();
    });

    it('shows timestamp for completed steps', () => {
      const decisions: ChainDecision[] = [
        makeDecision({ chainStep: 1, createdAt: '2025-01-15T10:30:00Z' }),
      ];

      render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={decisions}
          currentStep={2}
          totalSteps={3}
          requestStatus="pending"
        />
      );

      // Should show "Approved" with a formatted timestamp
      const approvedText = screen.getByText(/Approved/);
      expect(approvedText).toBeDefined();
      expect(approvedText.textContent).toContain('Jan');
      expect(approvedText.textContent).toContain('2025');
    });

    it('shows all steps as completed when request is fully approved', () => {
      const decisions: ChainDecision[] = [
        makeDecision({ chainStep: 1, approverName: 'Alice Johnson', createdAt: '2025-01-14T09:00:00Z' }),
        makeDecision({ chainStep: 2, approverId: 'user-2', approverName: 'Bob Smith', createdAt: '2025-01-15T10:00:00Z' }),
        makeDecision({ chainStep: 3, approverId: 'user-3', approverName: 'Charlie Brown', createdAt: '2025-01-16T11:00:00Z' }),
      ];

      const { container } = render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={decisions}
          currentStep={3}
          totalSteps={3}
          requestStatus="approved"
        />
      );

      // All three steps should have green checkmark
      const greenIcons = container.querySelectorAll('.bg-green-100.text-green-600');
      expect(greenIcons.length).toBe(3);
    });
  });

  // ── Active step shows highlighted state with nominal approver ──

  describe('active step', () => {
    it('shows highlighted/pulsing icon for the active step', () => {
      const { container } = render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={[]}
          currentStep={1}
          totalSteps={3}
          requestStatus="pending"
        />
      );

      // Active step should have the pulsing border with ora-gold styling
      const activeIcons = container.querySelectorAll('.border-ora-gold.animate-pulse');
      expect(activeIcons.length).toBe(1);
    });

    it('shows nominal approver name for the active step', () => {
      render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={[]}
          currentStep={2}
          totalSteps={3}
          requestStatus="pending"
        />
      );

      // Active step (position 2) should show the nominal approver "Bob Smith"
      expect(screen.getByText('Bob Smith')).toBeDefined();
    });

    it('shows "Awaiting review" text for the active step', () => {
      render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={[]}
          currentStep={1}
          totalSteps={3}
          requestStatus="pending"
        />
      );

      expect(screen.getByText('Awaiting review')).toBeDefined();
    });
  });

  // ── Future steps show greyed out state ──

  describe('future steps', () => {
    it('shows greyed out icons for future steps', () => {
      const { container } = render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={[]}
          currentStep={1}
          totalSteps={3}
          requestStatus="pending"
        />
      );

      // Future steps (positions 2 and 3) should have greyed out styling
      const greyedIcons = container.querySelectorAll('.bg-ora-sand\\/40.text-ora-muted');
      expect(greyedIcons.length).toBe(2);
    });

    it('shows nominal approver names for future steps in muted text', () => {
      const { container } = render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={[]}
          currentStep={1}
          totalSteps={3}
          requestStatus="pending"
        />
      );

      // Future step approver names should have muted text color
      const mutedNames = container.querySelectorAll('p.text-ora-muted');
      expect(mutedNames.length).toBe(2); // Bob Smith and Charlie Brown
    });

    it('does not show "Awaiting review" for future steps', () => {
      render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={[]}
          currentStep={1}
          totalSteps={3}
          requestStatus="pending"
        />
      );

      // Only one "Awaiting review" should exist (for the active step)
      const awaitingElements = screen.getAllByText('Awaiting review');
      expect(awaitingElements.length).toBe(1);
    });
  });

  // ── Rejected step shows red X with reason ──

  describe('rejected step', () => {
    it('shows red X icon for the rejected step', () => {
      const decisions: ChainDecision[] = [
        makeDecision({ chainStep: 1, approverName: 'Alice Johnson', createdAt: '2025-01-14T09:00:00Z' }),
        makeDecision({ chainStep: 2, approverId: 'user-2', approverName: 'Bob Smith', decision: 'rejected', comment: 'Content needs revision', createdAt: '2025-01-15T10:00:00Z' }),
      ];

      const { container } = render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={decisions}
          currentStep={2}
          totalSteps={3}
          requestStatus="rejected"
        />
      );

      // Rejected step should have red X icon container
      const redIcons = container.querySelectorAll('.bg-red-100.text-red-600');
      expect(redIcons.length).toBe(1);
    });

    it('shows rejection reason for the rejected step', () => {
      const decisions: ChainDecision[] = [
        makeDecision({ chainStep: 1, approverName: 'Alice Johnson', createdAt: '2025-01-14T09:00:00Z' }),
        makeDecision({ chainStep: 2, approverId: 'user-2', approverName: 'Bob Smith', decision: 'rejected', comment: 'Content needs revision', createdAt: '2025-01-15T10:00:00Z' }),
      ];

      render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={decisions}
          currentStep={2}
          totalSteps={3}
          requestStatus="rejected"
        />
      );

      // Should show the rejection reason
      expect(screen.getByText(/Content needs revision/)).toBeDefined();
    });

    it('shows rejecting employee name for the rejected step', () => {
      const decisions: ChainDecision[] = [
        makeDecision({ chainStep: 2, approverId: 'user-2', approverName: 'Bob Smith', decision: 'rejected', comment: 'Not ready', createdAt: '2025-01-15T10:00:00Z' }),
      ];

      render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={decisions}
          currentStep={2}
          totalSteps={3}
          requestStatus="rejected"
        />
      );

      // Should show "Rejected by Bob Smith"
      expect(screen.getByText(/Rejected by Bob Smith/)).toBeDefined();
    });
  });

  // ── Skipped steps after rejection show greyed with strikethrough ──

  describe('skipped steps after rejection', () => {
    it('shows greyed out icons for skipped steps', () => {
      const decisions: ChainDecision[] = [
        makeDecision({ chainStep: 1, approverName: 'Alice Johnson', createdAt: '2025-01-14T09:00:00Z' }),
        makeDecision({ chainStep: 2, approverId: 'user-2', approverName: 'Bob Smith', decision: 'rejected', comment: 'Rejected', createdAt: '2025-01-15T10:00:00Z' }),
      ];

      const { container } = render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={decisions}
          currentStep={2}
          totalSteps={3}
          requestStatus="rejected"
        />
      );

      // Step 3 (skipped) should have greyed out icon
      const greyedIcons = container.querySelectorAll('.bg-ora-sand\\/40.text-ora-muted');
      expect(greyedIcons.length).toBe(1); // Only step 3 is skipped
    });

    it('shows strikethrough text for skipped step names', () => {
      const decisions: ChainDecision[] = [
        makeDecision({ chainStep: 1, approverName: 'Alice Johnson', createdAt: '2025-01-14T09:00:00Z' }),
        makeDecision({ chainStep: 2, approverId: 'user-2', approverName: 'Bob Smith', decision: 'rejected', comment: 'Rejected', createdAt: '2025-01-15T10:00:00Z' }),
      ];

      const { container } = render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={decisions}
          currentStep={2}
          totalSteps={3}
          requestStatus="rejected"
        />
      );

      // Skipped step should have line-through class on the approver name
      const strikethroughNames = container.querySelectorAll('p.line-through');
      expect(strikethroughNames.length).toBe(1);
      expect(strikethroughNames[0].textContent).toBe('Charlie Brown');
    });

    it('shows strikethrough on step label for skipped steps', () => {
      const decisions: ChainDecision[] = [
        makeDecision({ chainStep: 1, approverName: 'Alice Johnson', createdAt: '2025-01-14T09:00:00Z' }),
        makeDecision({ chainStep: 2, approverId: 'user-2', approverName: 'Bob Smith', decision: 'rejected', comment: 'Rejected', createdAt: '2025-01-15T10:00:00Z' }),
      ];

      const { container } = render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={decisions}
          currentStep={2}
          totalSteps={3}
          requestStatus="rejected"
        />
      );

      // Skipped step label ("Step 3") should have line-through
      const strikethroughLabels = container.querySelectorAll('span.line-through');
      expect(strikethroughLabels.length).toBe(1);
      expect(strikethroughLabels[0].textContent).toBe('Step 3');
    });
  });

  // ── Accessibility ──

  describe('accessibility', () => {
    it('renders with role="list" and aria-label', () => {
      render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={[]}
          currentStep={1}
          totalSteps={3}
          requestStatus="pending"
        />
      );

      const list = screen.getByRole('list', { name: 'Approval chain progress' });
      expect(list).toBeDefined();
    });

    it('renders each step as a listitem', () => {
      render(
        <ApprovalChainStepper
          chain={threeStepChain}
          decisions={[]}
          currentStep={1}
          totalSteps={3}
          requestStatus="pending"
        />
      );

      const items = screen.getAllByRole('listitem');
      expect(items.length).toBe(3);
    });
  });
});
