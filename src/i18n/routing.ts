import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "zh", "zh-TW", "ko", "ja", "fr", "es"],
  defaultLocale: "en",
});

export type Locale = (typeof routing.locales)[number];
