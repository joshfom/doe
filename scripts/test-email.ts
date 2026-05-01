/**
 * Manual test for Azure Graph OTP email delivery.
 *
 * Usage:
 *   bun run scripts/test-email.ts <recipient-email>
 */
import { sendOtpEmail } from "../lib/cms/ai/email";
import { generateOtp } from "../lib/cms/ai/otp";

async function main() {
  const recipient = process.argv[2];
  if (!recipient) {
    console.error("Usage: bun run scripts/test-email.ts <recipient-email>");
    process.exit(1);
  }

  console.log("[test-email] env:");
  console.log(
    "  AZURE_COMMUNICATION_TENANT_ID:",
    process.env.AZURE_COMMUNICATION_TENANT_ID ? "set" : "MISSING"
  );
  console.log(
    "  AZURE_COMMUNICATION_CLIENT_ID:",
    process.env.AZURE_COMMUNICATION_CLIENT_ID ? "set" : "MISSING"
  );
  console.log(
    "  AZURE_COMMUNICATION_CLIENT_SECRET:",
    process.env.AZURE_COMMUNICATION_CLIENT_SECRET ? "set" : "MISSING"
  );
  console.log(
    "  AZURE_COMMUNICATION_SENDER:",
    process.env.AZURE_COMMUNICATION_SENDER ?? "MISSING"
  );

  const { code } = generateOtp();
  console.log(`[test-email] sending OTP ${code} to ${recipient}…`);

  const result = await sendOtpEmail({
    recipientEmail: recipient,
    otpCode: code,
    recipientName: "Test User",
    language: "en",
  });

  console.log("[test-email] result:", result);
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error("[test-email] threw:", err);
  process.exit(1);
});
