import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";

function LoginPage() {
  const { token, login, loading, error, rememberMe } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shouldRemember, setShouldRemember] = useState(rememberMe);
  const [localError, setLocalError] = useState("");

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
        <img src="/TL.png" alt="TrackLine logo" />
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
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
        {localError ? <p className="error">{localError}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </div>
    </section>
  );
}

export default LoginPage;
