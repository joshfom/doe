'use client';

import { useFormSubmissions } from '@/lib/cms/hooks';
import { Inbox } from 'lucide-react';

export default function FormSubmissionsPage() {
  const { data: groups, isLoading } = useFormSubmissions();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">Form Submissions</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">View submissions grouped by form</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded bg-ora-sand/60" />
          ))}
        </div>
      ) : !groups?.length ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
          <Inbox className="mx-auto mb-3 h-10 w-10 stroke-1 text-ora-muted" />
          <p className="text-sm text-ora-muted">No submissions yet</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.form.id} className="border border-ora-sand/60 bg-ora-white">
              {/* Form header */}
              <div className="border-b border-ora-sand px-6 py-4">
                <h2 className="text-lg font-semibold text-ora-charcoal">{group.form.name}</h2>
                <p className="text-xs text-ora-muted">
                  {group.submissions.length} submission{group.submissions.length !== 1 ? 's' : ''}
                </p>
              </div>

              {/* Submissions */}
              {group.submissions.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-sm text-ora-muted">No submissions for this form</p>
                </div>
              ) : (
                <div className="divide-y divide-ora-sand">
                  {group.submissions.map((sub) => (
                    <div key={sub.id} className="px-6 py-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs text-ora-muted">
                          {new Date(sub.createdAt).toLocaleString()}
                        </span>
                        {sub.sourceLocale && (
                          <span className="inline-block rounded-full bg-ora-sand px-2 py-0.5 text-xs text-ora-charcoal-light">
                            {sub.sourceLocale.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {Object.entries(sub.data).map(([key, value]) => (
                          <div key={key}>
                            <span className="text-xs font-medium text-ora-charcoal-light">{key}</span>
                            <p className="text-sm text-ora-charcoal">{String(value)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
