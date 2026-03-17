import "./globals.css";
import { BranchProvider } from "@/context/BranchContext";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";

export const metadata = {
  title: "Stockaroo",
  description: "Inventory & POS System",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192x192.png",
    apple: "/icons/icon-192x192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Stockaroo",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#111827",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* PWA Manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* iOS support */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Stockaroo" />

        {/* Apple Icons */}
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />

        {/* Windows */}
        <meta name="msapplication-TileColor" content="#111827" />
        <meta name="msapplication-TileImage" content="/icons/icon-192x192.png" />

        {/* Favicon */}
        <link rel="icon" href="/icons/icon-192x192.png" />
      </head>

      <body className="bg-gray-100">
        <BranchProvider>
          {children}
        </BranchProvider>

        <PWAInstallPrompt />
      </body>
    </html>
  );
}