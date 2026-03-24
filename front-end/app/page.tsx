"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WelcomeButtons, { TRANSLATIONS } from "@/components/WelcomeButtons";
import { ControlsCluster } from "@/components/welcome/WelcomePage";
import SignupModal from "@/components/signup/SignupModal";
import LoginModal from "@/components/login/LoginModal";
import ForgotPasswordModal from "@/components/login/ForgotPasswordModal";
import UserProfileModal from "@/components/profile/UserProfileModal";
import WelcomeBG from "../public/images/svgs/welcome-bg.png";
import JuanTitle from "../public/images/svgs/juansign-title.svg";
import Image from "next/image";
import "@/styles/page.css";
import type { UserData } from "@/types/user";

export default function Home() {
  const router = useRouter();

  const [selectedLang, setSelectedLang] = useState<"English" | "Filipino">("English");
  const [showSignup,        setShowSignup]        = useState(false);
  const [showLogin,         setShowLogin]         = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showProfile,       setShowProfile]       = useState(false);
  const [user,              setUser]              = useState<UserData | null>(null);

  const t = TRANSLATIONS[selectedLang] || TRANSLATIONS["English"];

  function openSignup() { setShowLogin(false); setShowForgotPassword(false); setShowSignup(true); }
  function openLogin()  { setShowSignup(false); setShowForgotPassword(false); setShowLogin(true);  }
  function openForgotPassword() { setShowSignup(false); setShowLogin(false); setShowForgotPassword(true); }
  function closeAll()   { setShowSignup(false); setShowLogin(false); setShowForgotPassword(false); }

  /** Called by both LoginModal and SignupModal once auth succeeds */
  function handleAuthSuccess(userData: UserData) {
    setUser(userData);
    closeAll();
    setShowProfile(true);
  }

  /** Called when user clicks CONTINUE in UserProfileModal */
  function handleContinue() {
    setShowProfile(false);
    router.push("/dashboard");
  }

  return (
    <div className="welcome-root">

      <Image
        src={WelcomeBG}
        alt="Welcome"
        className="welcome-bg"
      />

      {/* Controls cluster at root level for fixed positioning */}
      <ControlsCluster
        onSettings={() => console.log("Settings")}
        selectedLang={selectedLang}
        setSelectedLang={setSelectedLang}
      />

      <div className="welcome-title-wrapper">
        <p className="welcome-title-text">{t.welcomeTo}</p>
      </div>

      <Image
        src={JuanTitle}
        alt="JuanSign"
        className="welcome-logo"
      />

      <div className="welcome-tagline-wrapper">
        <p className="welcome-tagline-text">{t.tagline}</p>
      </div>

      <div className="welcome-buttons-wrapper">
        <WelcomeButtons
          onGetStarted={openSignup}
          onLogin={openLogin}
          onSettings={() => console.log("Settings")}
          selectedLang={selectedLang}
          setSelectedLang={setSelectedLang}
        />
      </div>

      {showSignup && (
        <SignupModal
          onClose={closeAll}
          onLoginClick={openLogin}
          onSuccess={handleAuthSuccess}
        />
      )}

      {showLogin && (
        <LoginModal
          onClose={closeAll}
          onLogin={handleAuthSuccess}
          onSignupClick={openSignup}
          onForgotPasswordClick={openForgotPassword}
        />
      )}

      {showForgotPassword && (
        <ForgotPasswordModal
          onClose={closeAll}
          onBackToLogin={openLogin}
        />
      )}

      {showProfile && user && (
        <UserProfileModal
          user={user}
          onContinue={handleContinue}
          onClose={() => setShowProfile(false)}
        />
      )}

    </div>
  );
}
