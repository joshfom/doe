import { describe, it, expect, vi } from "vitest";
import { createTemplateRegistry, type PageTemplate } from "./index";

function makeValidTemplate(overrides: Partial<PageTemplate> = {}): PageTemplate {
  return {
    id: "test-template-1",
    name: "Test Template",
    description: "A test template",
    thumbnailId: "thumb-1",
    data: {
      root: { props: { title: "Test" } },
      content: [],
      zones: {},
    },
    ...overrides,
  };
}

describe("createTemplateRegistry", () => {
  describe("duplicate-ID rejection", () => {
    it("throws an error when registering a template with an existing ID", () => {
      const registry = createTemplateRegistry();

      const template = makeValidTemplate({ id: "duplicate-id", name: "First" });
      registry.register(template);

      const duplicate = makeValidTemplate({ id: "duplicate-id", name: "Second" });
      expect(() => registry.register(duplicate)).toThrowError(
        `Template with id "duplicate-id" already exists in the registry (attempted to register "Second")`
      );
    });

    it("allows registering templates with different IDs", () => {
      const registry = createTemplateRegistry();

      const template1 = makeValidTemplate({ id: "unique-1", name: "First" });
      const template2 = makeValidTemplate({ id: "unique-2", name: "Second" });

      registry.register(template1);
      registry.register(template2);

      expect(registry.getById("unique-1")).not.toBeNull();
      expect(registry.getById("unique-2")).not.toBeNull();
    });

    it("rejects a template whose ID matches a built-in template", () => {
      const registry = createTemplateRegistry();

      // The built-in template has id "ora-project-page"
      const duplicate = makeValidTemplate({
        id: "ora-project-page",
        name: "My Duplicate",
      });

      expect(() => registry.register(duplicate)).toThrowError(
        `Template with id "ora-project-page" already exists in the registry (attempted to register "My Duplicate")`
      );
    });
  });

  describe("built-in ORA templates", () => {
    it("list() returns exactly four templates with the correct ids", () => {
      const registry = createTemplateRegistry();
      const templates = registry.list();

      expect(templates).toHaveLength(4);

      const ids = templates.map((t) => t.id);
      expect(ids).toEqual([
        "ora-project-page",
        "why-bayn",
        "life-at-bayn",
        "about-ora",
      ]);
    });

    it("contains no starter-hero-page entry", () => {
      const registry = createTemplateRegistry();
      const templates = registry.list();

      const ids = templates.map((t) => t.id);
      expect(ids).not.toContain("starter-hero-page");
    });

    it("throws when constructing a registry with a deliberately invalid ORA template", async () => {
      // Get a valid template and the validator before resetting modules
      const oraModule = await import("./ora");
      const validTemplate = oraModule.oraProjectPageTemplate();
      const { validateOraPageTemplate } = oraModule;

      vi.resetModules();

      vi.doMock("./ora", () => ({
        oraProjectPageTemplate: () => {
          // Corrupt the first section's bgMode to "video" — invalid per ORA rules
          const corrupted = JSON.parse(JSON.stringify(validTemplate));
          if (corrupted.data.content.length > 0) {
            corrupted.data.content[0].props.bgMode = "video";
          }
          return corrupted;
        },
        whyBaynTemplate: oraModule.whyBaynTemplate,
        lifeAtBaynTemplate: oraModule.lifeAtBaynTemplate,
        aboutOraTemplate: oraModule.aboutOraTemplate,
        validateOraPageTemplate,
      }));

      // Dynamically import the registry factory so it picks up the mocked ora module
      const { createTemplateRegistry: createMockedRegistry } = await import("./index");

      expect(() => createMockedRegistry()).toThrowError(
        /ORA template.*failed validation/
      );

      vi.doUnmock("./ora");
    });
  });
});
