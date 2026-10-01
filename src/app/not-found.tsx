import Link from "next/link";

export default function NotFound() {
  return (
    <section className="py-12">
      <p className="mb-4 text-sm font-medium text-gold">404</p>
      <h1 className="font-display text-4xl text-ink">Nie znaleziono strony</h1>
      <p className="mt-4 text-base text-muted">Ten adres nie prowadzi do żadnej sekcji pracowni.</p>
      <Link href="/" className="mt-8 inline-flex min-h-11 items-center rounded-xl bg-ink px-5 py-3 text-sm font-medium text-white hover:bg-sidebar-active">
        Wróć do pulpitu
      </Link>
    </section>
  );
}
