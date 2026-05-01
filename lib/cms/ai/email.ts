// ── Types ────────────────────────────────────────────────────────────────────

export interface SendOtpEmailInput {
  recipientEmail: string;
  otpCode: string;
  recipientName: string;
  language: "en" | "ar";
}

// ── Environment helpers ──────────────────────────────────────────────────────

function getTenantId(): string {
  const id = process.env.AZURE_COMMUNICATION_TENANT_ID;
  if (!id) {
    throw new Error(
      "AZURE_COMMUNICATION_TENANT_ID environment variable is not set."
    );
  }
  return id;
}

function getClientId(): string {
  const id = process.env.AZURE_COMMUNICATION_CLIENT_ID;
  if (!id) {
    throw new Error(
      "AZURE_COMMUNICATION_CLIENT_ID environment variable is not set."
    );
  }
  return id;
}

function getClientSecret(): string {
  const secret = process.env.AZURE_COMMUNICATION_CLIENT_SECRET;
  if (!secret) {
    throw new Error(
      "AZURE_COMMUNICATION_CLIENT_SECRET environment variable is not set."
    );
  }
  return secret;
}

function getSenderEmail(): string {
  const sender = process.env.AZURE_COMMUNICATION_SENDER;
  if (!sender) {
    throw new Error(
      "AZURE_COMMUNICATION_SENDER environment variable is not set."
    );
  }
  return sender;
}

// ── OAuth2 Token Cache ───────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

let tokenCache: CachedToken | null = null;

/**
 * Acquires an OAuth2 access token using the client credentials flow.
 *
 * Tokens are cached in memory and reused until they expire (with a 60-second
 * safety buffer). If the cached token is still valid, it is returned immediately
 * without making a network request.
 */
async function acquireToken(): Promise<string> {
  // Return cached token if still valid
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const tenantId = getTenantId();
  const clientId = getClientId();
  const clientSecret = getClientSecret();

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Azure AD token acquisition failed (${response.status}): ${errorBody}`
    );
  }

  const data = await response.json();
  const accessToken = data?.access_token;
  const expiresIn = data?.expires_in;

  if (typeof accessToken !== "string" || typeof expiresIn !== "number") {
    throw new Error(
      "Azure AD token response has unexpected format. " +
        "Expected { access_token: string, expires_in: number }."
    );
  }

  // Cache with a 60-second buffer before actual expiry
  const bufferSeconds = 60;
  tokenCache = {
    accessToken,
    expiresAt: Date.now() + (expiresIn - bufferSeconds) * 1000,
  };

  return accessToken;
}

/**
 * Clears the cached OAuth2 token. Useful for testing or when credentials change.
 */
export function clearTokenCache(): void {
  tokenCache = null;
}

// ── Email Template ───────────────────────────────────────────────────────────

/**
 * Builds the HTML email body for an OTP verification email.
 *
 * The template includes:
 * - ORA brand name
 * - Prominent 6-digit OTP code
 * - 5-minute expiry notice
 * - Security warning (do not share)
 * - Support contact information
 * - Full bilingual support: English for "en", Arabic for "ar"
 *
 * Exported separately so it can be tested by Property 12 tests.
 */
export function buildOtpEmailHtml(input: {
  recipientName: string;
  otpCode: string;
  language: "en" | "ar";
}): string {
  const { recipientName, otpCode, language } = input;

  if (language === "ar") {
    return buildArabicTemplate(recipientName, otpCode);
  }

  return buildEnglishTemplate(recipientName, otpCode);
}

function buildEnglishTemplate(name: string, code: string): string {
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color:#1a1a2e;padding:24px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;letter-spacing:2px;">ORA</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 24px;">
              <p style="margin:0 0 16px;font-size:16px;color:#333333;">Hello ${name},</p>
              <p style="margin:0 0 24px;font-size:16px;color:#333333;">Use the following verification code to confirm your identity:</p>
              <div style="text-align:center;margin:0 0 24px;">
                <span style="display:inline-block;background-color:#f0f0f0;border:2px solid #1a1a2e;border-radius:8px;padding:16px 32px;font-size:32px;font-weight:bold;letter-spacing:8px;color:#1a1a2e;">${code}</span>
              </div>
              <p style="margin:0 0 16px;font-size:14px;color:#666666;text-align:center;">This code expires in <strong>5 minutes</strong>.</p>
              <div style="background-color:#fff3cd;border-left:4px solid #ffc107;padding:12px 16px;margin:0 0 24px;border-radius:4px;">
                <p style="margin:0;font-size:14px;color:#856404;"><strong>Security Warning:</strong> Do not share this code with anyone. ORA staff will never ask for your verification code.</p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f8f8f8;padding:16px 24px;text-align:center;border-top:1px solid #eeeeee;">
              <p style="margin:0 0 8px;font-size:12px;color:#999999;">Need help? Contact us at <a href="mailto:support@ora.ae" style="color:#1a1a2e;">support@ora.ae</a></p>
              <p style="margin:0;font-size:12px;color:#999999;">&copy; ORA. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildArabicTemplate(name: string, code: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color:#1a1a2e;padding:24px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;letter-spacing:2px;">ORA</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 24px;">
              <p style="margin:0 0 16px;font-size:16px;color:#333333;">مرحباً ${name}،</p>
              <p style="margin:0 0 24px;font-size:16px;color:#333333;">استخدم رمز التحقق التالي لتأكيد هويتك:</p>
              <div style="text-align:center;margin:0 0 24px;">
                <span style="display:inline-block;background-color:#f0f0f0;border:2px solid #1a1a2e;border-radius:8px;padding:16px 32px;font-size:32px;font-weight:bold;letter-spacing:8px;color:#1a1a2e;">${code}</span>
              </div>
              <p style="margin:0 0 16px;font-size:14px;color:#666666;text-align:center;">ينتهي هذا الرمز خلال <strong>٥ دقائق</strong>.</p>
              <div style="background-color:#fff3cd;border-right:4px solid #ffc107;padding:12px 16px;margin:0 0 24px;border-radius:4px;">
                <p style="margin:0;font-size:14px;color:#856404;"><strong>تحذير أمني:</strong> لا تشارك هذا الرمز مع أي شخص. لن يطلب منك فريق ORA رمز التحقق الخاص بك أبداً.</p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f8f8f8;padding:16px 24px;text-align:center;border-top:1px solid #eeeeee;">
              <p style="margin:0 0 8px;font-size:12px;color:#999999;">تحتاج مساعدة؟ تواصل معنا على <a href="mailto:support@ora.ae" style="color:#1a1a2e;">support@ora.ae</a></p>
              <p style="margin:0;font-size:12px;color:#999999;">&copy; ORA. جميع الحقوق محفوظة.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Email Sending ────────────────────────────────────────────────────────────

/**
 * Sends an OTP verification email via the Microsoft Graph API.
 *
 * 1. Acquires an OAuth2 token (cached when possible)
 * 2. Builds the bilingual HTML email template
 * 3. Sends the email via `POST /users/{sender}/sendMail`
 *
 * Returns `{ success: true }` on success, or `{ success: false, error }` if
 * token acquisition or email delivery fails.
 */
export async function sendOtpEmail(
  input: SendOtpEmailInput
): Promise<{ success: boolean; error?: string }> {
  const { recipientEmail, otpCode, recipientName, language } = input;

  try {
    const token = await acquireToken();
    const senderEmail = getSenderEmail();

    const subject =
      language === "ar"
        ? "ORA — رمز التحقق الخاص بك"
        : "ORA — Your Verification Code";

    const htmlContent = buildOtpEmailHtml({
      recipientName,
      otpCode,
      language,
    });

    const graphUrl = `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`;

    const response = await fetch(graphUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: {
            contentType: "HTML",
            content: htmlContent,
          },
          toRecipients: [
            {
              emailAddress: {
                address: recipientEmail,
              },
            },
          ],
        },
        saveToSentItems: false,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      return {
        success: false,
        error: `Graph API sendMail failed (${response.status}): ${errorBody}`,
      };
    }

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}

// ── Appointment confirmation email ────────────────────────────────────────────

export interface SendAppointmentEmailInput {
  recipientEmail: string;
  recipientName: string;
  referenceNumber: string;
  ticketNumber?: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:MM
  appointmentType:
    | "site_visit"
    | "consultation"
    | "payment_discussion"
    | "maintenance_request";
  language: "en" | "ar";
}

const APPOINTMENT_TYPE_LABELS: Record<
  SendAppointmentEmailInput["appointmentType"],
  { en: string; ar: string }
> = {
  site_visit: { en: "Site Visit", ar: "زيارة موقع" },
  consultation: { en: "Consultation", ar: "استشارة" },
  payment_discussion: { en: "Payment Discussion", ar: "مناقشة دفع" },
  maintenance_request: { en: "Maintenance Visit", ar: "زيارة صيانة" },
};

export function buildAppointmentEmailHtml(
  input: SendAppointmentEmailInput
): string {
  const {
    recipientName,
    referenceNumber,
    ticketNumber,
    scheduledDate,
    scheduledTime,
    appointmentType,
    language,
  } = input;
  const typeLabel = APPOINTMENT_TYPE_LABELS[appointmentType][language];

  if (language === "ar") {
    return `<!DOCTYPE html><html dir="rtl" lang="ar"><body style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#f5f5f5;margin:0;padding:24px;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
    <div style="background:#0a0a0a;color:#fff;padding:28px 32px;"><h1 style="margin:0;font-size:22px;font-weight:600;">تأكيد طلب الحجز</h1></div>
    <div style="padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;">مرحباً ${recipientName}،</p>
      <p style="margin:0 0 24px;line-height:1.6;">شكراً لتواصلك معنا. تم استلام طلب الحجز التالي:</p>
      <div style="background:#fafafa;border:1px solid #ececec;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
        <p style="margin:0 0 8px;"><strong>نوع الموعد:</strong> ${typeLabel}</p>
        <p style="margin:0 0 8px;"><strong>التاريخ:</strong> ${scheduledDate}</p>
        <p style="margin:0 0 8px;"><strong>الوقت:</strong> ${scheduledTime}</p>
        <p style="margin:0 0 8px;"><strong>رقم الموعد:</strong> ${referenceNumber}</p>
        ${ticketNumber ? `<p style="margin:0;"><strong>رقم التذكرة:</strong> ${ticketNumber}</p>` : ""}
      </div>
      <p style="margin:0 0 16px;line-height:1.6;">سيقوم أحد ممثلينا بمراجعة طلبك وتأكيد الموعد قريباً. إذا احتجت لتعديل أو إلغاء الموعد، فقط أخبرنا في الدردشة أو رد على هذا البريد.</p>
      <p style="margin:24px 0 0;color:#666;font-size:13px;">مع تحيات فريق ORA</p>
    </div>
  </div></body></html>`;
  }

  return `<!DOCTYPE html><html lang="en"><body style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#f5f5f5;margin:0;padding:24px;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
    <div style="background:#0a0a0a;color:#fff;padding:28px 32px;"><h1 style="margin:0;font-size:22px;font-weight:600;">Booking Request Received</h1></div>
    <div style="padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;">Hello ${recipientName},</p>
      <p style="margin:0 0 24px;line-height:1.6;">Thanks for reaching out. We've recorded your booking request:</p>
      <div style="background:#fafafa;border:1px solid #ececec;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
        <p style="margin:0 0 8px;"><strong>Appointment type:</strong> ${typeLabel}</p>
        <p style="margin:0 0 8px;"><strong>Date:</strong> ${scheduledDate}</p>
        <p style="margin:0 0 8px;"><strong>Time:</strong> ${scheduledTime}</p>
        <p style="margin:0 0 8px;"><strong>Appointment ref:</strong> ${referenceNumber}</p>
        ${ticketNumber ? `<p style="margin:0;"><strong>Tracking ticket:</strong> ${ticketNumber}</p>` : ""}
      </div>
      <p style="margin:0 0 16px;line-height:1.6;">A teammate will review your request and confirm shortly. If you need to reschedule or cancel, just let us know in the chat or reply to this email.</p>
      <p style="margin:24px 0 0;color:#666;font-size:13px;">— The ORA team</p>
    </div>
  </div></body></html>`;
}

/**
 * Build a minimal RFC 5545 VCALENDAR file for the appointment. Recipients can
 * add it to Outlook / Apple Calendar / Google Calendar with one click.
 * Times are interpreted as Asia/Dubai local (UTC+4). Duration: 60 min.
 */
export function buildAppointmentIcs(input: SendAppointmentEmailInput): string {
  const { scheduledDate, scheduledTime, referenceNumber, recipientName, language } = input;
  const [yyyy, mm, dd] = scheduledDate.split("-");
  const [hh, min] = scheduledTime.split(":");
  // Asia/Dubai = UTC+4. To get UTC, subtract 4 hours.
  const startLocal = new Date(
    Date.UTC(
      parseInt(yyyy, 10),
      parseInt(mm, 10) - 1,
      parseInt(dd, 10),
      parseInt(hh, 10) - 4,
      parseInt(min, 10),
      0
    )
  );
  const endLocal = new Date(startLocal.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const dtStart = fmt(startLocal);
  const dtEnd = fmt(endLocal);
  const dtStamp = fmt(new Date());

  const typeLabel = APPOINTMENT_TYPE_LABELS[input.appointmentType][language];
  const summary =
    language === "ar"
      ? `ORA — ${typeLabel}`
      : `ORA — ${typeLabel}`;
  const description =
    language === "ar"
      ? `موعدك مع فريق ORA. الرقم المرجعي: ${referenceNumber}.`
      : `Your appointment with the ORA team. Reference: ${referenceNumber}.`;

  // Escape ICS special chars per RFC 5545
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ORA UAE//AI Assistant//EN",
    "METHOD:REQUEST",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${referenceNumber}@ora-uae`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
    `ORGANIZER;CN=ORA Team:mailto:${process.env.AZURE_COMMUNICATION_SENDER ?? "no-reply@ora.local"}`,
    `ATTENDEE;CN=${esc(recipientName)};RSVP=TRUE:mailto:${input.recipientEmail}`,
    "STATUS:TENTATIVE",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

export async function sendAppointmentEmail(
  input: SendAppointmentEmailInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const token = await acquireToken();
    const senderEmail = getSenderEmail();

    const subject =
      input.language === "ar"
        ? `ORA — تأكيد طلب الحجز ${input.referenceNumber}`
        : `ORA — Booking Request ${input.referenceNumber}`;

    const htmlContent = buildAppointmentEmailHtml(input);
    const ics = buildAppointmentIcs(input);
    const icsBase64 = Buffer.from(ics, "utf-8").toString("base64");

    const graphUrl = `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`;
    const response = await fetch(graphUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: htmlContent },
          toRecipients: [{ emailAddress: { address: input.recipientEmail } }],
          attachments: [
            {
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: "appointment.ics",
              contentType: "text/calendar; method=REQUEST",
              contentBytes: icsBase64,
            },
          ],
        },
        saveToSentItems: false,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      return {
        success: false,
        error: `Graph API sendMail failed (${response.status}): ${errorBody}`,
      };
    }
    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}
