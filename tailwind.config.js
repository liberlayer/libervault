/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        vault: {
          bg:       "#080B10",
          surface:  "#0E1318",
          border:   "#1A2130",
          muted:    "#2A3444",
          text:     "#C8D8E8",
          dim:      "#627A96",
          accent:   "#00C2FF",
          accentDim:"#0077A8",
          green:    "#00E5A0",
          red:      "#FF4466",
          btc:      "#F7931A",
          eth:      "#627EEA",
          sol:      "#9945FF",
        },
      },
      fontFamily: {
        ui:   ["'Outfit'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      boxShadow: {
        accent: "0 0 20px rgba(0, 194, 255, 0.15)",
        glow:   "0 0 40px rgba(0, 194, 255, 0.08)",
      },
      animation: {
        "fade-in":    "fadeIn 0.2s ease-out",
        "slide-up":   "slideUp 0.25s ease-out",
        "pulse-slow": "pulse 3s cubic-bezier(0.4,0,0.6,1) infinite",
      },
      keyframes: {
        fadeIn:  { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
};
