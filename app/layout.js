import "./globals.css";

export const metadata = {
  title: "Finché l’audience non ci separi",
  description: "Un reality per due giocatori. Due telefoni. Una Produzione senza scrupoli.",
  applicationName: "Finché l’audience non ci separi",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Audience" },
  formatDetection: { telephone: false }
};

export const viewport = {
  themeColor: "#7d121c",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }) {
  return <html lang="it"><body>{children}</body></html>;
}
