import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        mist: "#f4f4f5",
        panel: "#ffffff",
        coral: "#ff5a5f",
        sky: "#dbeafe",
      },
      fontFamily: {
        sans: ["'Instrument Sans'", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
