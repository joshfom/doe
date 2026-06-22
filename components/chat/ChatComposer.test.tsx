import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { ChatComposer } from "./ChatComposer";
import { SLASH_COMMANDS } from "./prompt-sets";

/** A controlled host so the composer behaves exactly as in the app. */
function Host({
  onSubmit,
  sampleQuestions,
  promptHelper,
}: {
  onSubmit: (text: string) => void;
  sampleQuestions?: Array<{ id: string; label: string; prompt: string }>;
  promptHelper?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <ChatComposer
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      sampleQuestions={sampleQuestions}
      promptHelper={promptHelper}
    />
  );
}

describe("ChatComposer — fill-not-send slash menu", () => {
  it("Property 1: lists exactly the matching commands for a slash query", () => {
    render(<Host onSubmit={vi.fn()} />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "/over" } });

    const listbox = screen.getByRole("listbox", { name: "Slash commands" });
    const options = within(listbox).getAllByRole("option");
    const expected = SLASH_COMMANDS.filter(
      (c) =>
        c.command.toLowerCase().includes("over") ||
        c.label.toLowerCase().includes("over"),
    );
    expect(options).toHaveLength(expected.length);
    expect(options.length).toBeGreaterThan(0);
  });

  it("Property 2 / regression: selecting a command FILLS the input and never submits", () => {
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "/overview" } });
    const listbox = screen.getByRole("listbox", { name: "Slash commands" });
    const option = within(listbox).getAllByRole("option")[0];
    // mousedown is what the option binds (preventing blur before fill).
    fireEvent.mouseDown(option);

    const overview = SLASH_COMMANDS.find((c) => c.command === "overview")!;
    expect(textarea.value).toBe(overview.message);
    // Critical: the old behaviour auto-sent; the new behaviour must NOT.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Property 3: submit sends the current (edited) input verbatim", () => {
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;

    // Fill via slash menu, then edit, then submit with Enter.
    fireEvent.change(textarea, { target: { value: "/overview" } });
    const option = within(
      screen.getByRole("listbox", { name: "Slash commands" }),
    ).getAllByRole("option")[0];
    fireEvent.mouseDown(option);
    fireEvent.change(textarea, { target: { value: "Give me an overview now" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("Give me an overview now");
  });

  it("Property 2 (sample question): clicking a question fills, never submits", () => {
    const onSubmit = vi.fn();
    const questions = [
      { id: "q1", label: "Overview", prompt: "Give me an overview of today." },
    ];
    render(
      <Host onSubmit={onSubmit} promptHelper sampleQuestions={questions} />,
    );
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;

    // Open the helper popup, then click the question.
    fireEvent.click(screen.getByRole("button", { name: "Sample questions" }));
    const listbox = screen.getByRole("listbox", { name: "Sample questions" });
    fireEvent.mouseDown(within(listbox).getAllByRole("option")[0]);

    expect(textarea.value).toBe("Give me an overview of today.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Property 9: dismissing the prompt helper preserves input", () => {
    const questions = [{ id: "q1", label: "Overview", prompt: "Overview." }];
    render(
      <Host onSubmit={vi.fn()} promptHelper sampleQuestions={questions} />,
    );
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "my draft" } });

    const trigger = screen.getByRole("button", { name: "Sample questions" });
    fireEvent.click(trigger); // open
    fireEvent.click(trigger); // close without picking

    expect(textarea.value).toBe("my draft");
  });
});
