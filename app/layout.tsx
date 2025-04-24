// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Head from 'next/head'; // Optional: May help with specific hydration issues if they reappear
import "./globals.css"; // Import global styles

const inter = Inter({ subsets: ["latin"] });

// Define application metadata
export const metadata: Metadata = {
  title: "ULE Homes Content Calendar",
  description: "ULE Homes Content Calendar powered by Next.js and GitHub",
  // Add icons etc. here if desired
  // icons: { icon: "/favicon.ico" }
};

// --- Simple Footer Component ---
function AppFooter() {
  const currentYear = new Date().getFullYear();
  return (
    <footer className="flex-shrink-0 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 py-4 px-4 md:px-6 lg:px-8">
      <div className="container mx-auto text-center text-sm text-gray-600 dark:text-gray-400">
        <p>
          © {currentYear} ULE Homes Content Calendar App. Built by{" "}
          <a
            href="https://linkedin.com/in/opemipo-akinwumi/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Opemipo Akinwumi
          </a>.
        </p>
      </div>
    </footer>
  );
}
// --- End Footer Component ---


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      {/* <head /> Adding this explicitly might help some rare hydration issues */}
      <body className={`${inter.className} flex flex-col min-h-screen bg-background text-foreground`}>
        {/* Main content area should grow to push footer down */}
        {/* Using flex-grow on the direct child containing the page content */}
        <div className="flex-grow flex flex-col"> {/* Ensure this container can flex its children */}
          {children} {/* page.tsx content renders here */}
        </div>

        {/* Footer stays at the bottom */}
        <AppFooter />
      </body>
    </html>
  );
}