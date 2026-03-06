'use client';

// COMPONENT: PracticeView
// Shows the webcam feed for the user to record their FSL sign.
// Controls: Record (▶), Pause (⏸), Restart (🔄), Stop (⏹).
// After stopping, the user can upload the recorded clip for ML prediction.
// The upload/prediction function is a stub — see handleUploadPrediction().

import { useEffect, useRef, useState } from 'react';

interface Props {
  letter:       string;
  letterIndex:  number;
  totalLetters: number;
  /** Called after the user finishes this letter (moves to next letter or assessment) */
  onNext: () => void;
}

type RecordState = 'idle' | 'recording' | 'paused' | 'done';

/* ── Green circular control button ─────────────────────────────────────────── */
function ControlBtn({
  onClick,
  disabled,
  ariaLabel,
  children,
}: {
  onClick:   () => void;
  disabled?: boolean;
  ariaLabel: string;
  children:  React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="
        w-11 h-11 rounded-full
        bg-[#33AA11] border-[3px] border-[#228800]
        flex items-center justify-center
        shadow-[0_4px_0_#165c00]
        active:translate-y-1 active:shadow-[0_1px_0_#165c00]
        transition-transform hover:brightness-110
        disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-[0_4px_0_#165c00]
      "
    >
      {children}
    </button>
  );
}

/* ── Mascot placeholder silhouette ──────────────────────────────────────────── */
// Replace this with <Image src="/images/characters/mascot.png" ...> once art is ready.
function MascotPlaceholder() {
  return (
    <div className="w-16 h-16 rounded-full bg-[#F5C47A] border-[3px] border-[#BF7B45] flex items-center justify-center flex-shrink-0">
      <svg viewBox="0 0 100 100" className="w-10 h-10 text-[#7B3F00]" fill="currentColor" aria-hidden>
        <circle cx="50" cy="33" r="20" />
        <ellipse cx="50" cy="80" rx="28" ry="18" />
      </svg>
    </div>
  );
}

export default function PracticeView({ letter, letterIndex, totalLetters, onNext }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const mediaRef   = useRef<MediaRecorder | null>(null);
  const chunksRef  = useRef<Blob[]>([]);
  const streamRef  = useRef<MediaStream | null>(null);

  const [recordState,  setRecordState]  = useState<RecordState>('idle');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [feedback,     setFeedback]     = useState<string | null>(null);
  const [camError,     setCamError]     = useState<string | null>(null);

  /* ── Start webcam on mount, stop tracks on unmount ────────────────────── */
  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      } catch {
        setCamError('Camera access denied. Please allow camera permissions and reload.');
      }
    }

    startCamera();

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /* ── Recording controls ────────────────────────────────────────────────── */
  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      setRecordedBlob(blob);
      setRecordState('done');
    };
    mediaRef.current = recorder;
    recorder.start();
    setRecordState('recording');
    setFeedback(null);
  }

  function pauseRecording() {
    if (mediaRef.current?.state === 'recording') {
      mediaRef.current.pause();
      setRecordState('paused');
    }
  }

  function resumeRecording() {
    if (mediaRef.current?.state === 'paused') {
      mediaRef.current.resume();
      setRecordState('recording');
    }
  }

  function resetRecording() {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop();
    }
    chunksRef.current = [];
    setRecordedBlob(null);
    setFeedback(null);
    setRecordState('idle');
  }

  function stopRecording() {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop(); // triggers onstop → sets recordState to 'done'
    }
  }

  /* ── ML Prediction Upload (STUB) ────────────────────────────────────────
   *
   * TODO: Implement when Modal endpoint is ready.
   *
   * Steps to implement:
   *   1. Convert recordedBlob to base64 string using FileReader.
   *   2. Get the current user's JWT:
   *        const { data: { session } } = await supabase.auth.getSession();
   *        const jwt = session?.access_token;
   *   3. POST to process.env.NEXT_PUBLIC_MODAL_ENDPOINT_URL:
   *        { video: base64String, token: jwt }
   *   4. Receive response: { sign: string, confidence: float }
   *   5. Compare response.sign to `letter` prop to determine correctness.
   *   6. Set feedback message based on result (correct / try again).
   *   7. Write result to Supabase:
   *        - INSERT into `practice_sessions` (auth_user_id, average_accuracy, ...)
   *        - INSERT into `cnn_feedback`       (accuracy_score, feedback_message, ...)
   *      Only Modal should write to cnn_feedback — move this logic to Modal if needed.
   *
   * ─────────────────────────────────────────────────────────────────────── */
  async function handleUploadPrediction() {
    if (!recordedBlob) return;

    // TODO: replace stub with real ML upload (see comment block above)
    console.log('[PracticeView] handleUploadPrediction stub — blob size:', recordedBlob.size);
    setFeedback('Nice job! You signed it right!'); // placeholder feedback
  }

  /* ── Derived button states ─────────────────────────────────────────────── */
  const isIdle      = recordState === 'idle';
  const isRecording = recordState === 'recording';
  const isPaused    = recordState === 'paused';
  const isDone      = recordState === 'done';

  /* ── Star progress bar ─────────────────────────────────────────────────── */
  // Fills based on how many letters have been practiced (letterIndex = 0-based current letter).
  const progressPct = totalLetters > 1 ? (letterIndex / (totalLetters - 1)) * 100 : 0;

  /* ── Bubble message ────────────────────────────────────────────────────── */
  const bubbleText = feedback
    ? feedback
    : isDone
      ? 'Great! Upload your video!'
      : `Show the sign for "${letter}"!`;

  return (
    <div className="flex flex-col gap-4">

      {/* ── Camera box ─────────────────────────────────────────────────────── */}
      <div
        className="relative w-full rounded-[24px] border-[6px] border-[#8B5E3C] overflow-hidden bg-[#D4956A]"
        style={{ aspectRatio: '16 / 10' }}
      >
        {camError ? (
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <p className="text-white font-semibold text-sm text-center">{camError}</p>
          </div>
        ) : (
          /* Mirror the feed so the user sees a selfie-style view */
          <video
            ref={videoRef}
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
          />
        )}

        {/* Recording indicator */}
        {isRecording && (
          <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1.5 z-10">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white text-xs font-bold tracking-wide">REC</span>
          </div>
        )}

        {/* ── Controls overlay (bottom-left inside the box) ───────────────── */}
        <div className="absolute bottom-4 left-4 flex gap-2.5 z-10">

          {/* Record / Resume */}
          <ControlBtn
            onClick={isPaused ? resumeRecording : startRecording}
            disabled={isRecording || isDone}
            ariaLabel={isPaused ? 'Resume recording' : 'Start recording'}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          </ControlBtn>

          {/* Pause */}
          <ControlBtn onClick={pauseRecording} disabled={!isRecording} ariaLabel="Pause recording">
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          </ControlBtn>

          {/* Restart — discard current recording and go back to idle */}
          <ControlBtn onClick={resetRecording} disabled={isIdle} ariaLabel="Restart recording">
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
              <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
            </svg>
          </ControlBtn>

          {/* Stop — finalize recording */}
          <ControlBtn
            onClick={stopRecording}
            disabled={isIdle || isDone}
            ariaLabel="Stop recording"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
              <path d="M6 6h12v12H6z" />
            </svg>
          </ControlBtn>

        </div>
      </div>

      {/* ── Below box: mascot + star bar + upload/next ──────────────────────── */}
      <div className="flex items-center gap-4 px-1">

        {/* Mascot + speech bubble */}
        <div className="flex items-end gap-2 flex-shrink-0">
          <MascotPlaceholder />
          <div className="relative bg-white border-2 border-[#BF7B45] rounded-2xl rounded-bl-none px-3 py-2 max-w-[190px] shadow-sm">
            <p className="text-[#2E7D1C] font-black text-xs leading-snug">{bubbleText}</p>
          </div>
        </div>

        {/* Star progress bar */}
        <div className="flex-1 flex items-center">
          <div className="relative w-full h-8 flex items-center">
            {/* Track */}
            <div className="absolute inset-x-4 my-auto h-3 bg-[#E8C49A] rounded-full border-2 border-[#BF7B45]" />
            {/* Fill */}
            <div
              className="absolute left-4 my-auto h-3 bg-[#33AA11] rounded-full transition-all duration-500"
              style={{ width: `calc((100% - 2rem) * ${progressPct / 100})` }}
            />
            {/* Stars at 0%, 50%, 100% of the bar */}
            {([0, 50, 100] as const).map((pct) => (
              <div
                key={pct}
                className="absolute z-10"
                style={{
                  left:      pct === 0   ? '1rem' : pct === 100 ? 'calc(100% - 1rem)' : '50%',
                  transform: pct === 0   ? 'translateX(-50%)' : pct === 100 ? 'translateX(-50%)' : 'translateX(-50%)',
                }}
              >
                <span
                  className={`text-2xl leading-none drop-shadow-sm ${
                    progressPct >= pct ? 'text-yellow-400' : 'text-gray-300'
                  }`}
                >
                  ★
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Upload Video + Next buttons */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <button
            onClick={handleUploadPrediction}
            disabled={!isDone}
            className="
              bg-white border-2 border-[#BF7B45] text-[#2a7abf]
              font-black text-sm px-5 py-2 rounded-full shadow-sm
              hover:bg-[#f0f8ff] transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed
            "
          >
            Upload Video
          </button>

          <button
            onClick={onNext}
            className="
              bg-[#33AA11] border-[3px] border-[#228800] text-white
              font-black text-sm px-5 py-2 rounded-full
              shadow-[0_4px_0_#165c00]
              active:translate-y-1 active:shadow-[0_1px_0_#165c00]
              transition-transform hover:brightness-110
            "
          >
            {letterIndex < totalLetters - 1 ? 'Next →' : 'Finish →'}
          </button>
        </div>

      </div>
    </div>
  );
}
