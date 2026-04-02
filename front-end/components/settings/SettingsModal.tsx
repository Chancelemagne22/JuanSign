'use client';

import type { AppSettings } from '@/hooks/useSettings';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
};

export default function SettingsModal({ isOpen, onClose, settings, updateSetting }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/45 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border-4 border-[#BF7B45] bg-[#FFF3E5] p-5 shadow-[0_10px_24px_rgba(0,0,0,0.3)]"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-black text-[#7B3F00]" style={{ fontFamily: 'var(--font-spicy-rice)' }}>
            Settings
          </h2>
          <button
            onClick={onClose}
            className="rounded-full bg-[#E53935] px-3 py-1 text-sm font-black text-white shadow-[0_3px_0_#B71C1C]"
            aria-label="Close settings"
          >
            X
          </button>
        </div>

        <div className="space-y-4">
          <label className="flex items-center justify-between rounded-xl border border-[#D9A77B] bg-white/80 px-4 py-3">
            <span className="font-bold text-[#4A2C0A]">Sound Effects</span>
            <input
              type="checkbox"
              checked={settings.soundEffects}
              onChange={(event) => updateSetting('soundEffects', event.target.checked)}
              className="h-5 w-5 accent-[#FF9800]"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-[#D9A77B] bg-white/80 px-4 py-3">
            <span className="font-bold text-[#4A2C0A]">Background Music</span>
            <input
              type="checkbox"
              checked={settings.backgroundMusic}
              onChange={(event) => updateSetting('backgroundMusic', event.target.checked)}
              className="h-5 w-5 accent-[#FF9800]"
            />
          </label>

          <label className="block rounded-xl border border-[#D9A77B] bg-white/80 px-4 py-3">
            <span className="mb-2 block font-bold text-[#4A2C0A]">Language</span>
            <select
              value={settings.language}
              onChange={(event) => updateSetting('language', event.target.value as AppSettings['language'])}
              className="w-full rounded-lg border border-[#BF7B45] bg-white px-3 py-2 font-semibold text-[#4A2C0A] outline-none"
            >
              <option value="en">English</option>
              <option value="tl">Tagalog</option>
            </select>
          </label>

          <label className="flex items-center justify-between rounded-xl border border-[#D9A77B] bg-white/80 px-4 py-3">
            <span className="font-bold text-[#4A2C0A]">Show Assessment Timer</span>
            <input
              type="checkbox"
              checked={settings.showTimer}
              onChange={(event) => updateSetting('showTimer', event.target.checked)}
              className="h-5 w-5 accent-[#FF9800]"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-[#D9A77B] bg-white/80 px-4 py-3">
            <span className="font-bold text-[#4A2C0A]">Confirm Before Submit</span>
            <input
              type="checkbox"
              checked={settings.confirmSubmit}
              onChange={(event) => updateSetting('confirmSubmit', event.target.checked)}
              className="h-5 w-5 accent-[#FF9800]"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-[#D9A77B] bg-white/80 px-4 py-3">
            <span className="font-bold text-[#4A2C0A]">Allow Review Before Submit</span>
            <input
              type="checkbox"
              checked={settings.reviewBeforeSubmit}
              onChange={(event) => updateSetting('reviewBeforeSubmit', event.target.checked)}
              className="h-5 w-5 accent-[#FF9800]"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-[#D9A77B] bg-white/80 px-4 py-3">
            <span className="font-bold text-[#4A2C0A]">Show Lesson Captions</span>
            <input
              type="checkbox"
              checked={settings.showCaptions}
              onChange={(event) => updateSetting('showCaptions', event.target.checked)}
              className="h-5 w-5 accent-[#FF9800]"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-[#D9A77B] bg-white/80 px-4 py-3">
            <span className="font-bold text-[#4A2C0A]">Autoplay Next Lesson Video</span>
            <input
              type="checkbox"
              checked={settings.autoplayLesson}
              onChange={(event) => updateSetting('autoplayLesson', event.target.checked)}
              className="h-5 w-5 accent-[#FF9800]"
            />
          </label>

          <label className="block rounded-xl border border-[#D9A77B] bg-white/80 px-4 py-3">
            <span className="mb-2 block font-bold text-[#4A2C0A]">Lesson Playback Speed</span>
            <select
              value={settings.playbackSpeed}
              onChange={(event) =>
                updateSetting('playbackSpeed', Number(event.target.value) as AppSettings['playbackSpeed'])
              }
              className="w-full rounded-lg border border-[#BF7B45] bg-white px-3 py-2 font-semibold text-[#4A2C0A] outline-none"
            >
              <option value={0.75}>0.75x</option>
              <option value={1}>1.0x</option>
              <option value={1.25}>1.25x</option>
              <option value={1.5}>1.5x</option>
            </select>
          </label>

          <label className="flex items-center justify-between rounded-xl border border-[#D9A77B] bg-white/80 px-4 py-3">
            <span className="font-bold text-[#4A2C0A]">Shuffle Practice Questions</span>
            <input
              type="checkbox"
              checked={settings.shuffleQuestions}
              onChange={(event) => updateSetting('shuffleQuestions', event.target.checked)}
              className="h-5 w-5 accent-[#FF9800]"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-[#D9A77B] bg-white/80 px-4 py-3">
            <span className="font-bold text-[#4A2C0A]">Show Correct Answer After Submit</span>
            <input
              type="checkbox"
              checked={settings.showCorrectAnswer}
              onChange={(event) => updateSetting('showCorrectAnswer', event.target.checked)}
              className="h-5 w-5 accent-[#FF9800]"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
