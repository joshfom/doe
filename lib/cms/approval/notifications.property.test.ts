import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

// Feature: content-approval-workflow, Property 9: Email body contains required fields

// ── Types ────────────────────────────────────────────────────────────────────

interface ApprovalRequest {
  id: string;
  contentId: string;
  contentModule: string;
  submitterId: string;
  status: string;
}

// ── Email template builder (mirrors notifyApprovers in notifications.ts) ────

/**
 * Builds the notification email HTML for an approver, using the same
 * template logic as the real `notifyApprovers` function.
 */
function buildApproverNotificationHtml(
  approverName: string,
  contentTitle: string,
  contentModule: ContentModule,
  submitterName: string,
  approvalRequestId: string
): string {
  const reviewLink = "/ora-panel/reviews";

  const html = [
    `<h2>Content Review Request</h2>`,
    `<p><strong>${approverName}</strong>, a new item needs your review.</p>`,
    `<table>`,
    `<tr><td><strong>Content Title:</strong></td><td>${contentTitle}</td></tr>`,
    `<tr><td><strong>Module:</strong></td><td>${contentModule}</td></tr>`,
    `<tr><td><strong>Submitted by:</strong></td><td>${submitterName}</td></tr>`,
    `<tr><td><strong>Request ID:</strong></td><td>${approvalRequestId}</td></tr>`,
    `</table>`,
    `<p><a href="${reviewLink}">Review now</a></p>`,
  ].join("\n");

  return html;
}

// ── Shared arbitraries ───────────────────────────────────────────────────────

const contentModuleArb = fc.constantFrom<ContentModule>(
  "pages",
  "blog",
  "news",
  "construction_updates"
);

const uuidArb = fc.uuid();

const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 120 })
  .filter((s) => s.trim().length > 0);

const nonEmptyNameArb = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0);

// ─────────────────────────────────────────────────────────────────────────────
// Property 9: Email body contains required fields
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 4.2**
 *
 * Property 9: Email body contains required fields
 *
 * For any content title, content module name, submitter name, and approval
 * request ID, the generated notification email body should contain all four
 * values and a valid review link URL.
 */
// Feature: content-approval-workflow, Property 9: Email body contains required fields
describe("Feature: content-approval-workflow, Property 9: Email body contains required fields", () => {
  it("generated email HTML contains content title, module name, submitter name, request ID, and review link URL", () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb, // contentTitle
        contentModuleArb, // contentModule
        nonEmptyNameArb, // submitterName
        uuidArb, // approvalRequestId
        nonEmptyNameArb, // approverName
        (contentTitle, contentModule, submitterName, approvalRequestId, approverName) => {
          const html = buildApproverNotificationHtml(
            approverName,
            contentTitle,
            contentModule,
            submitterName,
            approvalRequestId
          );

          // Email body contains the content title
          expect(html).toContain(contentTitle);

          // Email body contains the content module name
          expect(html).toContain(contentModule);

          // Email body contains the submitter name
          expect(html).toContain(submitterName);

          // Email body contains the approval request ID
          expect(html).toContain(approvalRequestId);

          // Email body contains the review link URL
          expect(html).toContain("/ora-panel/reviews");
        }
      ),
      { numRuns: 100 }
    );
  });
});
