import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

// Turbopack note: the `await import()` is a runtime call but the
// resolved module is still cached by the bundler. Touch this file
// (e.g. by changing this comment) to force a re-evaluation when the
// underlying messages/<locale>.json file changes and HMR doesn't pick
// it up — common with next-intl 4.x under Next 15 Turbopack.
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
