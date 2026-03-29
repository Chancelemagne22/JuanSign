'use client';

// COMPONENT: PracticeView
// Shows the webcam feed for the user to record their FSL sign.
// Controls: Record (▶), Pause (⏸), Restart (🔄), Stop (⏹).
// After stopping, Upload Video sends the clip to Modal for CNN prediction.

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';

interface Props {
  letter:       string;
  letterIndex:  number;
  totalLetters: number;
  levelId:      string;
  /** Called after the user finishes this letter (moves to next letter or assessment) */
  onNext:       () => void;
  /** Called with the accuracy (0.0–1.0) after each successful prediction */
  onResult?:    (accuracy: number) => void;
}

type RecordState = 'idle' | 'recording' | 'paused' | 'done';

interface PredictionResult {
  sign:       string;
  confidence: number;
  is_correct: boolean;
  accuracy:   number;
}

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
/* ── Mascot ──────────────────────────────────────────────────────────────── */
function MascotPlaceholder() {
  return (
    <Image
      src="/images/characters/mascot.png"
      alt="JuanSign Mascot"
      width={90}
      height={110}
      className="object-contain flex-shrink-0"
    />
  );
}
export default function PracticeView({ letter, letterIndex, totalLetters, levelId, onNext, onResult }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const mediaRef   = useRef<MediaRecorder | null>(null);
  const chunksRef  = useRef<Blob[]>([]);
  const streamRef  = useRef<MediaStream | null>(null);

  const [recordState,      setRecordState]      = useState<RecordState>('idle');
  const [recordedBlob,     setRecordedBlob]     = useState<Blob | null>(null);
  const [feedback,         setFeedback]         = useState<string | null>(null);
  const [camError,         setCamError]         = useState<string | null>(null);
  const [isUploading,      setIsUploading]      = useState(false);
  const [predictionResult, setPredictionResult] = useState<PredictionResult | null>(null);

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

  /* ── ML Prediction Upload ────────────────────────────────────────────────
   * 1. Base64-encode the recorded blob.
   * 2. Get the Supabase JWT for the current session.
   * 3. POST to Modal endpoint → { sign, confidence, is_correct, accuracy }.
   * 4. Modal writes cnn_feedback to Supabase (service role).
   * 5. Show result overlay; call onResult() so the page can track accuracy.
   * ─────────────────────────────────────────────────────────────────────── */
  async function handleUploadPrediction() {
    if (!recordedBlob || isUploading) return;
    setIsUploading(true);
    setPredictionResult(null);

    try {
      // 1. JWT
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');

      // 2. Base64 encode blob
      const buffer   = await recordedBlob.arrayBuffer();
      const bytes    = new Uint8Array(buffer);
      let   binary   = '';
      bytes.forEach((b) => (binary += String.fromCharCode(b)));
      const base64Video = btoa(binary);

      // 3. POST to Next.js proxy (avoids CORS — server calls Modal directly)
      const res = await fetch('/api/predict', {
        method:  'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          video:         base64Video,
          expected_sign: letter,
          level_id:      levelId,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(`Modal error ${res.status}: ${errBody.detail ?? 'unknown'}`);
      }
      const result: PredictionResult = await res.json();

      // 4. Show result + notify parent
      setPredictionResult(result);
      setFeedback(
        result.is_correct
          ? `Nice job! You signed "${result.sign}" correctly!`
          : `Not quite — try again! (model saw "${result.sign}")`,
      );
      onResult?.(result.accuracy);

    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : '';

      // Recover from stale auth cookies/tokens without spamming console errors.
      if (message.includes('invalid refresh token') || message.includes('refresh token not found')) {
        await supabase.auth.signOut({ scope: 'local' });
        setFeedback('Session expired. Please log in again.');
        return;
      }

      console.error('[PracticeView] upload error:', err);
      setFeedback('Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
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
    <div className="flex flex-col gap-4 h-full">

      {/* ── Camera box — portrait 3:6, centred horizontally ───────────────── */}
      <div className="flex-1 min-h-0 flex justify-center">
      <div
        className="relative h-full rounded-[24px] border-[6px] border-[#8B5E3C] overflow-hidden bg-[#D4956A]"
        style={{ aspectRatio: '6/3' }}
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
            className="absolute inset-0 w-full h-full object-contain scale-x-[-1]"
          />
        )}

        {/* Recording indicator */}
        {isRecording && (
          <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1.5 z-10">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white text-xs font-bold tracking-wide">REC</span>
          </div>
        )}

        {/* Uploading spinner */}
        {isUploading && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3 z-20">
            <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
            <p className="text-white font-bold text-sm">Analysing…</p>
          </div>
        )}

        {/* Prediction result overlay */}
        {predictionResult && !isUploading && (
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center gap-2 z-20
              ${predictionResult.is_correct ? 'bg-green-600/80' : 'bg-red-600/80'}`}
          >
            <span className="text-5xl">{predictionResult.is_correct ? '✓' : '✗'}</span>
            <p className="text-white font-black text-lg">
              {predictionResult.is_correct ? 'Correct!' : 'Try Again'}
            </p>
            <p className="text-white/90 font-semibold text-sm">
              AI saw: <span className="font-black">{predictionResult.sign}</span>
              {'  '}({Number(predictionResult.confidence ?? 0).toFixed(1)}%)
            </p>
            <button
              onClick={() => setPredictionResult(null)}
              className="mt-2 bg-white/20 hover:bg-white/30 text-white font-bold text-xs px-4 py-1.5 rounded-full transition-colors"
            >
              Dismiss
            </button>
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
      </div>

      {/* ── Below box: mascot | speech bubble + star bar | buttons ─────────── */}
      <div className="flex items-end gap-3 px-1">

        {/* Left: mascot character */}
        <MascotPlaceholder />

        {/* Center: speech bubble stacked above star bar — same width, aligned */}
        <div className="flex-1 flex flex-col gap-2">

          {/* Speech bubble (tail points bottom-left toward mascot) */}
          <div className="bg-[#E8E8E8] border border-[#C8C8C8] rounded-2xl rounded-bl-none px-4 py-2.5 shadow-sm">
            <p className="text-[#2E7D1C] font-black text-sm leading-snug">{bubbleText}</p>
          </div>

          {/* Star progress bar */}
          <div className="relative w-full h-9 flex items-center">
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
                  left:      pct === 0 ? '1rem' : pct === 100 ? 'calc(100% - 1rem)' : '50%',
                  transform: 'translateX(-50%)',
                }}
              >
                <span
                  className={`text-3xl leading-none drop-shadow-sm ${
                    progressPct >= pct ? 'text-yellow-400' : 'text-gray-300'
                  }`}
                >
                  ★
                </span>
              </div>
            ))}
          </div>

        </div>

        {/* Right: Upload Video + Next buttons */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <button
            onClick={handleUploadPrediction}
            disabled={!isDone || isUploading}
            className="
              bg-white border-2 border-[#BF7B45] text-[#2a7abf]
              font-black text-sm px-5 py-2 rounded-full shadow-sm
              hover:bg-[#f0f8ff] transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed
            "
          >
            {isUploading ? 'Uploading…' : 'Upload Video'}
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
