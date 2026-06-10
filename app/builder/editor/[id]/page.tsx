"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import "@puckeditor/core/dist/index.css";
import { BuilderShell } from "@/lib/page-builder/builder-shell";
import { pageBuilderConfig } from "@/lib/page-builder/config";
import type { PageData, PageMeta } from "@/lib/page-builder/types";
import {
  pageManager,
  dataStore,
} from "@/lib/page-builder/store";
import { useFeatureFlag } from "@/lib/cms/hooks";

export default function EditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const brandedBuilder = useFeatureFlag("branded_builder");

  // One-time warning when the dead-letter flag is set to false
  useEffect(() => {
    if (!brandedBuilder) {
      console.warn("branded_builder flag ignored; legacy PageEditor has been removed");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function load() {
      try {
        const pages = await pageManager.listPages();
        const meta = pages.find((p) => p.id === id);
        if (!meta) {
          setError("Page not found");
          setLoading(false);
          return;
        }
        const data = await dataStore.load(id);
        if (!data) {
          setError("Page data not found");
          setLoading(false);
          return;
        }
        setPageMeta(meta);
        setPageData(data);
      } catch {
        setError("Failed to load page");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-ora-slate">Loading editor…</p>
      </div>
    );
  }

  if (error || !pageData || !pageMeta) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-ora-error">{error ?? "Something went wrong"}</p>
        <button
          onClick={() => router.push("/builder")}
          className="bg-ora-cream px-4 py-2 text-sm text-ora-charcoal hover:bg-ora-cream-dark"
        >
          Back to Pages
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen">
      <BuilderShell
        config={pageBuilderConfig as never}
        document={{
          id: pageMeta.id,
          title: pageMeta.title,
          slug: pageMeta.slug,
          mode: "page",
          status: pageMeta.status,
          createdAt: pageMeta.createdAt,
          updatedAt: pageMeta.updatedAt,
          publishedAt: pageMeta.publishedAt ?? undefined,
          pageData: pageData as never,
        }}
        onSave={async (record) => {
          try {
            const r = await pageManager.updatePage(id, {
              title: record.title,
              data: record.pageData as PageData,
            });
            return r.ok ? { ok: true } : { ok: false, error: r.error };
          } catch (e) {
            return {
              ok: false,
              error: e instanceof Error ? e.message : "Save failed",
            };
          }
        }}
        onPublish={async (record) => {
          try {
            const s = await pageManager.updatePage(id, {
              title: record.title,
              data: record.pageData as PageData,
            });
            if (!s.ok) return { ok: false, error: s.error };
            const p = await pageManager.publishPage(id);
            return p.ok ? { ok: true } : { ok: false, error: p.error };
          } catch (e) {
            return {
              ok: false,
              error: e instanceof Error ? e.message : "Publish failed",
            };
          }
        }}
      />
    </div>
  );
}
