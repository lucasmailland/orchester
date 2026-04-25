import type { Config } from "tailwindcss";
import { heroui } from "@heroui/react";
import { fontFamily } from "tailwindcss/defaultTheme";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", ...fontFamily.sans],
        mono: ["var(--font-geist-mono)", ...fontFamily.mono],
      },
      colors: {
        fichap: {
          primary: {
            DEFAULT: "#3B3BFF",
            subtle: "#F0F0FF",
            emphasis: "#1A1AFF",
            foreground: "#FFFFFF",
          },
          accent: {
            DEFAULT: "#7C3AED",
            subtle: "#F5F3FF",
            foreground: "#FFFFFF",
          },
          success: {
            DEFAULT: "#22C55E",
            subtle: "#F0FDF4",
            foreground: "#FFFFFF",
          },
          warning: {
            DEFAULT: "#F59E0B",
            subtle: "#FFFBEB",
            foreground: "#FFFFFF",
          },
          danger: {
            DEFAULT: "#EF4444",
            subtle: "#FEF2F2",
            foreground: "#FFFFFF",
          },
        },
      },
      borderRadius: {
        sm: "0.375rem",
        DEFAULT: "0.5rem",
        md: "0.625rem",
        lg: "0.75rem",
        xl: "1rem",
        "2xl": "1.25rem",
      },
      transitionTimingFunction: {
        apple: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      },
    },
  },
  plugins: [
    heroui({
      themes: {
        light: {
          colors: {
            primary: {
              DEFAULT: "#3B3BFF",
              foreground: "#ffffff",
              50: "#F0F0FF",
              100: "#E0E0FF",
              200: "#C7C7FF",
              300: "#A5A5FF",
              400: "#7272FF",
              500: "#3B3BFF",
              600: "#1A1AFF",
              700: "#0000E0",
              800: "#0000B0",
              900: "#000080",
            },
            secondary: {
              DEFAULT: "#7C3AED",
              foreground: "#ffffff",
            },
            success: { DEFAULT: "#22C55E" },
            warning: { DEFAULT: "#F59E0B" },
            danger: { DEFAULT: "#EF4444" },
          },
        },
        dark: {
          colors: {
            primary: {
              DEFAULT: "#6060FF",
              foreground: "#ffffff",
              50: "#1A1A3E",
              100: "#1E1E50",
              200: "#2A2A70",
              300: "#3535A0",
              400: "#4545CC",
              500: "#6060FF",
              600: "#8080FF",
              700: "#A0A0FF",
              800: "#C0C0FF",
              900: "#E0E0FF",
            },
            secondary: {
              DEFAULT: "#9B6FFF",
              foreground: "#ffffff",
            },
          },
        },
      },
    }),
  ],
};

export default config;
