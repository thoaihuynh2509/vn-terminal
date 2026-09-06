import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-[20px] font-semibold">404</h1>
      <p className="mt-2 text-[13px] text-ink-2">
        Không tìm thấy trang hoặc mã này. / Page or symbol not found.
      </p>
      <Link href="/vi" className="mt-4 inline-block text-[13px] text-accent hover:underline">
        ← VN Terminal
      </Link>
    </div>
  );
}
