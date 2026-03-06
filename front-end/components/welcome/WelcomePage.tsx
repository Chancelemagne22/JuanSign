"use client";

import { useState } from "react";
import GearIcon from "../../public/images/svgs/gear-icon.svg";
import Image from "next/image";
import "@/styles/WelcomePage.css";

export type Language = "English" | "Filipino";

const LANGUAGES: Language[] = ["English", "Filipino"];

interface WelcomeButtonsProps {
  onGetStarted: () => void;
  onLogin: () => void;
  onSettings: () => void;
  selectedLang: Language;
  setSelectedLang: (lang: Language) => void;
}
const TRANSLATIONS = {
  English: {
    welcomeTo: "Welcome to",
    tagline: "Learn Filipino Sign Language the fun way.",
    getStarted: "Get Started",
    haveAccount: "I already have an Account",
    language: "Language",
  },
  Filipino: {
    welcomeTo: "Maligayang pagdating sa",
    tagline: "Matuto ng Filipino Sign Language sa masayang pamamaraan.",
    getStarted: "Magsimula",
    haveAccount: "Mayroon na akong Account",
    language: "Wika",
  },
};

export { TRANSLATIONS };

export default function WelcomeButtons({ onGetStarted , onLogin, onSettings, selectedLang, setSelectedLang }: WelcomeButtonsProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleLangSelect = (lang: Language) => {
    setSelectedLang(lang);
    setDropdownOpen(false);
  };

  const t = TRANSLATIONS[selectedLang] || TRANSLATIONS["English"];

  return (
    <>
      {/* ── Top-right cluster: Language Dropdown + Settings button ── */}
      <div className="controls-cluster">

        {/* Language Dropdown */}
        <div className="lang-dropdown-wrapper">
          <button
            onClick={() => setDropdownOpen((prev) => !prev)}
            className="lang-btn"
            aria-label="Select site language"
          >
            {t.language}: {selectedLang}
            <span className="lang-chevron">▼</span>
          </button>

          {/* Dropdown menu */}
          {dropdownOpen && (
            <ul className="lang-menu">
              {LANGUAGES.map((lang) => (
                <li key={lang}>
                  <button
                    onClick={() => handleLangSelect(lang)}
                    className={`lang-option${lang === selectedLang ? " lang-option--selected" : ""}`}
                  >
                    {lang}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Settings button */}
        <button
          onClick={onSettings}
          className="settings-btn"
          aria-label="Settings"
        >
          <Image src={GearIcon} alt="Settings" className="settings-icon" />
        </button>
      </div>

      {/* ── Get Started button ── */}
      <button onClick={onGetStarted} className="btn-get-started">
        {t.getStarted}
      </button>

      {/* ── I already have an Account button ── */}
      <button onClick={onLogin} className="btn-have-account">
        {t.haveAccount}
      </button>
    </>
  );
}
