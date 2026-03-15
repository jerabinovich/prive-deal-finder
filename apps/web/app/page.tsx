import Link from "next/link";

export default function Home() {
  return (
    <div className="card">
      <div className="page-header">
        <div>
          <h1 className="page-title">Prive Deal Finder</h1>
          <p className="page-subtitle">Inicia sesión para continuar al deal pipeline.</p>
        </div>
      </div>
      <div className="actions-row">
        <Link href="/login" className="button">
          Login
        </Link>
      </div>
    </div>
  );
}
