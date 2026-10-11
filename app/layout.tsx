import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StudySpace AI | Academic Assistant",
  description: "Your AI study partner for assignments, quizzes, research, journals, and presentations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
