"use client";

import { useState } from "react";
import GearIcon from "../../public/images/svgs/gear-icon.svg";
import Image from "next/image";
import { useLanguage } from "@/hooks/useLanguage";
import "@/styles/WelcomePage.css";

const LANGUAGES = ['en', 'tl'] as const;

interface WelcomeButtonsProps {
  onGetStarted: () => void;
  onLogin: () => void;
  onSettings: () => void;
}

export default function WelcomeButtons({ onGetStarted , onLogin }: WelcomeButtonsProps) {
  const { t } = useLanguage();

  return (
    <>
      {/* ── Get Started button ── */}
      <button onClick={onGetStarted} className="btn-get-started">
        {t('welcome.getStarted')}
      </button>

      {/* ── I already have an Account button ── */}
      <button onClick={onLogin} className="btn-have-account">
        {t('welcome.haveAccount')}
      </button>
    </>
  );
}

export function ControlsCluster({ onSettings }: Omit<WelcomeButtonsProps, 'onGetStarted' | 'onLogin'>) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { language, setLanguage, t, languageLabels } = useLanguage();

  const handleLangSelect = (lang: 'en' | 'tl') => {
    setLanguage(lang);
    setDropdownOpen(false);
  };

  return (
    <>
      {/* ── Top-right cluster: Language Dropdown + Settings button ── */}
      <div className="controls-cluster">

        {/* Language Dropdown */}
        <div className="lang-dropdown-wrapper">
          <button
            onClick={() => setDropdownOpen((prev) => !prev)}
            className="lang-btn"
            aria-label={t('settings.selectSiteLanguage')}
          >
            {t('common.languageLabel')}: {languageLabels[language]}
            <span className="lang-chevron">▼</span>
          </button>

          {/* Dropdown menu */}
          {dropdownOpen && (
            <ul className="lang-menu" role="listbox" aria-label={t('common.languageLabel')}>
              {LANGUAGES.map((lang) => (
                <li key={lang}>
                  <button
                    onClick={() => handleLangSelect(lang)}
                    className={`lang-option${lang === language ? " lang-option--selected" : ""}`}
                    role="option"
                    aria-selected={lang === language}
                  >
                    {languageLabels[lang]}
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
          aria-label={t('settings.openSettings')}
        >
          <Image src={GearIcon} alt={t('common.settings')} className="settings-icon" />
        </button>
      </div>
    </>
  );
}
