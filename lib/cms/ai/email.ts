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
