'use client';

// COMPONENT: PracticeView
// Shows the webcam feed for the user to record their FSL sign.
// Controls: Record (▶), Pause (⏸), Restart (🔄), Stop (⏹).
// After stopping, Upload Video sends the clip to Modal for CNN prediction.

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/hooks/useLanguage';

interface Props {
  letter:       string;
  letterIndex:  number;
  totalLetters: number;
  levelId:      string;
  /** Called after the user finishes this letter (moves to next letter or assessment) */
  onNext:       () => void;
  /** Called with the accuracy (0.0–1.0) after each successful prediction */
  onResult?:    (accuracy: number) => void;
  /** Show lesson-style star progress bar (used by assessment only) */
  showStarBar?: boolean;
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
        bg-[#33AA11] border-[3px] border-[#33AA11]
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
      className="object-contain flex-shrink-0 w-[clamp(42px,6.5vw,70px)] h-auto"
    />
  );
}
export default function PracticeView({ letter, letterIndex, totalLetters, levelId, onNext, onResult, showStarBar = false }: Props) {
  const { t } = useLanguage();
  const videoRef   = useRef<HTMLVideoElement>(null);
  const mediaRef   = useRef<MediaRecorder | null>(null);
  const chunksRef  = useRef<Blob[]>([]);
  const streamRef  = useRef<MediaStream | null>(null);
  const pendingUploadRef = useRef(false);

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
          videoRef.current.play().catch((err: unknown) => {
            // Browser can throw AbortError if play is interrupted by a source reload.
            if (err instanceof DOMException && err.name === 'AbortError') return;
            console.warn('[PracticeView] camera preview play failed:', err);
          });
        }
      } catch {
        setCamError(t('practicePage.cameraAccessDenied'));
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

      if (pendingUploadRef.current) {
        pendingUploadRef.current = false;
        if (blob.size > 0) {
          void uploadPrediction(blob);
        } else {
          setFeedback(t('module.noVideoCaptured'));
        }
      }
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
    pendingUploadRef.current = false;
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
  async function uploadPrediction(blob: Blob) {
    if (isUploading) return;
    setIsUploading(true);
    setPredictionResult(null);

    try {
      // 1. JWT
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');

      // 2. Base64 encode blob
      const buffer   = await blob.arrayBuffer();
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

      // Validate the response contains required fields
      if (!result || typeof result !== 'object' || !('is_correct' in result)) {
        throw new Error('Invalid response from Modal: missing required fields');
      }

      // 4. Show result + notify parent
      setPredictionResult(result);
      setFeedback(
        result.is_correct
          ? `${t('module.niceJobSigned')} "${result.sign}" ${t('module.correctly')}`
          : `${t('module.notQuiteModelSaw')} "${result.sign}")`,
      );
      onResult?.(result.accuracy);

    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : '';

      // Recover from stale auth cookies/tokens without spamming console errors.
      if (message.includes('invalid refresh token') || message.includes('refresh token not found')) {
        await supabase.auth.signOut({ scope: 'local' });
        setFeedback(t('module.sessionExpired'));
        return;
      }

      console.error('[PracticeView] upload error:', err);
      setFeedback(t('module.uploadFailed'));
    } finally {
      setIsUploading(false);
    }
  }

  async function handleUploadPrediction() {
    if (isUploading) return;

    // If user taps upload while still recording, finalize first then auto-upload.
    if (recordState === 'recording' || recordState === 'paused') {
      pendingUploadRef.current = true;
      stopRecording();
      return;
    }

    if (!recordedBlob) {
      setFeedback(t('module.recordYourSign'));
      return;
    }

    if (recordedBlob.size === 0) {
      setFeedback(t('module.noVideoCaptured'));
      return;
    }

    await uploadPrediction(recordedBlob);
  }

  /* ── Derived button states ─────────────────────────────────────────────── */
  const isIdle      = recordState === 'idle';
  const isRecording = recordState === 'recording';
  const isPaused    = recordState === 'paused';
  const isDone      = recordState === 'done';

  const progressPct = totalLetters > 1 ? (letterIndex / (totalLetters - 1)) * 100 : 0;

  /* ── Bubble message ────────────────────────────────────────────────────── */
  const bubbleText = feedback
    ? feedback
    : isDone
      ? t('module.greatUpload')
      : `${t('module.showSignFor')} "${letter}"!`;

  return (
    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden lg:overflow-hidden flex flex-col gap-2 sm:gap-3 min-w-0">

      {/* ── Top row: Video left | Instructions right (same visual size) ───── */}
      <div className="shrink-0 grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 items-stretch min-w-0">
        {/* Left: Camera card */}
        <div className="relative w-full rounded-[20px] sm:rounded-[24px] border-[4px] sm:border-[6px] border-[#8B5E3C] overflow-hidden bg-[#D4956A] h-[180px] sm:h-[220px] lg:h-[280px]">
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
              <span className="text-white text-xs font-bold tracking-wide">{t('module.rec')}</span>
            </div>
          )}

          {/* Uploading spinner */}
          {isUploading && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3 z-20">
              <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
              <p className="text-white font-bold text-sm">{t('module.analyzing')}</p>
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
                {predictionResult.is_correct ? t('module.correct') : t('module.tryAgain')}
              </p>
              <p className="text-white/90 font-semibold text-sm">
                {t('module.aiSaw')} <span className="font-black">{predictionResult.sign}</span>
                {'  '}({Number(predictionResult.confidence ?? 0).toFixed(1)}%)
              </p>
              <button
                onClick={() => setPredictionResult(null)}
                className="mt-2 bg-white/20 hover:bg-white/30 text-white font-bold text-xs px-4 py-1.5 rounded-full transition-colors"
              >
                {t('module.dismiss')}
              </button>
            </div>
          )}

          {/* Controls overlay */}
          <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4 flex flex-wrap gap-2 z-10 max-w-[calc(100%-1.5rem)] sm:max-w-none">
            <ControlBtn
              onClick={isPaused ? resumeRecording : startRecording}
              disabled={isRecording || isDone}
              ariaLabel={isPaused ? t('module.resumeRecording') : t('module.startRecording')}
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            </ControlBtn>

            <ControlBtn onClick={pauseRecording} disabled={!isRecording} ariaLabel={t('module.pauseRecording')}>
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </ControlBtn>

            <ControlBtn onClick={resetRecording} disabled={isIdle} ariaLabel={t('module.restartRecording')}>
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
                <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
              </svg>
            </ControlBtn>

            <ControlBtn
              onClick={stopRecording}
              disabled={isIdle || isDone}
              ariaLabel={t('module.stopRecording')}
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
                <path d="M6 6h12v12H6z" />
              </svg>
            </ControlBtn>
          </div>
        </div>

        {/* Right: Instructions card (same height as video card) */}
        <div className="rounded-2xl border-2 border-[#BF7B45] bg-[#FFF7EA] px-4 sm:px-5 py-3 sm:py-4 shadow-[0_3px_10px_rgba(0,0,0,0.08)] h-[180px] sm:h-[220px] lg:h-[280px] overflow-y-auto">
          <p className="text-[#5D3A1A] font-black text-base sm:text-lg mb-2" style={{ fontFamily: 'var(--font-fredoka)' }}>
            {t('module.practiceStepsTitle')}
          </p>
          <ol className="list-decimal pl-5 space-y-2 text-[#4A2C0A] font-semibold text-[0.92rem] sm:text-[1rem] leading-relaxed" style={{ fontFamily: 'var(--font-fredoka)' }}>
            <li>{t('module.practiceStep1')}</li>
            <li>{t('module.practiceStep2')}</li>
            <li>{t('module.practiceStep3')}</li>
          </ol>
        </div>
      </div>

      {/* ── Below box: mascot | speech bubble | buttons ────────────────────── */}
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-end gap-1.5 sm:gap-2.5 px-1 min-w-0">

        {/* Left: mascot character */}
        <div className="self-center sm:self-auto shrink-0">
          <MascotPlaceholder />
        </div>

        {/* Center: speech bubble (+ optional star bar for assessment) */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5 sm:gap-2 items-stretch sm:items-start">

          {/* Speech bubble (tail points bottom-left toward mascot) */}
          <div className="self-stretch sm:self-start inline-flex w-full sm:w-fit max-w-full sm:max-w-[min(58vw,30rem)] bg-[#F8F8F8] border border-[#D9D9D9] rounded-[18px] rounded-bl-[8px] px-3.5 sm:px-4 py-2 sm:py-2.5 shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
            <p className="text-[#2E7D1C] font-black text-[clamp(0.82rem,1.3vw,0.95rem)] leading-snug">{bubbleText}</p>
          </div>

          {showStarBar && (
            <div className="relative self-stretch w-full h-8 flex items-center">
              <div className="absolute inset-x-4 my-auto h-3 bg-[#E8C49A] rounded-full border-2 border-[#E8C49A]" />
              <div
                className="absolute left-4 my-auto h-3 bg-[#33AA11] rounded-full transition-all duration-500"
                style={{ width: `calc((100% - 2rem) * ${progressPct / 100})` }}
              />
              {([0, 50, 100] as const).map((pct) => (
                <div
                  key={pct}
                  className="absolute z-10"
                  style={{
                    left: pct === 0 ? '1rem' : pct === 100 ? 'calc(100% - 1rem)' : '50%',
                    transform: 'translateX(-50%)',
                  }}
                >
                  <span
                    className={`text-[1.6rem] leading-none drop-shadow-sm ${
                      progressPct >= pct ? 'text-yellow-400' : 'text-gray-300'
                    }`}
                  >
                    ★
                  </span>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* Right: Upload Video + Next buttons */}
        <div className="w-full sm:w-auto sm:-translate-y-3 lg:-translate-y-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-2 flex-shrink-0">
          <button
            onClick={handleUploadPrediction}
            disabled={isUploading}
            className="
              w-full sm:w-auto
              bg-[#E5E5E5] border-2 border-[#E5E5E5] text-[#2a7abf]
              font-black text-sm px-5 py-2 rounded-full shadow-[0_4px_0_#BEBEBE,0_6px_12px_rgba(0,0,0,0.18)]
              hover:bg-[#DCDCDC] transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed
            "
          >
            {isUploading ? t('module.uploading') : t('module.uploadVideo')}
          </button>

          <button
            onClick={onNext}
            className="
              w-full sm:w-auto
              bg-[#33AA11] border-[3px] border-[#33AA11] text-white
              font-black text-sm px-5 py-2 rounded-full
              shadow-[0_4px_0_#165c00]
              active:translate-y-1 active:shadow-[0_1px_0_#165c00]
              transition-transform hover:brightness-110
            "
          >
            {letterIndex < totalLetters - 1 ? t('module.next') : t('module.finish')}
          </button>
        </div>

      </div>
    </div>
  );
}
