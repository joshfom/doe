import { Elysia, t } from "elysia";
import { db } from "@/lib/cms/db";
import { siteSettings } from "@/lib/cms/schema";
import { eq } from "drizzle-orm";
import type { FooterConfig } from "@/lib/cms/types/footer-config";
import {
  DEFAULT_FOOTER_CONFIG_EN,
  DEFAULT_FOOTER_CONFIG_AR,
} from "@/lib/cms/types/footer-config";

export const footerRoutes = new Elysia({ prefix: "/footer-config" })
  // GET /footer-config/:locale
  .get(
    "/:locale",
    async ({ params, set }) => {
      const { locale } = params as { locale: string };
      if (!["en", "ar"].includes(locale)) {
        set.status = 400;
        return { error: "Invalid locale" };
      }

      const key = `footer_config_${locale}`;
      try {
        const [setting] = await db
          .select()
          .from(siteSettings)
          .where(eq(siteSettings.key, key));

        if (!setting) {
          // Return default config
          const defaultConfig =
            locale === "ar"
              ? DEFAULT_FOOTER_CONFIG_AR
              : DEFAULT_FOOTER_CONFIG_EN;
          return { data: defaultConfig };
        }

        const config: FooterConfig = JSON.parse(setting.value);
        return { data: config };
      } catch (err) {
        set.status = 500;
        return { error: `Failed to fetch footer config: ${err}` };
      }
    },
    {
      params: t.Object({
        locale: t.String(),
      }),
    }
  )

  // PUT /footer-config/:locale
  .put(
    "/:locale",
    async ({ params, body, set }) => {
      const { locale } = params as { locale: string };
      const config = body as Partial<FooterConfig>;

      if (!["en", "ar"].includes(locale)) {
        set.status = 400;
        return { error: "Invalid locale" };
      }

      const key = `footer_config_${locale}`;
      const updatedConfig: FooterConfig = {
        ...(locale === "ar"
          ? DEFAULT_FOOTER_CONFIG_AR
          : DEFAULT_FOOTER_CONFIG_EN),
        ...config,
        locale: locale as "en" | "ar",
        updatedAt: new Date().toISOString(),
      };

      try {
        // Upsert: if key exists, update; otherwise insert
        const [existing] = await db
          .select()
          .from(siteSettings)
          .where(eq(siteSettings.key, key));

        if (existing) {
          await db
            .update(siteSettings)
            .set({
              value: JSON.stringify(updatedConfig),
              updatedAt: new Date(),
            })
            .where(eq(siteSettings.key, key));
        } else {
          await db.insert(siteSettings).values({
            key,
            value: JSON.stringify(updatedConfig),
            updatedAt: new Date(),
          });
        }

        return { data: updatedConfig };
      } catch (err) {
        set.status = 500;
        return { error: `Failed to update footer config: ${err}` };
      }
    },
    {
      params: t.Object({
        locale: t.String(),
      }),
      body: t.Partial(
        (() => {
          const linkSchema = t.Object({
            label: t.String(),
            url: t.String(),
            target: t.Optional(
              t.Union([t.Literal("_self"), t.Literal("_blank")])
            ),
            rel: t.Optional(t.String()),
          });
          return t.Object({
            sections: t.Array(
              t.Object({
                name: t.String(),
                links: t.Optional(t.Array(linkSchema)),
                groups: t.Optional(
                  t.Array(
                    t.Object({
                      name: t.Optional(t.String()),
                      links: t.Array(linkSchema),
                    })
                  )
                ),
                columnSpan: t.Optional(
                  t.Union([t.Literal(1), t.Literal(2)])
                ),
              })
            ),
            recruitment: t.Object({
              email: t.String(),
              text: t.String(),
            }),
            newsletter: t.Object({
              enabled: t.Boolean(),
              label: t.String(),
              placeholder: t.String(),
            }),
            socials: t.Array(
              t.Object({
                platform: t.String(),
                icon: t.String(),
                url: t.String(),
                target: t.Optional(
                  t.Union([t.Literal("_self"), t.Literal("_blank")])
                ),
              })
            ),
            legalLinks: t.Optional(t.Array(linkSchema)),
            legal: t.String(),
            backToTopLabel: t.String(),
            showBrochureButton: t.Optional(t.Boolean()),
            brochureLabel: t.Optional(t.String()),
            brochureUrl: t.Optional(t.String()),
            theme: t.Optional(
              t.Object({
                background: t.String(),
                text: t.String(),
                accent: t.String(),
                sectionHeading: t.String(),
                border: t.String(),
                linkHover: t.String(),
              })
            ),
          });
        })()
      ),
    }
  );
