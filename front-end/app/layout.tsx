import type { Metadata } from "next";
import { Baloo_2 } from "next/font/google";
import "../styles/globals.css";

const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["400", "700", "800"],
});

export const metadata: Metadata = {
  title: "JuanSign",
  description: "Learn Filipino Sign Language the fun way.",
  icons: {
    icon: "/images/svgs/iSign.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${baloo.variable} antialiased`}>{children}</body>
    </html>
  );
}
