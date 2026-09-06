"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="py-24 text-center">
      <h1 className="text-[20px] font-semibold">
        Đã xảy ra lỗi / Something went wrong
      </h1>
      <p className="mt-2 font-mono text-[12px] text-muted">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded border border-line px-3 py-1.5 text-[13px] text-accent hover:bg-surface-2"
      >
        Tải lại / Retry
      </button>
    </div>
  );
}
