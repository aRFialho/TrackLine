import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import OrdersPage from "./pages/OrdersPage";
import OrderDetailPage from "./pages/OrderDetailPage";
import AdminPage from "./pages/AdminPage";
import ReportsPage from "./pages/ReportsPage";
import LoginPage from "./pages/LoginPage";
import { useAuthStore } from "./store/useAuthStore";

function Protected() {
  const { token, user, initialized, loading, bootstrap } = useAuthStore();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!initialized || loading) {
    return <p className="status-line">Validando sessao...</p>;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet context={{ role: user?.role }} />;
}

function AdminOnly() {
  const { user } = useAuthStore();
  if (user?.role !== "admin") {
    return <Navigate to="/ops" replace />;
  }
  return <Outlet />;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Protected />}>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/ops" replace />} />
          <Route path="ops" element={<OrdersPage />} />
          <Route path="ops/:orderId" element={<OrderDetailPage />} />
          <Route element={<AdminOnly />}>
            <Route path="admin" element={<AdminPage />} />
            <Route path="relatorios" element={<ReportsPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
