'use client';

import { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X, ChevronDown, ArrowDown } from 'lucide-react';
import {
  reorderPositions,
  removeAndRenumber,
  appendApprover,
  type PositionedApprover,
} from '@/lib/cms/approval/positions';

// ── Types ────────────────────────────────────────────────────────────────────

export interface OrderedApproverListProps {
  users: { id: string; name: string; email: string }[];
  orderedApprovers: { userId: string; position: number }[];
  onChange: (approvers: { userId: string; position: number }[]) => void;
}

// ── Sortable Approver Card ───────────────────────────────────────────────────

function SortableApproverCard({
  approver,
  index,
  user,
  onRemove,
}: {
  approver: PositionedApprover;
  index: number;
  user: { id: string; name: string; email: string } | undefined;
  onRemove: (index: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: approver.userId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 border border-ora-sand/60 bg-ora-white p-3 transition-colors ${
        isDragging ? 'shadow-ora-md z-10' : ''
      }`}
    >
      {/* Position number */}
      <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-ora-charcoal text-[11px] font-bold text-ora-white">
        {approver.position}
      </span>

      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab text-ora-muted hover:text-ora-charcoal-light"
        aria-label={`Drag to reorder ${user?.name ?? 'approver'}`}
      >
        <GripVertical className="h-4 w-4 stroke-1" />
      </button>

      {/* Approver info */}
      <div className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ora-charcoal truncate">
          {user?.name ?? 'Unknown User'}
        </span>
        <span className="block text-xs text-ora-muted truncate">
          {user?.email ?? ''}
        </span>
      </div>

      {/* Remove button */}
      <button
        type="button"
        onClick={() => onRemove(index)}
        aria-label={`Remove ${user?.name ?? 'approver'}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center text-ora-muted hover:bg-ora-error/10 hover:text-ora-error transition-colors"
      >
        <X className="h-3.5 w-3.5 stroke-1" />
      </button>
    </div>
  );
}

// ── Flow Arrow ───────────────────────────────────────────────────────────────

function FlowArrow() {
  return (
    <div className="flex items-center justify-center py-0.5">
      <ArrowDown className="h-4 w-4 text-ora-gold" />
    </div>
  );
}

// ── Add Approver Dropdown ────────────────────────────────────────────────────

function AddApproverDropdown({
  availableUsers,
  onAdd,
}: {
  availableUsers: { id: string; name: string; email: string }[];
  onAdd: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center justify-between border border-dashed border-ora-stone bg-ora-cream-light px-4 text-sm text-ora-charcoal-light hover:border-ora-gold hover:text-ora-charcoal transition-colors focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
      >
        <span>Add approver to chain…</span>
        <ChevronDown
          className={`h-4 w-4 stroke-1 text-ora-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-full border border-ora-sand bg-ora-white shadow-ora-md max-h-48 overflow-y-auto">
          {availableUsers.length === 0 ? (
            <div className="px-4 py-3 text-xs text-ora-muted">
              No more users available
            </div>
          ) : (
            availableUsers.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => {
                  onAdd(user.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-ora-charcoal hover:bg-ora-cream-light transition-colors"
              >
                <span className="font-medium">{user.name}</span>
                <span className="text-xs text-ora-muted">{user.email}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function OrderedApproverList({
  users,
  orderedApprovers,
  onChange,
}: OrderedApproverListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const userMap = new Map(users.map((u) => [u.id, u]));

  // Users not already in the chain
  const availableUsers = users.filter(
    (u) => !orderedApprovers.some((a) => a.userId === u.id)
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const fromIndex = orderedApprovers.findIndex((a) => a.userId === active.id);
      const toIndex = orderedApprovers.findIndex((a) => a.userId === over.id);
      if (fromIndex === -1 || toIndex === -1) return;

      const reordered = reorderPositions(orderedApprovers, fromIndex, toIndex);
      onChange(reordered);
    },
    [orderedApprovers, onChange]
  );

  const handleRemove = useCallback(
    (index: number) => {
      const updated = removeAndRenumber(orderedApprovers, index);
      onChange(updated);
    },
    [orderedApprovers, onChange]
  );

  const handleAdd = useCallback(
    (userId: string) => {
      const updated = appendApprover(orderedApprovers, userId);
      onChange(updated);
    },
    [orderedApprovers, onChange]
  );

  return (
    <div>
      {orderedApprovers.length === 0 ? (
        <p className="text-xs text-ora-muted py-2">
          No approvers configured. Add approvers below to define the approval chain.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={orderedApprovers.map((a) => a.userId)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-0">
              {orderedApprovers.map((approver, index) => (
                <div key={approver.userId}>
                  <SortableApproverCard
                    approver={approver}
                    index={index}
                    user={userMap.get(approver.userId)}
                    onRemove={handleRemove}
                  />
                  {/* Flow arrow between cards (not after the last one) */}
                  {index < orderedApprovers.length - 1 && <FlowArrow />}
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add approver dropdown */}
      <AddApproverDropdown availableUsers={availableUsers} onAdd={handleAdd} />
    </div>
  );
}
