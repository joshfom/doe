"use client";

import { useState } from "react";
import type { FormFieldConfig } from "@/lib/cms/types";

// ── Types ────────────────────────────────────────────────────────────────────

interface FormBuilderProps {
  fields: FormFieldConfig[];
  formId?: string;
  sourcePageSlug?: string;
  sourceLocale?: string;
  onSuccess?: () => void;
}

type FormErrors = Record<string, string>;
type FormValues = Record<string, string | boolean>;

// ── Validation ───────────────────────────────────────────────────────────────

function validateField(field: FormFieldConfig, value: string | boolean): string | null {
  const strValue = typeof value === "string" ? value.trim() : "";

  if (field.required) {
    if (field.type === "checkbox" && value !== true) {
      return `${field.label} is required`;
    }
    if (field.type !== "checkbox" && strValue === "") {
      return `${field.label} is required`;
    }
  }

  if (field.type === "email" && strValue !== "") {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(strValue)) {
      return "Please enter a valid email address";
    }
  }

  if (field.type === "phone" && strValue !== "") {
    const phoneRe = /^\+?[\d\s\-()]{7,20}$/;
    if (!phoneRe.test(strValue)) {
      return "Please enter a valid phone number";
    }
  }

  return null;
}

function validateForm(fields: FormFieldConfig[], values: FormValues): FormErrors {
  const errors: FormErrors = {};
  for (const field of fields) {
    const error = validateField(field, values[field.name] ?? "");
    if (error) errors[field.name] = error;
  }
  return errors;
}

// ── Component ────────────────────────────────────────────────────────────────

export function FormBuilder({
  fields,
  formId,
  sourcePageSlug,
  sourceLocale,
  onSuccess,
}: FormBuilderProps) {
  const [values, setValues] = useState<FormValues>(() => {
    const initial: FormValues = {};
    for (const field of fields) {
      initial[field.name] = field.type === "checkbox" ? false : "";
    }
    return initial;
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleChange(name: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [name]: value }));
    // Clear field error on change
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const validationErrors = validateForm(fields, values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formId,
          data: values,
          sourcePageSlug,
          sourceLocale,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Submission failed" }));
        if (body.details) {
          setErrors(body.details);
        } else {
          setSubmitError(body.error || "Submission failed");
        }
        return;
      }

      setSubmitted(true);
      onSuccess?.();
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="border border-ora-sand bg-ora-success/10 p-6 text-center">
        <p className="text-sm font-medium text-ora-success">
          Thank you! Your submission has been received.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {fields.map((field) => (
        <FormField
          key={field.name}
          field={field}
          value={values[field.name] ?? ""}
          error={errors[field.name]}
          onChange={(v) => handleChange(field.name, v)}
        />
      ))}

      {submitError && (
        <p className="text-sm text-ora-error">{submitError}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="h-10 px-6 text-sm bg-ora-gold text-ora-white hover:bg-ora-gold-dark disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2"
      >
        {submitting ? "Submitting…" : "Submit"}
      </button>
    </form>
  );
}

// ── Field Renderer ───────────────────────────────────────────────────────────

interface FormFieldProps {
  field: FormFieldConfig;
  value: string | boolean;
  error?: string;
  onChange: (value: string | boolean) => void;
}

function FormField({ field, value, error, onChange }: FormFieldProps) {
  const inputClasses =
    "h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none";
  const errorBorder = error ? "border-ora-error" : "";

  switch (field.type) {
    case "textarea":
      return (
        <FieldWrapper field={field} error={error}>
          <textarea
            name={field.name}
            value={value as string}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            className={`w-full border border-ora-stone bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none resize-y ${errorBorder}`}
          />
        </FieldWrapper>
      );

    case "select":
      return (
        <FieldWrapper field={field} error={error}>
          <select
            name={field.name}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputClasses} ${errorBorder}`}
          >
            <option value="">{field.placeholder || "Select…"}</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </FieldWrapper>
      );

    case "checkbox":
      return (
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            name={field.name}
            checked={value as boolean}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 border border-ora-stone accent-ora-gold"
          />
          <div>
            <label className="text-sm text-ora-charcoal">
              {field.label}
              {field.required && <span className="text-ora-error ml-0.5">*</span>}
            </label>
            {error && <p className="mt-1 text-xs text-ora-error">{error}</p>}
          </div>
        </div>
      );

    case "radio":
      return (
        <FieldWrapper field={field} error={error}>
          <div className="flex flex-col gap-2">
            {field.options?.map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm text-ora-charcoal">
                <input
                  type="radio"
                  name={field.name}
                  value={opt}
                  checked={value === opt}
                  onChange={() => onChange(opt)}
                  className="h-4 w-4 border border-ora-stone accent-ora-gold"
                />
                {opt}
              </label>
            ))}
          </div>
        </FieldWrapper>
      );

    default: {
      // text, email, phone
      const inputType = field.type === "phone" ? "tel" : field.type;
      return (
        <FieldWrapper field={field} error={error}>
          <input
            type={inputType}
            name={field.name}
            value={value as string}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputClasses} ${errorBorder}`}
          />
        </FieldWrapper>
      );
    }
  }
}

// ── Field Wrapper ────────────────────────────────────────────────────────────

function FieldWrapper({
  field,
  error,
  children,
}: {
  field: FormFieldConfig;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
        {field.label}
        {field.required && <span className="text-ora-error ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-ora-error">{error}</p>}
    </div>
  );
}
