// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { OraColorPicker } from "./OraColorPicker";

const RECENTS_KEY = "ora.colorPicker.recents";

describe("OraColorPicker", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("emits hex when a preset is clicked", () => {
    let captured: string | null = null;
    const { getAllByRole } = render(
      <OraColorPicker
        value="#FFFFFF"
        onChange={(v) => {
          captured = v;
        }}
        disableEyedropper
      />,
    );
    const presetButtons = getAllByRole("button").filter((b) =>
      b.getAttribute("aria-label")?.startsWith("Select #"),
    );
    expect(presetButtons.length).toBeGreaterThan(0);
    fireEvent.click(presetButtons[2]);
    expect(captured).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("highlights the matching preset", () => {
    const { getAllByRole } = render(
      <OraColorPicker value="#B8956B" onChange={() => {}} disableEyedropper />,
    );
    const active = getAllByRole("button").filter(
      (b) => b.getAttribute("aria-pressed") === "true",
    );
    expect(active.length).toBe(1);
  });

  it("commits valid hex on blur and reverts invalid hex", () => {
    const captured: string[] = [];
    const { getByLabelText, rerender } = render(
      <OraColorPicker
        value="#FFFFFF"
        onChange={(v) => captured.push(v)}
        disableEyedropper
      />,
    );
    const hex = getByLabelText("Hex value") as HTMLInputElement;

    fireEvent.change(hex, { target: { value: "#123456" } });
    fireEvent.blur(hex);
    expect(captured.at(-1)).toBe("#123456");

    rerender(
      <OraColorPicker
        value="#123456"
        onChange={(v) => captured.push(v)}
        disableEyedropper
      />,
    );
    fireEvent.change(hex, { target: { value: "not-a-color" } });
    fireEvent.blur(hex);
    expect(hex.value).toBe("#123456"); // reverted
  });

  it("persists recent colors in localStorage (max 8, dedup)", () => {
    let value = "#FFFFFF";
    const { getAllByRole, rerender } = render(
      <OraColorPicker
        value={value}
        onChange={(v) => {
          value = v;
        }}
        disableEyedropper
      />,
    );

    // click 3 distinct presets
    const presetButtons = () =>
      getAllByRole("button").filter((b) =>
        b.getAttribute("aria-label")?.startsWith("Select #"),
      );

    for (let i = 0; i < 3; i++) {
      fireEvent.click(presetButtons()[i]);
      rerender(
        <OraColorPicker
          value={value}
          onChange={(v) => {
            value = v;
          }}
          disableEyedropper
        />,
      );
    }

    const stored = JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? "[]");
    expect(Array.isArray(stored)).toBe(true);
    expect(stored.length).toBe(3);
    expect(new Set(stored).size).toBe(3);
  });

  it("renders alpha slider only when allowAlpha is true", () => {
    const { queryByLabelText, rerender } = render(
      <OraColorPicker value="#FFFFFF" onChange={() => {}} disableEyedropper />,
    );
    expect(queryByLabelText("Opacity")).toBeNull();

    rerender(
      <OraColorPicker value="#FFFFFFFF" onChange={() => {}} allowAlpha disableEyedropper />,
    );
    expect(queryByLabelText("Opacity")).not.toBeNull();
  });
});
