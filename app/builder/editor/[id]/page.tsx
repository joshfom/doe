"use client";

import { use, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import "@puckeditor/core/dist/index.css";
import { PageEditor } from "@/lib/page-builder/components/PageEditor";
import type { PageData, PageMeta } from "@/lib/page-builder/types";
import {
  pageManager,
  dataStore,
} from "@/lib/page-builder/store";

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

  const handleSave = useCallback(
    async (data: PageData) => {
      const result = await pageManager.updatePage(id, { data });
      if (!result.ok) {
        throw new Error(result.error);
      }
    },
    [id]
  );

  const handlePublish = useCallback(
    async (_data: PageData) => {
      const saveResult = await pageManager.updatePage(id, { data: _data });
      if (!saveResult.ok) throw new Error(saveResult.error);
      const pubResult = await pageManager.publishPage(id);
      if (!pubResult.ok) throw new Error(pubResult.error);
    },
    [id]
  );

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
      <PageEditor
        initialData={pageData}
        onSave={handleSave}
        onPublish={handlePublish}
      />
    </div>
  );
}
