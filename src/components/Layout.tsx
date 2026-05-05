import { NavLink, Outlet } from "react-router-dom";
import { useEffect } from "react";
import dayjs from "dayjs";
import { useProductionStore } from "../store/useProductionStore";
import { useAuthStore } from "../store/useAuthStore";

function Layout() {
  const { bootstrap, initialized, loading, error, notifications } = useProductionStore();
  const { user, logout } = useAuthStore();
  const navItems =
    user?.role === "operator"
      ? [{ to: "/ops", label: "Ordens de Producao" }]
      : [
          { to: "/ops", label: "Ordens de Producao" },
          { to: "/admin", label: "Admin" },
          { to: "/relatorios", label: "Relatorios" }
        ];

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/TL.png" alt="TrackLine logo" />
          <div>
            <strong>TrackLine</strong>
            <p>Controle de producao</p>
          </div>
        </div>
        <div className="session-box">
          <small>{user?.email ?? ""}</small>
          <button type="button" onClick={logout}>
            Sair
          </button>
        </div>

        <nav className="menu">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="notifications-box">
          <strong>Notificacoes</strong>
          <div className="notifications-list">
            {notifications.length === 0 ? <p>Nenhuma notificacao ainda.</p> : null}
            {notifications.map((notification) => (
              <article key={notification.id} className="notification-item">
                <p>
                  <b>{notification.actorEmail}</b>{" "}
                  {notification.action === "CONFIRM_OPERATION" ? "confirmou" : "retirou confirmacao de"}{" "}
                  <b>
                    {notification.quantity} {notification.unit}
                  </b>{" "}
                  de <b>{notification.itemDescription}</b> no setor <b>{notification.sectorName}</b>.
                </p>
                <small>
                  OP {notification.orderNumber}
                  {notification.employeeName ? ` | operador ${notification.employeeName}` : ""} |{" "}
                  {dayjs(notification.createdAt).format("DD/MM HH:mm")}
                </small>
              </article>
            ))}
          </div>
        </div>
      </aside>
      <main className="content">
        {!initialized || loading ? <p className="status-line">Sincronizando dados do banco...</p> : null}
        {error ? <p className="error status-line">{error}</p> : null}
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
