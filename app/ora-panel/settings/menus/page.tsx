'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  useMenus,
  useMenu,
  useCreateMenu,
  useUpdateMenu,
  useDeleteMenu,
  useCreateMenuItem,
  useUpdateMenuItem,
  useDeleteMenuItem,
  useReorderMenuItems,
  useSetActiveMenu,
} from '@/lib/cms/hooks/use-menus';
import { useSiteSettings, useUpdateSettings, settingsKeys } from '@/lib/cms/hooks';
import type { MenuItemTree, ItemType } from '@/lib/cms/types';
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
import {
  Plus,
  Trash2,
  GripVertical,
  Pencil,
  Star,
  X,
  Check,
  ChevronRight,
  Save,
} from 'lucide-react';
import { SlideOverSheet } from '@/lib/cms/components/SlideOverSheet';

// ── Flatten tree ────────────────────────────────────────────────────────────

interface FlatItem {
  id: string;
  item: MenuItemTree;
  depth: number;
}

function flattenTree(items: MenuItemTree[], depth = 0): FlatItem[] {
  const result: FlatItem[] = [];
  for (const item of items) {
    result.push({ id: item.id, item, depth });
    if (item.children?.length) {
      result.push(...flattenTree(item.children, depth + 1));
    }
  }
  return result;
}

/** Collect all dropdown-type items that can be parents (for the "Parent" selector) */
function getParentOptions(items: MenuItemTree[], prefix = ''): { id: string; label: string }[] {
  const result: { id: string; label: string }[] = [];
  for (const item of items) {
    if (item.itemType === 'dropdown') {
      result.push({ id: item.id, label: prefix + item.label });
      if (item.children?.length) {
        result.push(...getParentOptions(item.children, prefix + '— '));
      }
    }
  }
  return result;
}

// ── Sortable Tree Item ──────────────────────────────────────────────────────

function SortableTreeItem({
  flatItem,
  isSelected,
  onSelect,
  onDelete,
  confirmingDeleteId,
  setConfirmingDeleteId,
}: {
  flatItem: FlatItem;
  isSelected: boolean;
  onSelect: (item: MenuItemTree) => void;
  onDelete: (itemId: string) => void;
  confirmingDeleteId: string | null;
  setConfirmingDeleteId: (id: string | null) => void;
}) {
  const { item, depth } = flatItem;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isConfirming = confirmingDeleteId === item.id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 border border-ora-sand/60 bg-ora-white p-3 transition-colors ${
        isSelected ? 'ring-1 ring-ora-gold' : ''
      }`}
    >
      {depth > 0 && (
        <div style={{ width: depth * 24 }} className="shrink-0 flex items-center justify-end pr-1">
          <ChevronRight className="h-3 w-3 text-ora-muted" />
        </div>
      )}

      <button
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab text-ora-muted hover:text-ora-charcoal-light"
      >
        <GripVertical className="h-4 w-4 stroke-1" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ora-charcoal truncate">
            {item.label}
          </span>
          <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
            item.itemType === 'dropdown'
              ? 'bg-ora-info/10 text-ora-info'
              : 'bg-ora-sand text-ora-charcoal-light'
          }`}>
            {item.itemType}
          </span>
        </div>
        {item.url && item.url !== '#' && (
          <p className="text-xs text-ora-muted font-mono truncate">{item.url}</p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onSelect(item)}
          className="flex h-8 w-8 items-center justify-center text-ora-charcoal-light hover:bg-ora-cream-light transition-colors"
          title="Edit item"
        >
          <Pencil className="h-3.5 w-3.5 stroke-1" />
        </button>
        {isConfirming ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                onDelete(item.id);
                setConfirmingDeleteId(null);
              }}
              className="flex h-8 w-8 items-center justify-center bg-ora-error/10 text-ora-error hover:bg-ora-error/20 transition-colors"
              title="Confirm delete"
            >
              <Check className="h-3.5 w-3.5 stroke-1" />
            </button>
            <button
              onClick={() => setConfirmingDeleteId(null)}
              className="flex h-8 w-8 items-center justify-center text-ora-charcoal-light hover:bg-ora-cream-light transition-colors"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5 stroke-1" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingDeleteId(item.id)}
            className="flex h-8 w-8 items-center justify-center text-ora-charcoal-light hover:bg-ora-error/10 hover:text-ora-error transition-colors"
            title="Delete item"
          >
            <Trash2 className="h-3.5 w-3.5 stroke-1" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Item Editor Panel ───────────────────────────────────────────────────────

// ── Menu Item Sheet (create + edit in a slide-over panel) ───────────────────

function MenuItemSheet({
  menuId,
  item,
  parentOptions,
  open,
  onClose,
}: {
  menuId: string;
  /** If provided, we're editing; otherwise we're creating. */
  item: MenuItemTree | null;
  parentOptions: { id: string; label: string }[];
  open: boolean;
  onClose: () => void;
}) {
  const createItem = useCreateMenuItem();
  const updateItem = useUpdateMenuItem();

  const [label, setLabel] = useState('');
  const [labelAr, setLabelAr] = useState('');
  const [url, setUrl] = useState('');
  const [icon, setIcon] = useState('');
  const [itemType, setItemType] = useState<ItemType>('link');
  const [parentId, setParentId] = useState<string>('');

  // Reset form when item changes or sheet opens
  useEffect(() => {
    if (open) {
      if (item) {
        setLabel(item.label);
        setLabelAr(item.translations?.ar ?? '');
        setUrl(item.url);
        setIcon(item.icon ?? '');
        setItemType(item.itemType);
        setParentId(item.parentId ?? '');
      } else {
        setLabel('');
        setLabelAr('');
        setUrl('');
        setIcon('');
        setItemType('link');
        setParentId('');
      }
    }
  }, [open, item]);

  const isEditing = !!item;
  const isPending = createItem.isPending || updateItem.isPending;

  const handleSave = () => {
    if (!label.trim()) return;

    const translations: Record<string, string> = {};
    if (labelAr.trim()) translations.ar = labelAr.trim();
    const translationsPayload = Object.keys(translations).length > 0 ? translations : null;

    if (isEditing) {
      updateItem.mutate(
        {
          menuId,
          itemId: item.id,
          label: label.trim(),
          url: url.trim() || '#',
          icon: icon || undefined,
          itemType,
          translations: translationsPayload,
        },
        { onSuccess: onClose }
      );
    } else {
      createItem.mutate(
        {
          menuId,
          label: label.trim(),
          url: url.trim() || '#',
          itemType,
          parentId: parentId || null,
          translations: translationsPayload,
        },
        { onSuccess: onClose }
      );
    }
  };

  return (
    <SlideOverSheet
      open={open}
      onClose={onClose}
      title={isEditing ? 'Edit Menu Item' : 'Add Menu Item'}
    >
      <div className="space-y-6">
        {/* Labels section */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-ora-charcoal border-b border-ora-sand/60 pb-2 w-full">Labels &amp; Translations</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-ora-charcoal-light">Label (English) *</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Menu item label"
                className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ora-charcoal-light">Label (العربية)</label>
              <input
                type="text"
                dir="rtl"
                value={labelAr}
                onChange={(e) => setLabelAr(e.target.value)}
                placeholder="الترجمة العربية"
                className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              />
            </div>
          </div>
        </fieldset>

        {/* URL & Icon */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-ora-charcoal border-b border-ora-sand/60 pb-2 w-full">Link &amp; Display</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-ora-charcoal-light">URL</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="/page or https://..."
                className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ora-charcoal-light">Icon (Lucide name)</label>
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="e.g. Home, Star"
                className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              />
            </div>
          </div>
        </fieldset>

        {/* Type & Parent */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-ora-charcoal border-b border-ora-sand/60 pb-2 w-full">Behaviour</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-ora-charcoal-light">Item Type</label>
              <select
                value={itemType}
                onChange={(e) => setItemType(e.target.value as ItemType)}
                className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              >
                <option value="link">Link</option>
                <option value="dropdown">Dropdown</option>
              </select>
            </div>
            {!isEditing && (
              <div>
                <label className="mb-1 block text-xs font-medium text-ora-charcoal-light">Parent (for sub-items)</label>
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                >
                  <option value="">— Root level —</option>
                  {parentOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </fieldset>

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t border-ora-sand/60">
          <button
            onClick={handleSave}
            disabled={isPending || !label.trim()}
            className="h-10 bg-ora-charcoal px-8 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
          >
            {isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Item'}
          </button>
          <button
            onClick={onClose}
            className="h-10 border border-ora-sand bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </SlideOverSheet>
  );
}

// ── CTA Settings Panel ──────────────────────────────────────────────────────

function CtaSettingsPanel() {
  const { data: settings, isLoading } = useSiteSettings();
  const updateSettings = useUpdateSettings();
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [ctaLabelAr, setCtaLabelAr] = useState('');
  const [ctaUrlAr, setCtaUrlAr] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      const map: Record<string, string> = {};
      for (const entry of settings) {
        map[entry.key] = entry.value;
      }
      setCtaLabel(map.nav_cta_label ?? '');
      setCtaUrl(map.nav_cta_url ?? '');
      setCtaLabelAr(map.nav_cta_label_ar ?? '');
      setCtaUrlAr(map.nav_cta_url_ar ?? '');
    }
  }, [settings]);

  const handleSave = async () => {
    setSaved(false);
    const current: Record<string, string> = {};
    if (settings) {
      for (const entry of settings) {
        current[entry.key] = entry.value;
      }
    }
    current.nav_cta_label = ctaLabel;
    current.nav_cta_url = ctaUrl;
    current.nav_cta_label_ar = ctaLabelAr;
    current.nav_cta_url_ar = ctaUrlAr;
    await updateSettings.mutateAsync(current);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (isLoading) return null;

  return (
    <div className="border border-ora-sand/60 bg-ora-white p-4">
      <h3 className="mb-3 text-sm font-medium text-ora-charcoal">Navigation CTA Button</h3>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-ora-charcoal-light">CTA Label (English)</label>
          <input type="text" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="e.g. Register Interest" className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ora-charcoal-light">CTA URL (English)</label>
          <input type="text" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="#register-interest or /page" className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
        </div>
        <div className="border-t border-ora-sand/40 pt-3">
          <label className="mb-1 block text-xs font-medium text-ora-charcoal-light">CTA Label (العربية)</label>
          <input type="text" dir="rtl" value={ctaLabelAr} onChange={(e) => setCtaLabelAr(e.target.value)} placeholder="e.g. سجل اهتمامك" className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ora-charcoal-light">CTA URL (العربية)</label>
          <input type="text" dir="rtl" value={ctaUrlAr} onChange={(e) => setCtaUrlAr(e.target.value)} placeholder="#register-interest or /ar/page" className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
        </div>
        <button onClick={handleSave} disabled={updateSettings.isPending} className="inline-flex h-9 items-center gap-2 bg-ora-charcoal px-4 text-xs text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50">
          <Save className="h-3.5 w-3.5 stroke-1" />
          {updateSettings.isPending ? 'Saving…' : saved ? 'Saved!' : 'Save CTA'}
        </button>
        <p className="text-[11px] text-ora-muted">Use <code className="bg-ora-cream px-1">#register-interest</code> as URL to open the Register Interest dialog.</p>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function MenuBuilderPage() {
  const { data: menus, isLoading: menusLoading } = useMenus();
  const { data: settings } = useSiteSettings();
  const createMenu = useCreateMenu();
  const updateMenu = useUpdateMenu();
  const deleteMenu = useDeleteMenu();
  const setActiveMenu = useSetActiveMenu();
  const deleteMenuItem = useDeleteMenuItem();
  const reorderItems = useReorderMenuItems();

  // Derive active menu ID from site settings
  const activeMenuId = useMemo(() => {
    if (!settings) return null;
    const entry = settings.find((s) => s.key === 'active_menu_id');
    return entry?.value ?? null;
  }, [settings]);

  const [selectedMenuId, setSelectedMenuId] = useState<string>('');
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuLocale, setNewMenuLocale] = useState('en');
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [editingMenuName, setEditingMenuName] = useState('');
  const [confirmDeleteMenuId, setConfirmDeleteMenuId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<MenuItemTree | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmingDeleteItemId, setConfirmingDeleteItemId] = useState<string | null>(null);

  const effectiveMenuId = selectedMenuId || (menus?.[0]?.id ?? '');
  const { data: menuData, isLoading: menuLoading } = useMenu(effectiveMenuId);

  const flatItems = useMemo(
    () => (menuData?.items ? flattenTree(menuData.items) : []),
    [menuData?.items]
  );

  const parentOptions = useMemo(
    () => (menuData?.items ? getParentOptions(menuData.items) : []),
    [menuData?.items]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleCreateMenu = () => {
    if (!newMenuName.trim()) return;
    createMenu.mutate(
      { name: newMenuName.trim(), locale: newMenuLocale },
      {
        onSuccess: (data: any) => {
          setNewMenuName('');
          setNewMenuLocale('en');
          if (data?.id) setSelectedMenuId(data.id);
        },
      }
    );
  };

  const handleUpdateMenuName = (id: string) => {
    if (!editingMenuName.trim()) return;
    updateMenu.mutate(
      { id, name: editingMenuName.trim() },
      { onSuccess: () => setEditingMenuId(null) }
    );
  };

  const handleDeleteMenu = (id: string) => {
    deleteMenu.mutate(id, {
      onSuccess: () => {
        setConfirmDeleteMenuId(null);
        if (selectedMenuId === id) setSelectedMenuId('');
      },
    });
  };

  const handleSetActive = (menuId: string) => {
    setActiveMenu.mutate({ menuId });
  };

  const handleDeleteItem = (itemId: string) => {
    if (!effectiveMenuId) return;
    deleteMenuItem.mutate({ menuId: effectiveMenuId, itemId });
  };

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !effectiveMenuId || !flatItems.length) return;

      const oldIndex = flatItems.findIndex((f) => f.id === active.id);
      const newIndex = flatItems.findIndex((f) => f.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...flatItems];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      const items = reordered.map((f, idx) => ({
        id: f.id,
        position: idx,
        parentId: f.item.parentId,
      }));

      reorderItems.mutate({ menuId: effectiveMenuId, items });
    },
    [effectiveMenuId, flatItems, reorderItems]
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">Menus</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">
          Build navigation menus, set the active menu, and configure the CTA button
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-4">
          {/* Create menu */}
          <div className="border border-ora-sand/60 bg-ora-white p-4">
            <h3 className="mb-3 text-sm font-medium text-ora-charcoal">Create Menu</h3>
            <div className="flex gap-2">
              <input type="text" value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} placeholder="Menu name" onKeyDown={(e) => e.key === 'Enter' && handleCreateMenu()} className="h-10 flex-1 border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
              <select value={newMenuLocale} onChange={(e) => setNewMenuLocale(e.target.value)} className="h-10 w-20 border border-ora-stone bg-ora-white px-2 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none">
                <option value="en">EN</option>
                <option value="ar">AR</option>
              </select>
              <button onClick={handleCreateMenu} disabled={createMenu.isPending || !newMenuName.trim()} className="h-10 bg-ora-charcoal px-4 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50">
                <Plus className="h-4 w-4 stroke-1" />
              </button>
            </div>
          </div>

          {/* Menu list */}
          <div className="border border-ora-sand/60 bg-ora-white">
            <div className="border-b border-ora-sand px-4 py-3">
              <h3 className="text-sm font-medium text-ora-charcoal">All Menus</h3>
            </div>
            {menusLoading ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 animate-pulse bg-ora-sand/60" />
                ))}
              </div>
            ) : !menus?.length ? (
              <div className="p-8 text-center">
                <p className="text-sm text-ora-muted">No menus yet</p>
              </div>
            ) : (
              <div className="divide-y divide-ora-sand/40">
                {menus.map((menu) => {
                  const isSelected = menu.id === effectiveMenuId;
                  const isEditing = editingMenuId === menu.id;
                  const isConfirmingDelete = confirmDeleteMenuId === menu.id;

                  return (
                    <div
                      key={menu.id}
                      className={`flex items-center gap-2 px-4 py-3 transition-colors cursor-pointer ${isSelected ? 'bg-ora-cream' : 'hover:bg-ora-cream-light'}`}
                      onClick={() => {
                        if (!isEditing && !isConfirmingDelete) {
                          setSelectedMenuId(menu.id);
                          setSelectedItem(null);
                        }
                      }}
                    >
                      {isEditing ? (
                        <div className="flex flex-1 gap-2" onClick={(e) => e.stopPropagation()}>
                          <input type="text" value={editingMenuName} onChange={(e) => setEditingMenuName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateMenuName(menu.id); if (e.key === 'Escape') setEditingMenuId(null); }} autoFocus className="h-8 flex-1 border border-ora-stone bg-ora-white px-2 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
                          <button onClick={() => handleUpdateMenuName(menu.id)} className="flex h-8 w-8 items-center justify-center text-ora-success hover:bg-ora-success/10 transition-colors"><Check className="h-3.5 w-3.5 stroke-1" /></button>
                          <button onClick={() => setEditingMenuId(null)} className="flex h-8 w-8 items-center justify-center text-ora-charcoal-light hover:bg-ora-cream-light transition-colors"><X className="h-3.5 w-3.5 stroke-1" /></button>
                        </div>
                      ) : (
                        <>
                          <span className="flex-1 text-sm text-ora-charcoal truncate">
                            {menu.name}
                            <span className={`ml-2 inline-block px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                              menu.locale === 'ar' ? 'bg-ora-info/10 text-ora-info' : 'bg-ora-sand text-ora-charcoal-light'
                            }`}>
                              {menu.locale || 'en'}
                            </span>
                          </span>
                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => handleSetActive(menu.id)} className={`flex h-8 w-8 items-center justify-center transition-colors ${activeMenuId === menu.id ? 'text-ora-gold' : setActiveMenu.isPending ? 'opacity-50 text-ora-muted' : 'text-ora-muted hover:text-ora-gold'}`} title={activeMenuId === menu.id ? 'Active menu' : 'Set as active menu'}><Star className={`h-3.5 w-3.5 ${activeMenuId === menu.id ? 'fill-ora-gold stroke-ora-gold' : 'stroke-1'}`} /></button>
                            <button onClick={() => { setEditingMenuId(menu.id); setEditingMenuName(menu.name); }} className="flex h-8 w-8 items-center justify-center text-ora-charcoal-light hover:bg-ora-cream-light transition-colors" title="Edit name"><Pencil className="h-3.5 w-3.5 stroke-1" /></button>
                            {isConfirmingDelete ? (
                              <div className="flex items-center gap-1">
                                <button onClick={() => handleDeleteMenu(menu.id)} className="flex h-8 w-8 items-center justify-center bg-ora-error/10 text-ora-error hover:bg-ora-error/20 transition-colors" title="Confirm delete"><Check className="h-3.5 w-3.5 stroke-1" /></button>
                                <button onClick={() => setConfirmDeleteMenuId(null)} className="flex h-8 w-8 items-center justify-center text-ora-charcoal-light hover:bg-ora-cream-light transition-colors" title="Cancel"><X className="h-3.5 w-3.5 stroke-1" /></button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmDeleteMenuId(menu.id)} className="flex h-8 w-8 items-center justify-center text-ora-charcoal-light hover:bg-ora-error/10 hover:text-ora-error transition-colors" title="Delete menu"><Trash2 className="h-3.5 w-3.5 stroke-1" /></button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* CTA Settings */}
          <CtaSettingsPanel />
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-4">
          {effectiveMenuId ? (
            <>
              <div className="border border-ora-sand/60 bg-ora-white">
                <div className="border-b border-ora-sand px-4 py-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-ora-charcoal">
                    Menu Items
                    {menuData && <span className="ml-2 text-xs text-ora-muted">({flatItems.length} items)</span>}
                  </h3>
                  <button
                    onClick={() => { setSelectedItem(null); setSheetOpen(true); }}
                    className="inline-flex h-8 items-center gap-1.5 bg-ora-charcoal px-3 text-xs text-ora-white hover:bg-ora-graphite transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5 stroke-1" />
                    Add Item
                  </button>
                </div>

                {menuLoading ? (
                  <div className="space-y-2 p-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-12 animate-pulse bg-ora-sand/60" />
                    ))}
                  </div>
                ) : !flatItems.length ? (
                  <div className="p-8 text-center">
                    <p className="text-sm text-ora-muted">No items yet. Click "Add Item" to get started.</p>
                  </div>
                ) : (
                  <div className="p-4 space-y-1">
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                      <SortableContext items={flatItems.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                        {flatItems.map((flatItem) => (
                          <SortableTreeItem
                            key={flatItem.id}
                            flatItem={flatItem}
                            isSelected={selectedItem?.id === flatItem.id}
                            onSelect={(item) => { setSelectedItem(item); setSheetOpen(true); }}
                            onDelete={handleDeleteItem}
                            confirmingDeleteId={confirmingDeleteItemId}
                            setConfirmingDeleteId={setConfirmingDeleteItemId}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  </div>
                )}
              </div>

              <MenuItemSheet
                menuId={effectiveMenuId}
                item={selectedItem}
                parentOptions={parentOptions}
                open={sheetOpen}
                onClose={() => { setSheetOpen(false); setSelectedItem(null); }}
              />
            </>
          ) : (
            <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
              <p className="text-sm text-ora-muted">{menusLoading ? 'Loading menus…' : 'Select or create a menu to get started'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
