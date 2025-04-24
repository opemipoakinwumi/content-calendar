// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Content Calendar",
  description: "Content Calendar powered by Next.js and GitHub",
};

// --- Footer Component Definition (Inline) ---
function AppFooter() {
  const currentYear = new Date().getFullYear();
  return (
    <footer className="mt-auto bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 py-4 px-4 md:px-6 lg:px-8">
      <div className="container mx-auto text-center text-sm text-gray-600 dark:text-gray-400">
        <p>
          © {currentYear} Content Calendar App. Built by
          <a
            href="https://nextjs.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Opemipo Akinwumi
          </a>
        </p>
      </div>
    </footer>
  );
}
// --- End Footer Component Definition ---


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      {/* Ensure NO whitespace, newlines, or comments here */}
      <body className={`${inter.className} flex flex-col min-h-screen bg-background text-foreground`}>
        {/* Main Content Area */}
        <div className="flex-grow">
          {children}
        </div>

        {/* Footer */}
        <AppFooter />
      </body>
    </html>
  );
}