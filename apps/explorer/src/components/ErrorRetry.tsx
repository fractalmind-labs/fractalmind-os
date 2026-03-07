import { useState, useEffect, useCallback } from "react";

interface Props {
  error: string;
  onRetry: () => void;
}

export default function ErrorRetry({ error, onRetry }: Props) {
  const [countdown, setCountdown] = useState(15);
  const [paused, setPaused] = useState(false);

  const handleRetry = useCallback(() => {
    setCountdown(15);
    onRetry();
  }, [onRetry]);

  useEffect(() => {
    if (paused) return;
    if (countdown <= 0) {
      handleRetry();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, paused, handleRetry]);

  // Reset countdown when error changes
  useEffect(() => {
    setCountdown(15);
    setPaused(false);
  }, [error]);

  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          <svg
            className="w-5 h-5 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-red-300">
            Failed to load on-chain data
          </div>
          <div className="text-xs text-red-400/70 mt-1 break-words">
            {error}
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={handleRetry}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 transition-colors cursor-pointer"
            >
              Retry now
            </button>
            <button
              onClick={() => setPaused((p) => !p)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-red-400/60 hover:text-red-300 transition-colors cursor-pointer"
            >
              {paused ? "Resume" : "Pause"} auto-retry
            </button>
            {!paused && (
              <span className="text-xs text-red-400/50">
                Retrying in {countdown}s
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
