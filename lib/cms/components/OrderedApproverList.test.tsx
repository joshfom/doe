import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrderedApproverList } from './OrderedApproverList';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock @dnd-kit/core — provide DndContext as a passthrough wrapper
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div data-testid="dnd-context">{children}</div>,
  closestCenter: vi.fn(),
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

// Mock @dnd-kit/sortable — useSortable returns no-op values, SortableContext is passthrough
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div data-testid="sortable-context">{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: 'vertical',
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => undefined,
    },
  },
}));

// ── Test Data ────────────────────────────────────────────────────────────────

const mockUsers = [
  { id: 'user-1', name: 'Alice Johnson', email: 'alice@example.com' },
  { id: 'user-2', name: 'Bob Smith', email: 'bob@example.com' },
  { id: 'user-3', name: 'Charlie Brown', email: 'charlie@example.com' },
  { id: 'user-4', name: 'Diana Prince', email: 'diana@example.com' },
];

const threeApprovers = [
  { userId: 'user-1', position: 1 },
  { userId: 'user-2', position: 2 },
  { userId: 'user-3', position: 3 },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OrderedApproverList', () => {
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onChange = vi.fn();
  });

  // 1. Position numbers render correctly
  describe('position numbers render correctly', () => {
    it('displays position badges 1, 2, 3 for three approvers', () => {
      render(
        <OrderedApproverList
          users={mockUsers}
          orderedApprovers={threeApprovers}
          onChange={onChange}
        />
      );

      // Position badges should show 1, 2, 3
      expect(screen.getByText('1')).toBeDefined();
      expect(screen.getByText('2')).toBeDefined();
      expect(screen.getByText('3')).toBeDefined();
    });

    it('displays approver names alongside positions', () => {
      render(
        <OrderedApproverList
          users={mockUsers}
          orderedApprovers={threeApprovers}
          onChange={onChange}
        />
      );

      expect(screen.getByText('Alice Johnson')).toBeDefined();
      expect(screen.getByText('Bob Smith')).toBeDefined();
      expect(screen.getByText('Charlie Brown')).toBeDefined();
    });
  });

  // 2. Remove from middle re-numbers remaining approvers
  describe('remove from middle re-numbers remaining', () => {
    it('calls onChange with re-numbered positions when middle approver is removed', () => {
      render(
        <OrderedApproverList
          users={mockUsers}
          orderedApprovers={threeApprovers}
          onChange={onChange}
        />
      );

      // Click remove button for Bob Smith (index 1, the middle approver)
      const removeButton = screen.getByLabelText('Remove Bob Smith');
      fireEvent.click(removeButton);

      // onChange should be called with re-numbered positions: Alice=1, Charlie=2
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([
        { userId: 'user-1', position: 1 },
        { userId: 'user-3', position: 2 },
      ]);
    });
  });

  // 3. Flow arrows render between approver cards
  describe('flow arrows render between cards', () => {
    it('renders N-1 arrow elements for N approvers', () => {
      const { container } = render(
        <OrderedApproverList
          users={mockUsers}
          orderedApprovers={threeApprovers}
          onChange={onChange}
        />
      );

      // ArrowDown icons are rendered as SVG elements between cards
      // The FlowArrow component wraps an ArrowDown icon in a div with specific classes
      const arrowContainers = container.querySelectorAll('.flex.items-center.justify-center.py-0\\.5');
      expect(arrowContainers.length).toBe(2); // 3 approvers = 2 arrows between them
    });

    it('does not render an arrow after the last approver', () => {
      const { container } = render(
        <OrderedApproverList
          users={mockUsers}
          orderedApprovers={[{ userId: 'user-1', position: 1 }]}
          onChange={onChange}
        />
      );

      const arrowContainers = container.querySelectorAll('.flex.items-center.justify-center.py-0\\.5');
      expect(arrowContainers.length).toBe(0); // 1 approver = 0 arrows
    });
  });

  // 4. Add approver appends to end
  describe('add approver appends to end', () => {
    it('calls onChange with new approver at position N+1 when added', () => {
      render(
        <OrderedApproverList
          users={mockUsers}
          orderedApprovers={threeApprovers}
          onChange={onChange}
        />
      );

      // Open the add dropdown
      const addButton = screen.getByText('Add approver to chain…');
      fireEvent.click(addButton);

      // Diana Prince should be available (not already in chain)
      const dianaOption = screen.getByText('Diana Prince');
      fireEvent.click(dianaOption);

      // onChange should be called with Diana appended at position 4
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([
        { userId: 'user-1', position: 1 },
        { userId: 'user-2', position: 2 },
        { userId: 'user-3', position: 3 },
        { userId: 'user-4', position: 4 },
      ]);
    });
  });

  // 5. Empty state shows message
  describe('empty state shows message', () => {
    it('displays empty state message when no approvers are configured', () => {
      render(
        <OrderedApproverList
          users={mockUsers}
          orderedApprovers={[]}
          onChange={onChange}
        />
      );

      expect(
        screen.getByText('No approvers configured. Add approvers below to define the approval chain.')
      ).toBeDefined();
    });

    it('does not render DndContext when there are no approvers', () => {
      const { queryByTestId } = render(
        <OrderedApproverList
          users={mockUsers}
          orderedApprovers={[]}
          onChange={onChange}
        />
      );

      expect(queryByTestId('dnd-context')).toBeNull();
    });
  });
});
