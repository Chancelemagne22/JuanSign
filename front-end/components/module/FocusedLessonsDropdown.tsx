'use client';

import { useEffect, useRef, useState } from 'react';

interface FocusedLesson {
  lesson_id: string;
  lesson_title: string;
  lesson_order: number;
}

interface FocusedLessonsDropdownProps {
  focusedLessons: FocusedLesson[];
  currentLessonId: string;
  levelId: string;
  onSelectLesson: (lessonId: string, lessonIndex: number) => void;
  loading?: boolean;
}

/**
 * COMPONENT: FocusedLessonsDropdown
 * Shows a dropdown with all focused lessons in the current level.
 * Allows quick navigation between them.
 * Styled as a small button with a downward chevron icon.
 */
export default function FocusedLessonsDropdown({
  focusedLessons,
  currentLessonId,
  levelId,
  onSelectLesson,
  loading = false,
}: FocusedLessonsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (focusedLessons.length === 0) return null;

  const currentFocused = focusedLessons.find(
    (l) => l.lesson_id === currentLessonId,
  );

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Dropdown trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
        aria-label="View focused lessons"
        aria-expanded={isOpen}
        className="
          w-11 h-11 rounded-full
          bg-[#33AA11] border-[3px] border-[#228800]
          flex items-center justify-center
          shadow-[0_4px_0_#165c00]
          active:translate-y-1 active:shadow-[0_1px_0_#165c00]
          transition-all hover:brightness-110
          disabled:opacity-40 disabled:cursor-not-allowed
        "
        title={`${focusedLessons.length} focused lesson${focusedLessons.length !== 1 ? 's' : ''}`}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 text-white transition-transform"
          fill="currentColor"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
          aria-hidden
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute bottom-full mb-2 left-0 bg-white rounded-lg shadow-lg border-2 border-[#228800] z-20 min-w-max">
          <p className="px-3 py-2 text-xs font-bold text-[#4A2C0A] border-b border-[#D4956A]">
            Focus on these lessons:
          </p>
          <ul className="max-h-64 overflow-y-auto">
            {focusedLessons.map((lesson, idx) => (
              <li key={lesson.lesson_id}>
                <button
                  onClick={() => {
                    onSelectLesson(lesson.lesson_id, lesson.lesson_order - 1);
                    setIsOpen(false);
                  }}
                  className={`
                    w-full text-left px-4 py-2 text-sm font-semibold transition-colors
                    ${
                      lesson.lesson_id === currentLessonId
                        ? 'bg-[#33AA11] text-white'
                        : 'text-[#4A2C0A] hover:bg-[#E8DCC8]'
                    }
                  `}
                >
                  <span className="inline-block w-6 text-center font-bold mr-2">
                    {lesson.lesson_order}
                  </span>
                  {lesson.lesson_title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
