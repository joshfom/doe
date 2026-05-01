import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { authGuard } from "../auth";
import { menus, menuItems, siteSettings } from "../../schema";
import { db } from "../../db";
import { logAudit } from "../../audit";
import {
  buildMenuTree,
  generateSlug,
  assignNextPosition,
  normalizeDropdownType,
  validateNestingDepth,
} from "../../utils/menu-tree";
import type { ItemType, ReorderItem } from "../../types";

// ── Public routes (no auth) ──────────────────────────────────────────────────

const publicMenus = new Elysia({ name: "menus-public" })
  // GET /menus/active — Returns active menu with hierarchical items
  .get("/menus/active", async ({ set }) => {
    // Look up active_menu_id from site_settings
    const [setting] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, "active_menu_id"))
      .limit(1);

    if (!setting || !setting.value) {
      set.status = 404;
      return { error: "No active menu configured" };
    }

    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, setting.value))
      .limit(1);

    if (!menu) {
      set.status = 404;
      return { error: "Menu not found" };
    }

    const items = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.menuId, menu.id));

    const tree = buildMenuTree(
      items.map((item) => ({
        id: item.id,
        menuId: item.menuId,
        parentId: item.parentId,
        label: item.label,
        url: item.url,
        icon: item.icon,
        itemType: item.itemType as ItemType,
        dropdownType: item.dropdownType as "simple" | "mega" | null,
        megaColumns: item.megaColumns,
        position: item.position,
      }))
    );

    return {
      data: {
        id: menu.id,
        name: menu.name,
        slug: menu.slug,
        createdAt: menu.createdAt.toISOString(),
        updatedAt: menu.updatedAt.toISOString(),
        items: tree,
      },
    };
  })

  // GET /menus/:id — Returns menu with hierarchical items
  .get("/menus/:id", async ({ params, set }) => {
    const { id } = params;

    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, id))
      .limit(1);

    if (!menu) {
      set.status = 404;
      return { error: "Menu not found" };
    }

    const items = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.menuId, menu.id));

    const tree = buildMenuTree(
      items.map((item) => ({
        id: item.id,
        menuId: item.menuId,
        parentId: item.parentId,
        label: item.label,
        url: item.url,
        icon: item.icon,
        itemType: item.itemType as ItemType,
        dropdownType: item.dropdownType as "simple" | "mega" | null,
        megaColumns: item.megaColumns,
        position: item.position,
      }))
    );

    return {
      data: {
        id: menu.id,
        name: menu.name,
        slug: menu.slug,
        createdAt: menu.createdAt.toISOString(),
        updatedAt: menu.updatedAt.toISOString(),
        items: tree,
      },
    };
  });


// ── Read-only routes (no auth required for admin reads) ──────────────────────

const readMenus = new Elysia({ name: "menus-read" })
  // GET /menus — List all menus ordered by created_at
  .get("/menus", async () => {
    const allMenus = await db
      .select()
      .from(menus)
      .orderBy(menus.createdAt);

    return {
      data: allMenus.map((menu) => ({
        id: menu.id,
        name: menu.name,
        slug: menu.slug,
        createdAt: menu.createdAt.toISOString(),
        updatedAt: menu.updatedAt.toISOString(),
      })),
    };
  });


// ── Protected routes (auth required) ─────────────────────────────────────────

const protectedMenus = new Elysia({ name: "menus-protected" })
  .use(authGuard)

  // POST /menus — Create menu
  .post("/menus", async ({ body, userId, set }) => {
    const { name } = body as { name?: string };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      set.status = 400;
      return { error: "Name is required" };
    }

    // Check for duplicate name
    const [existing] = await db
      .select()
      .from(menus)
      .where(eq(menus.name, name.trim()))
      .limit(1);

    if (existing) {
      set.status = 409;
      return { error: "Menu with this name already exists" };
    }

    const slug = generateSlug(name.trim());

    const [created] = await db
      .insert(menus)
      .values({
        name: name.trim(),
        slug,
      })
      .returning();

    await logAudit(db, {
      userId,
      action: "create",
      entityType: "menu",
      entityId: created.id,
      summary: `Created menu "${created.name}"`,
    });

    set.status = 201;
    return {
      data: {
        id: created.id,
        name: created.name,
        slug: created.slug,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
    };
  })

  // PUT /menus/:id — Update menu name, regenerate slug
  .put("/menus/:id", async ({ params, body, userId, set }) => {
    const { id } = params;
    const { name } = body as { name?: string };

    const [existing] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Menu not found" };
    }

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      set.status = 400;
      return { error: "Name is required" };
    }

    // Check for duplicate name (excluding current menu)
    const [duplicate] = await db
      .select()
      .from(menus)
      .where(eq(menus.name, name.trim()))
      .limit(1);

    if (duplicate && duplicate.id !== id) {
      set.status = 409;
      return { error: "Menu with this name already exists" };
    }

    const slug = generateSlug(name.trim());

    const [updated] = await db
      .update(menus)
      .set({
        name: name.trim(),
        slug,
        updatedAt: new Date(),
      })
      .where(eq(menus.id, id))
      .returning();

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "menu",
      entityId: id,
      summary: `Updated menu "${updated.name}"`,
    });

    return {
      data: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    };
  })

  // DELETE /menus/:id — Cascade delete menu and all items
  .delete("/menus/:id", async ({ params, userId, set }) => {
    const { id } = params;

    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, id))
      .limit(1);

    if (!menu) {
      set.status = 404;
      return { error: "Menu not found" };
    }

    // Cascade delete handled by FK constraint
    await db.delete(menus).where(eq(menus.id, id));

    await logAudit(db, {
      userId,
      action: "delete",
      entityType: "menu",
      entityId: id,
      summary: `Deleted menu "${menu.name}"`,
    });

    return { data: { success: true } };
  })

  // POST /menus/:id/items — Add menu item
  .post("/menus/:id/items", async ({ params, body, userId, set }) => {
    const { id: menuId } = params;
    const {
      label,
      url,
      icon,
      itemType,
      parentId,
      megaColumns,
    } = body as {
      label?: string;
      url?: string;
      icon?: string;
      itemType?: string;
      parentId?: string | null;
      megaColumns?: number;
    };

    // Verify menu exists
    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, menuId))
      .limit(1);

    if (!menu) {
      set.status = 404;
      return { error: "Menu not found" };
    }

    if (!label || typeof label !== "string" || label.trim().length === 0) {
      set.status = 400;
      return { error: "Label is required" };
    }

    // If parentId is provided, verify parent exists and is not a link item
    if (parentId) {
      const [parent] = await db
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, parentId))
        .limit(1);

      if (!parent) {
        set.status = 404;
        return { error: "Parent menu item not found" };
      }

      if (parent.itemType === "link") {
        set.status = 400;
        return { error: "Cannot assign children to a link item" };
      }
    }

    const resolvedItemType = (itemType as ItemType) || "link";
    const dropdownType = normalizeDropdownType(resolvedItemType);

    // Get existing items to calculate next position
    const existingItems = await db
      .select({ parentId: menuItems.parentId, position: menuItems.position })
      .from(menuItems)
      .where(eq(menuItems.menuId, menuId));

    const position = assignNextPosition(existingItems, parentId ?? null);

    const [created] = await db
      .insert(menuItems)
      .values({
        menuId,
        parentId: parentId ?? null,
        label: label.trim(),
        url: url ?? "#",
        icon: icon ?? null,
        itemType: resolvedItemType,
        dropdownType,
        megaColumns: megaColumns ?? 3,
        position,
      })
      .returning();

    await logAudit(db, {
      userId,
      action: "create",
      entityType: "menu",
      entityId: created.id,
      summary: `Added item "${created.label}" to menu "${menu.name}"`,
    });

    set.status = 201;
    return { data: created };
  })

  // PUT /menus/:id/items/:itemId — Update menu item
  .put("/menus/:id/items/:itemId", async ({ params, body, userId, set }) => {
    const { id: menuId, itemId } = params;
    const {
      label,
      url,
      icon,
      itemType,
      megaColumns,
    } = body as {
      label?: string;
      url?: string;
      icon?: string;
      itemType?: string;
      megaColumns?: number;
    };

    // Verify menu exists
    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, menuId))
      .limit(1);

    if (!menu) {
      set.status = 404;
      return { error: "Menu not found" };
    }

    // Verify item exists
    const [existing] = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, itemId))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Menu item not found" };
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (label !== undefined) updates.label = label;
    if (url !== undefined) updates.url = url;
    if (icon !== undefined) updates.icon = icon;
    if (megaColumns !== undefined) updates.megaColumns = megaColumns;

    // Handle item type change with dropdown_type consistency
    if (itemType !== undefined) {
      const resolvedItemType = itemType as ItemType;
      updates.itemType = resolvedItemType;
      updates.dropdownType = normalizeDropdownType(resolvedItemType);

      // If changing to "link", promote children to parent level
      if (resolvedItemType === "link") {
        const children = await db
          .select()
          .from(menuItems)
          .where(eq(menuItems.parentId, itemId));

        if (children.length > 0) {
          await db
            .update(menuItems)
            .set({ parentId: existing.parentId, updatedAt: new Date() })
            .where(eq(menuItems.parentId, itemId));
        }
      }
    }

    const [updated] = await db
      .update(menuItems)
      .set(updates)
      .where(eq(menuItems.id, itemId))
      .returning();

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "menu",
      entityId: itemId,
      summary: `Updated item "${updated.label}" in menu "${menu.name}"`,
    });

    return { data: updated };
  })

  // DELETE /menus/:id/items/:itemId — Delete item and promote children
  .delete("/menus/:id/items/:itemId", async ({ params, userId, set }) => {
    const { id: menuId, itemId } = params;

    // Verify menu exists
    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, menuId))
      .limit(1);

    if (!menu) {
      set.status = 404;
      return { error: "Menu not found" };
    }

    // Verify item exists
    const [item] = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, itemId))
      .limit(1);

    if (!item) {
      set.status = 404;
      return { error: "Menu item not found" };
    }

    // Promote children to deleted item's parent
    await db
      .update(menuItems)
      .set({ parentId: item.parentId, updatedAt: new Date() })
      .where(eq(menuItems.parentId, itemId));

    // Delete the item
    await db.delete(menuItems).where(eq(menuItems.id, itemId));

    await logAudit(db, {
      userId,
      action: "delete",
      entityType: "menu",
      entityId: itemId,
      summary: `Deleted item "${item.label}" from menu "${menu.name}"`,
    });

    return { data: { success: true } };
  })

  // PUT /menus/:id/reorder — Bulk reorder items
  .put("/menus/:id/reorder", async ({ params, body, userId, set }) => {
    const { id: menuId } = params;
    const { items: reorderItems } = body as { items?: ReorderItem[] };

    // Verify menu exists
    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, menuId))
      .limit(1);

    if (!menu) {
      set.status = 404;
      return { error: "Menu not found" };
    }

    if (!reorderItems || !Array.isArray(reorderItems)) {
      set.status = 400;
      return { error: "Items array is required" };
    }

    // Validate all item IDs belong to this menu
    const existingItems = await db
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(eq(menuItems.menuId, menuId));

    const existingIds = new Set(existingItems.map((i) => i.id));
    const reorderIds = reorderItems.map((i) => i.id);

    for (const rid of reorderIds) {
      if (!existingIds.has(rid)) {
        set.status = 400;
        return { error: "Invalid item IDs for this menu" };
      }
    }

    // Validate nesting depth
    const depthItems = reorderItems.map((i) => ({
      id: i.id,
      parentId: i.parentId,
    }));

    if (!validateNestingDepth(depthItems)) {
      set.status = 400;
      return { error: "Maximum nesting depth exceeded" };
    }

    // Update all items in a single transaction
    await db.transaction(async (tx) => {
      for (const item of reorderItems) {
        await tx
          .update(menuItems)
          .set({
            position: item.position,
            parentId: item.parentId,
            updatedAt: new Date(),
          })
          .where(eq(menuItems.id, item.id));
      }
    });

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "menu",
      entityId: menuId,
      summary: `Reordered items in menu "${menu.name}"`,
    });

    return { data: { success: true } };
  })

  // POST /menus/:id/set-active — Set menu as active navigation
  .post("/menus/:id/set-active", async ({ params, userId, set }) => {
    const { id: menuId } = params;

    // Verify menu exists
    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, menuId))
      .limit(1);

    if (!menu) {
      set.status = 404;
      return { error: "Menu not found" };
    }

    // Upsert active_menu_id in site_settings
    const [existing] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, "active_menu_id"))
      .limit(1);

    if (existing) {
      await db
        .update(siteSettings)
        .set({ value: menuId, updatedAt: new Date() })
        .where(eq(siteSettings.key, "active_menu_id"));
    } else {
      await db.insert(siteSettings).values({
        key: "active_menu_id",
        value: menuId,
      });
    }

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "menu",
      entityId: menuId,
      summary: `Set menu "${menu.name}" as active navigation`,
    });

    return { data: { success: true } };
  });

// ── Combine and export ───────────────────────────────────────────────────────

export const menusRoutes = new Elysia({ name: "menus" })
  .use(publicMenus)
  .use(readMenus)
  .use(protectedMenus);
