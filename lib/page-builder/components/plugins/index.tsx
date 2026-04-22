"use client";

import React, { useState } from "react";
import type { Plugin } from "@puckeditor/core";

// ─── Page Settings Panel ─────────────────────────────────────────────────────

function PageSettingsPanel() {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>Page Settings</h3>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Page title"
          style={{
            padding: "6px 8px",
            border: "1px solid #E8E4DF",
            fontSize: 13,
          }}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        Slug
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="/page-slug"
          style={{
            padding: "6px 8px",
            border: "1px solid #E8E4DF",
            fontSize: 13,
          }}
        />
      </label>
    </div>
  );
}

// ─── SEO Metadata Panel ──────────────────────────────────────────────────────

function SeoMetadataPanel() {
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>SEO Metadata</h3>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        Meta Title
        <input
          type="text"
          value={metaTitle}
          onChange={(e) => setMetaTitle(e.target.value)}
          placeholder="SEO title"
          style={{
            padding: "6px 8px",
            border: "1px solid #E8E4DF",
            fontSize: 13,
          }}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        Meta Description
        <textarea
          value={metaDescription}
          onChange={(e) => setMetaDescription(e.target.value)}
          placeholder="SEO description"
          rows={3}
          style={{
            padding: "6px 8px",
            border: "1px solid #E8E4DF",
            fontSize: 13,
            resize: "vertical",
          }}
        />
      </label>
    </div>
  );
}

// ─── Publishing Controls Panel ───────────────────────────────────────────────

function PublishingControlsPanel({
  onPublish,
}: {
  onPublish?: () => void;
}) {
  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>Publishing</h3>
      <button
        type="button"
        onClick={onPublish}
        style={{
          padding: "8px 16px",
          background: "#B8956B",
          color: "#fff",
          border: "none",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Publish Page
      </button>
    </div>
  );
}

// ─── Plugin Factories ────────────────────────────────────────────────────────

/**
 * Create the page settings plugin for the Puck Plugin Rail.
 */
export function createPageSettingsPlugin(): Plugin {
  return {
    name: "page-settings",
    label: "Page Settings",
    icon: React.createElement("span", null, "⚙"),
    render: () => React.createElement(PageSettingsPanel),
  };
}

/**
 * Create the SEO metadata plugin for the Puck Plugin Rail.
 */
export function createSeoPlugin(): Plugin {
  return {
    name: "seo-metadata",
    label: "SEO",
    icon: React.createElement("span", null, "🔍"),
    render: () => React.createElement(SeoMetadataPanel),
  };
}

/**
 * Create the publishing controls plugin for the Puck Plugin Rail.
 */
export function createPublishingPlugin(onPublish?: () => void): Plugin {
  return {
    name: "publishing-controls",
    label: "Publish",
    icon: React.createElement("span", null, "🚀"),
    render: () => React.createElement(PublishingControlsPanel, { onPublish }),
  };
}

/**
 * Create all editor plugins for the Plugin Rail.
 */
export function createEditorPlugins(options?: {
  onPublish?: () => void;
}): Plugin[] {
  return [
    createPageSettingsPlugin(),
    createSeoPlugin(),
    createPublishingPlugin(options?.onPublish),
  ];
}
