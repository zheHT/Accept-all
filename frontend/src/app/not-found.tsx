import Link from "next/link";

export default function NotFound() {
  return <section className="glass mx-auto mt-20 max-w-xl p-8"><p className="eyebrow">404</p><h1 className="mt-3 text-[28px] font-semibold tracking-[-0.012em] text-ink-900">This workspace page does not exist</h1><p className="mt-2 text-[14px] leading-6 text-ink-500">Return to the live dashboard to continue reviewing shipping document cases.</p><Link href="/" className="btn-primary mt-6 inline-flex active:scale-95">Back to dashboard</Link></section>;
}
