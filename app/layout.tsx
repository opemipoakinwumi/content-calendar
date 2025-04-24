// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css"; // Ensure Tailwind styles are imported

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Content Calendar",
  description: "Content Calendar powered by Next.js and GitHub",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {/* Add global header/footer/nav here if needed */}
        {children}
      </body>
    </html>
  );
}