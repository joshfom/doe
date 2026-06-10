"use client";

import { useEffect, useRef } from "react";
import posthog from "posthog-js";

export interface FormTrackerProps {
  children: React.ReactNode;
}

/**
 * AutoFormTracker wraps a subtree and automatically detects any <form>
 * elements within it, applying form lifecycle tracking without manual
 * configuration. Uses event delegation on the container so it works
 * with dynamically rendered forms (e.g., ProjectInquiryCTA).
 *
 * Requirements: 8.4 (auto-detection)
 */
export function AutoFormTracker({ children }: FormTrackerProps) {
  return <FormTracker>{children}</FormTracker>;
}

/**
 * FormTracker wraps a form element and auto-wires analytics events:
 * - `form_started`: fired once on first focusin to any input/select/textarea
 * - `form_field_focused`: fired on every focusin with field name/id
 * - `form_field_abandoned`: fired when a field with a non-empty value loses
 *   focus and no form submission happens within 30 minutes
 * - `form_submitted`: fired on form submit
 *
 * Requirements: 8.4
 */
export function FormTracker({ children }: FormTrackerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const formStartedRef = useRef(false);
  const abandonTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ABANDON_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    let submitted = false;

    function getFieldIdentifier(el: Element): string {
      if (el instanceof HTMLElement) {
        return el.getAttribute("name") || el.id || el.tagName.toLowerCase();
      }
      return el.tagName.toLowerCase();
    }

    function isFormField(el: EventTarget | null): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      );
    }

    function handleFocusIn(e: FocusEvent) {
      if (!isFormField(e.target)) return;

      const fieldId = getFieldIdentifier(e.target);

      // First focus ever: capture form_started (once per mount)
      if (!formStartedRef.current) {
        formStartedRef.current = true;
        posthog.capture("form_started");
      }

      // Every focus: capture form_field_focused
      posthog.capture("form_field_focused", { field: fieldId });

      // Clear any existing abandon timer for this field
      const timers = abandonTimersRef.current;
      const existingTimer = timers.get(fieldId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        timers.delete(fieldId);
      }
    }

    function handleFocusOut(e: FocusEvent) {
      if (!isFormField(e.target)) return;

      const field = e.target;
      const fieldId = getFieldIdentifier(field);
      const value = field.value;

      // Only track abandonment if field has a non-empty value
      if (!value || value.trim() === "") return;

      // Set a 30-minute timeout for form_field_abandoned
      const timer = setTimeout(() => {
        if (!submitted) {
          posthog.capture("form_field_abandoned", { field: fieldId });
        }
        abandonTimersRef.current.delete(fieldId);
      }, ABANDON_TIMEOUT_MS);

      abandonTimersRef.current.set(fieldId, timer);
    }

    function handleSubmit(e: Event) {
      // Only handle submit events from form elements
      if (!(e.target instanceof HTMLFormElement)) return;

      submitted = true;

      // Clear all abandon timers on submit
      const timers = abandonTimersRef.current;
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();

      posthog.capture("form_submitted");
    }

    container.addEventListener("focusin", handleFocusIn);
    container.addEventListener("focusout", handleFocusOut);
    container.addEventListener("submit", handleSubmit);

    return () => {
      container.removeEventListener("focusin", handleFocusIn);
      container.removeEventListener("focusout", handleFocusOut);
      container.removeEventListener("submit", handleSubmit);

      // Clean up all pending timers
      const timers = abandonTimersRef.current;
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  return <div ref={containerRef}>{children}</div>;
}
