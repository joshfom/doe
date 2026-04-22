"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { pageManager, templateRegistry } from "@/lib/page-builder/store";
import type { PageData } from "@/lib/page-builder/types";

const emptyPageData: PageData = {
  root: { props: { title: "" } },
  content: [],
};

export default function NewPagePage() {
  const router = useRouter();
  const templates = templateRegistry.list();

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!title.trim() || !slug.trim()) { setError("Title and slug are required"); return; }
    setCreating(true);
    setError(null);
    try {
      const initialData = selectedTemplateId
        ? (templateRegistry.getById(selectedTemplateId)?.data ?? emptyPageData)
        : emptyPageData;
      const result = await pageManager.createPage(title.trim(), slug.trim(), initialData);
      if (!result.ok) { setError(result.error); setCreating(false); return; }
      router.push(`/builder/editor/${result.value.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create page");
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-ora-cream-light p-8">
      <div className="mx-auto max-w-2xl">
        <p className="text-[10px] font-bold uppercase tracking-widest text-ora-muted">ORA</p>
        <h1 className="mb-8 text-2xl font-semibold text-ora-charcoal">Create New Page</h1>

        <div className="space-y-6 border border-ora-sand/60 bg-white p-6">
          <div>
            <label htmlFor="title" className="mb-1 block text-sm font-medium text-ora-charcoal-light">Page Title</label>
            <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My New Page"
              className="w-full border border-ora-stone px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus:outline-none focus:ring-1 focus:ring-ora-gold" />
          </div>
          <div>
            <label htmlFor="slug" className="mb-1 block text-sm font-medium text-ora-charcoal-light">URL Slug</label>
            <input id="slug" type="text" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-new-page"
              className="w-full border border-ora-stone px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus:outline-none focus:ring-1 focus:ring-ora-gold" />
          </div>
          <div>
            <p className="mb-3 text-sm font-medium text-ora-charcoal-light">Choose a Template</p>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setSelectedTemplateId(null)}
                className={`border p-4 text-left transition ${selectedTemplateId === null ? "border-ora-gold bg-ora-gold/5" : "border-ora-sand hover:border-ora-sand-dark"}`}>
                <p className="font-medium text-ora-charcoal">Blank Page</p>
                <p className="text-xs text-ora-slate">Start from scratch</p>
              </button>
              {templates.map((tpl) => (
                <button key={tpl.id} type="button" onClick={() => setSelectedTemplateId(tpl.id)}
                  className={`border p-4 text-left transition ${selectedTemplateId === tpl.id ? "border-ora-gold bg-ora-gold/5" : "border-ora-sand hover:border-ora-sand-dark"}`}>
                  <p className="font-medium text-ora-charcoal">{tpl.name}</p>
                  <p className="text-xs text-ora-slate">{tpl.description}</p>
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-ora-error" role="alert">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={handleCreate} disabled={creating}
              className="bg-ora-gold px-4 py-2 text-sm font-medium text-white hover:bg-ora-gold-dark disabled:opacity-50">
              {creating ? "Creating…" : "Create Page"}
            </button>
            <button type="button" onClick={() => router.push("/builder")}
              className="border border-ora-sand bg-white px-4 py-2 text-sm text-ora-charcoal hover:bg-ora-cream-light">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
