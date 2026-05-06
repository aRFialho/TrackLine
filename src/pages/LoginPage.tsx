import { FormEvent, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { trackLineLogoUrl } from "../lib/branding";

const loadingHints = [
  "Validando credenciais...",
  "Conectando no painel de producao...",
  "Sincronizando setores e operacoes..."
];

function LoginPage() {
  const { token, login, loading, error, rememberMe } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shouldRemember, setShouldRemember] = useState(rememberMe);
  const [localError, setLocalError] = useState("");
  const [hintIndex, setHintIndex] = useState(0);

  useEffect(() => {
    if (!loading) {
      setHintIndex(0);
      return;
    }
    const interval = window.setInterval(() => {
      setHintIndex((current) => (current + 1) % loadingHints.length);
    }, 850);
    return () => window.clearInterval(interval);
  }, [loading]);

  if (token) {
    return <Navigate to="/ops" replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError("");

    if (!email.trim() || !password) {
      setLocalError("Informe email e senha.");
      return;
    }

    try {
      await login(email.trim(), password, shouldRemember);
    } catch (_error) {
      return;
    }
  };

  return (
    <section className="login-screen">
      <div className="login-card">
        <div className={`login-logo-wrap ${loading ? "is-loading" : ""}`}>
          <img src={trackLineLogoUrl} alt="TrackLine logo" />
        </div>
        <h1>TrackLine</h1>
        <p>Acesse com sua conta de administrador.</p>
        <form onSubmit={handleSubmit}>
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Senha
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label className="remember-row">
            <input
              type="checkbox"
              checked={shouldRemember}
              onChange={(event) => setShouldRemember(event.target.checked)}
            />
            Salvar login e continuar logado
          </label>
          <button disabled={loading} type="submit">
            {loading ? (
              <span className="login-loading-inline">
                <span className="mini-spin" />
                Entrando...
              </span>
            ) : (
              "Entrar"
            )}
          </button>
        </form>
        {loading ? <p className="login-hint">{loadingHints[hintIndex]}</p> : null}
        {localError ? <p className="error">{localError}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </div>
    </section>
  );
}

export default LoginPage;
