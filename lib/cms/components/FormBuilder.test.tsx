import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FormBuilder } from "./FormBuilder";
import type { FormFieldConfig } from "@/lib/cms/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

const textField: FormFieldConfig = {
  name: "fullName",
  label: "Full Name",
  type: "text",
  required: true,
  placeholder: "Enter your name",
};

const emailField: FormFieldConfig = {
  name: "email",
  label: "Email",
  type: "email",
  required: true,
  placeholder: "you@example.com",
};

const phoneField: FormFieldConfig = {
  name: "phone",
  label: "Phone",
  type: "phone",
  required: false,
  placeholder: "+1 555 000 0000",
};

const textareaField: FormFieldConfig = {
  name: "message",
  label: "Message",
  type: "textarea",
  required: false,
};

const selectField: FormFieldConfig = {
  name: "interest",
  label: "Interest",
  type: "select",
  required: true,
  options: ["Sales", "Support", "Other"],
};

const checkboxField: FormFieldConfig = {
  name: "agree",
  label: "I agree to terms",
  type: "checkbox",
  required: true,
};

const radioField: FormFieldConfig = {
  name: "preference",
  label: "Preference",
  type: "radio",
  required: true,
  options: ["Email", "Phone", "SMS"],
};

const allFields: FormFieldConfig[] = [
  textField,
  emailField,
  phoneField,
  textareaField,
  selectField,
  checkboxField,
  radioField,
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe("FormBuilder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders all field types", () => {
    render(<FormBuilder fields={allFields} />);

    expect(screen.getByPlaceholderText("Enter your name")).toBeDefined();
    expect(screen.getByPlaceholderText("you@example.com")).toBeDefined();
    expect(screen.getByPlaceholderText("+1 555 000 0000")).toBeDefined();
    expect(screen.getByText("Message")).toBeDefined();
    expect(screen.getByText("Interest")).toBeDefined();
    expect(screen.getByText("I agree to terms")).toBeDefined();
    // Radio options rendered for "preference" field
    expect(screen.getByDisplayValue("Email")).toBeDefined();
  });

  it("shows required field errors on empty submit", async () => {
    render(<FormBuilder fields={[textField, emailField, selectField, checkboxField, radioField]} />);

    fireEvent.click(screen.getByText("Submit"));

    await waitFor(() => {
      expect(screen.getByText("Full Name is required")).toBeDefined();
      expect(screen.getByText("Email is required")).toBeDefined();
      expect(screen.getByText("Interest is required")).toBeDefined();
      expect(screen.getByText("I agree to terms is required")).toBeDefined();
      expect(screen.getByText("Preference is required")).toBeDefined();
    });
  });

  it("validates email format", async () => {
    render(<FormBuilder fields={[emailField]} />);

    const input = screen.getByPlaceholderText("you@example.com");
    fireEvent.change(input, { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByText("Submit"));

    await waitFor(() => {
      expect(screen.getByText("Please enter a valid email address")).toBeDefined();
    });
  });

  it("validates phone format", async () => {
    const requiredPhone: FormFieldConfig = { ...phoneField, required: true };
    render(<FormBuilder fields={[requiredPhone]} />);

    const input = screen.getByPlaceholderText("+1 555 000 0000");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.click(screen.getByText("Submit"));

    await waitFor(() => {
      expect(screen.getByText("Please enter a valid phone number")).toBeDefined();
    });
  });

  it("clears field error on input change", async () => {
    render(<FormBuilder fields={[textField]} />);

    fireEvent.click(screen.getByText("Submit"));
    await waitFor(() => {
      expect(screen.getByText("Full Name is required")).toBeDefined();
    });

    fireEvent.change(screen.getByPlaceholderText("Enter your name"), {
      target: { value: "John" },
    });

    expect(screen.queryByText("Full Name is required")).toBeNull();
  });

  it("POSTs to /api/submissions on valid submit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "sub-1" } }), { status: 200 })
    );

    render(
      <FormBuilder
        fields={[textField]}
        formId="form-1"
        sourcePageSlug="contact"
        sourceLocale="en"
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Enter your name"), {
      target: { value: "Jane Doe" },
    });
    fireEvent.click(screen.getByText("Submit"));

    await waitFor(() => {
      expect(screen.getByText(/Thank you/)).toBeDefined();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        formId: "form-1",
        data: { fullName: "Jane Doe" },
        sourcePageSlug: "contact",
        sourceLocale: "en",
      }),
    });
  });

  it("shows server error on failed submit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Server error" }), { status: 500 })
    );

    render(<FormBuilder fields={[textField]} />);

    fireEvent.change(screen.getByPlaceholderText("Enter your name"), {
      target: { value: "Jane" },
    });
    fireEvent.click(screen.getByText("Submit"));

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeDefined();
    });
  });

  it("shows network error on fetch failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    render(<FormBuilder fields={[textField]} />);

    fireEvent.change(screen.getByPlaceholderText("Enter your name"), {
      target: { value: "Jane" },
    });
    fireEvent.click(screen.getByText("Submit"));

    await waitFor(() => {
      expect(screen.getByText("Network error. Please try again.")).toBeDefined();
    });
  });
});
