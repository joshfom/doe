"use client";

import { useEffect, useRef } from "react";
import { getConsentState } from "./consent-state";

/**
 * Microsoft Clarity tracking script.
 *
 * Reads the project ID from `NEXT_PUBLIC_CLARITY_ID` — static per
 * environment, no need to round-trip through the database. Renders
 * nothing if the env var is empty or analytics consent is not granted.
 */
export function ClarityScript() {
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    const clarityId = process.env.NEXT_PUBLIC_CLARITY_ID;
    if (!clarityId) {
      return;
    }

    const consent = getConsentState();
    if (!consent?.analytics) {
      return;
    }

    // Initialize the clarity command queue
    const win = window as unknown as Record<string, unknown>;
    win["clarity"] =
      win["clarity"] ||
      function (...args: unknown[]) {
        ((win["clarity"] as { q?: unknown[] }).q =
          (win["clarity"] as { q?: unknown[] }).q || []).push(args);
      };

    // Create and inject the script element
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${clarityId}`;

    const firstScript = document.getElementsByTagName("script")[0];
    if (firstScript?.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.head.appendChild(script);
    }

    scriptRef.current = script;

    return () => {
      if (scriptRef.current?.parentNode) {
        scriptRef.current.parentNode.removeChild(scriptRef.current);
        scriptRef.current = null;
      }
    };
  }, []);

  return null;
}
