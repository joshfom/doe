import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { FormTracker, AutoFormTracker } from "./form-tracker";

// Mock posthog-js
vi.mock("posthog-js", () => ({
  default: {
    capture: vi.fn(),
  },
}));

import posthog from "posthog-js";

const mockedCapture = vi.mocked(posthog.capture);

describe("FormTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("Task 16.1: form_started event", () => {
    it("fires form_started on first focusin to an input (once only)", () => {
      const { container } = render(
        <FormTracker>
          <form>
            <input name="email" type="email" />
            <input name="phone" type="tel" />
          </form>
        </FormTracker>
      );

      const emailInput = container.querySelector('input[name="email"]')!;
      const phoneInput = container.querySelector('input[name="phone"]')!;

      // First focus fires form_started
      fireEvent.focusIn(emailInput);
      expect(mockedCapture).toHaveBeenCalledWith("form_started");

      mockedCapture.mockClear();

      // Second focus does NOT fire form_started again
      fireEvent.focusIn(phoneInput);
      expect(mockedCapture).not.toHaveBeenCalledWith("form_started");
    });

    it("does not fire form_started for non-form-field elements", () => {
      const { container } = render(
        <FormTracker>
          <form>
            <button type="button">Click me</button>
          </form>
        </FormTracker>
      );

      const button = container.querySelector("button")!;
      fireEvent.focusIn(button);
      expect(mockedCapture).not.toHaveBeenCalled();
    });
  });

  describe("Task 16.1: form_field_focused event", () => {
    it("fires form_field_focused on every focusin with field name", () => {
      const { container } = render(
        <FormTracker>
          <form>
            <input name="email" type="email" />
            <input name="phone" type="tel" />
          </form>
        </FormTracker>
      );

      const emailInput = container.querySelector('input[name="email"]')!;
      const phoneInput = container.querySelector('input[name="phone"]')!;

      fireEvent.focusIn(emailInput);
      expect(mockedCapture).toHaveBeenCalledWith("form_field_focused", { field: "email" });

      fireEvent.focusIn(phoneInput);
      expect(mockedCapture).toHaveBeenCalledWith("form_field_focused", { field: "phone" });

      // Focusing same field again still fires
      fireEvent.focusIn(emailInput);
      expect(mockedCapture).toHaveBeenCalledTimes(4); // 1 form_started + 3 form_field_focused
    });

    it("uses element id when name is not available", () => {
      const { container } = render(
        <FormTracker>
          <form>
            <input id="my-field" type="text" />
          </form>
        </FormTracker>
      );

      const input = container.querySelector("#my-field")!;
      fireEvent.focusIn(input);
      expect(mockedCapture).toHaveBeenCalledWith("form_field_focused", { field: "my-field" });
    });

    it("works with select and textarea elements", () => {
      const { container } = render(
        <FormTracker>
          <form>
            <select name="country"><option>US</option></select>
            <textarea name="message" />
          </form>
        </FormTracker>
      );

      const select = container.querySelector('select[name="country"]')!;
      const textarea = container.querySelector('textarea[name="message"]')!;

      fireEvent.focusIn(select);
      expect(mockedCapture).toHaveBeenCalledWith("form_field_focused", { field: "country" });

      fireEvent.focusIn(textarea);
      expect(mockedCapture).toHaveBeenCalledWith("form_field_focused", { field: "message" });
    });
  });

  describe("Task 16.1: form_field_abandoned event", () => {
    it("fires form_field_abandoned after 30min timeout when field has value", () => {
      const { container } = render(
        <FormTracker>
          <form>
            <input name="email" type="email" />
          </form>
        </FormTracker>
      );

      const input = container.querySelector('input[name="email"]') as HTMLInputElement;

      // Focus and type a value
      fireEvent.focusIn(input);
      fireEvent.change(input, { target: { value: "test@example.com" } });
      fireEvent.focusOut(input);

      // Not fired immediately
      expect(mockedCapture).not.toHaveBeenCalledWith("form_field_abandoned", expect.anything());

      // Advance 30 minutes
      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(mockedCapture).toHaveBeenCalledWith("form_field_abandoned", { field: "email" });
    });

    it("does not fire form_field_abandoned when field value is empty", () => {
      const { container } = render(
        <FormTracker>
          <form>
            <input name="email" type="email" />
          </form>
        </FormTracker>
      );

      const input = container.querySelector('input[name="email"]') as HTMLInputElement;

      fireEvent.focusIn(input);
      fireEvent.focusOut(input); // value is empty

      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(mockedCapture).not.toHaveBeenCalledWith("form_field_abandoned", expect.anything());
    });

    it("clears abandon timeout when field gets focus again", () => {
      const { container } = render(
        <FormTracker>
          <form>
            <input name="email" type="email" />
          </form>
        </FormTracker>
      );

      const input = container.querySelector('input[name="email"]') as HTMLInputElement;

      // Focus, type, blur
      fireEvent.focusIn(input);
      fireEvent.change(input, { target: { value: "test@example.com" } });
      fireEvent.focusOut(input);

      // Focus again before timeout
      vi.advanceTimersByTime(10 * 60 * 1000); // 10 minutes
      fireEvent.focusIn(input);

      // Advance past original timeout
      vi.advanceTimersByTime(25 * 60 * 1000);

      expect(mockedCapture).not.toHaveBeenCalledWith("form_field_abandoned", expect.anything());
    });
  });

  describe("Task 16.1: form_submitted event", () => {
    it("fires form_submitted on form submit", () => {
      const { container } = render(
        <FormTracker>
          <form>
            <input name="email" type="email" />
            <button type="submit">Submit</button>
          </form>
        </FormTracker>
      );

      const form = container.querySelector("form")!;
      fireEvent.submit(form);

      expect(mockedCapture).toHaveBeenCalledWith("form_submitted");
    });

    it("clears abandon timers on submit", () => {
      const { container } = render(
        <FormTracker>
          <form>
            <input name="email" type="email" />
            <button type="submit">Submit</button>
          </form>
        </FormTracker>
      );

      const input = container.querySelector('input[name="email"]') as HTMLInputElement;
      const form = container.querySelector("form")!;

      // Focus, type, blur (starts abandon timer)
      fireEvent.focusIn(input);
      fireEvent.change(input, { target: { value: "test@example.com" } });
      fireEvent.focusOut(input);

      // Submit the form
      fireEvent.submit(form);

      // Advance past timeout
      vi.advanceTimersByTime(30 * 60 * 1000);

      // form_field_abandoned should NOT have been fired
      expect(mockedCapture).not.toHaveBeenCalledWith("form_field_abandoned", expect.anything());
    });
  });

  describe("Task 16.2: AutoFormTracker", () => {
    it("renders children and applies form tracking", () => {
      const { container } = render(
        <AutoFormTracker>
          <form>
            <input name="email" type="email" />
          </form>
        </AutoFormTracker>
      );

      const input = container.querySelector('input[name="email"]')!;
      fireEvent.focusIn(input);

      expect(mockedCapture).toHaveBeenCalledWith("form_started");
      expect(mockedCapture).toHaveBeenCalledWith("form_field_focused", { field: "email" });
    });

    it("auto-detects forms without manual configuration", () => {
      // Simulates a dynamically rendered form component
      const { container } = render(
        <AutoFormTracker>
          <div>
            <h2>Contact Us</h2>
            <form>
              <input name="name" type="text" />
              <input name="email" type="email" />
              <textarea name="message" />
              <button type="submit">Send</button>
            </form>
          </div>
        </AutoFormTracker>
      );

      const nameInput = container.querySelector('input[name="name"]')!;
      const form = container.querySelector("form")!;

      fireEvent.focusIn(nameInput);
      expect(mockedCapture).toHaveBeenCalledWith("form_started");
      expect(mockedCapture).toHaveBeenCalledWith("form_field_focused", { field: "name" });

      fireEvent.submit(form);
      expect(mockedCapture).toHaveBeenCalledWith("form_submitted");
    });
  });
});
