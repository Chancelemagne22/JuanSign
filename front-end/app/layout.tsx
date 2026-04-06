import type { Metadata } from "next";
import { Baloo_2, Spicy_Rice, Fredoka } from "next/font/google";
import { SessionRefreshProvider } from "@/components/SessionRefreshProvider";
import SettingsModal from "@/components/settings/SettingsModal";
import { LanguageProvider } from "@/context/LanguageContext";
import { SettingsProvider } from "@/hooks/useSettings";
import "../styles/globals.css";

const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["400", "700", "800"],
});

const spicyRice = Spicy_Rice({
  variable: "--font-spicy-rice",
  subsets: ["latin"],
  weight: "400",
});

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
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
      <body className={`${baloo.variable} ${spicyRice.variable} ${fredoka.variable} antialiased`}>
        <LanguageProvider>
          <SessionRefreshProvider>
            <SettingsProvider>
              {children}
              <SettingsModal />
            </SettingsProvider>
          </SessionRefreshProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
