/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', "system-ui", "sans-serif"],
        display: ['"Space Grotesk"', '"Inter"', "sans-serif"],
      },
      colors: {
        ink: { DEFAULT: "#eaf2f7", soft: "#a9bccb", mute: "#6f8598" },
        deep: { 950: "#040c16", 900: "#071526", 800: "#0c2036" },
        aqua: { DEFAULT: "#5ee6d8", dim: "#2bb5a8" },
        citrus: "#d4f36b",
      },
    },
  },
  plugins: [],
};
