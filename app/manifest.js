export default function manifest() {
  return {
    name: "Finché l’audience non ci separi",
    short_name: "Audience",
    description: "Un reality per due giocatori.",
    start_url: "/",
    display: "standalone",
    background_color: "#080808",
    theme_color: "#7d121c",
    orientation: "portrait",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
  };
}
