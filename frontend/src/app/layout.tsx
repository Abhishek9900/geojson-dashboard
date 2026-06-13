import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "react-hot-toast";
import { ReduxProvider } from "@/providers/ReduxProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "GeoJSON Farm Dashboard",
  description: "Upload, validate, analyse, and visualise GeoJSON farm boundary data.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-[#0f172a] text-slate-100 antialiased`}>
        <ReduxProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: "#1e293b",
                color: "#f1f5f9",
                border: "1px solid #334155",
              },
              success: { iconTheme: { primary: "#22c55e", secondary: "#0f172a" } },
              error: { iconTheme: { primary: "#ef4444", secondary: "#0f172a" } },
              duration: 4000,
            }}
          />
        </ReduxProvider>
      </body>
    </html>
  );
}
