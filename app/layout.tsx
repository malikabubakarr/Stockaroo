import "./globals.css";
import { BranchProvider } from "@/context/BranchContext";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";
import SessionManager from "@/components/SessionManager";
// 🚀 NEW: Global session keeper
import { extendPOSSession } from "@/lib/auth";

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
    statusBarStyle: "default",
    title: "Stockaroo",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#ffffff",
};

// 🚀 NEW: Keep 12hr session alive globally
if (typeof window !== "undefined") {
  // Extend session every 30min
  setInterval(extendPOSSession, 30 * 60 * 1000);
  
  // Extend on any page load
  extendPOSSession();
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light">
      <head>
        {/* FORCE LIGHT MODE */}
        <meta name="color-scheme" content="light" />
        <meta name="theme-color" content="#ffffff" />

        {/* PWA Manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* iOS Support */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Stockaroo" />

        {/* Apple Icon */}
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />

        {/* Windows */}
        <meta name="msapplication-TileColor" content="#ffffff" />
        <meta name="msapplication-TileColor" content="/icons/icon-192x192.png" />

        {/* Favicon */}
        <link rel="icon" href="/icons/icon-192x192.png" />
      </head>

      {/* FORCE LIGHT UI */}
      <body className="bg-white text-gray-900">
        <BranchProvider>
          <SessionManager />
          {children}
        </BranchProvider>

        <PWAInstallPrompt />
      </body>
    </html>
  );
}