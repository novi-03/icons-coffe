import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PageLoader } from './components/ui';
import Landing from './public/Landing';

const CustomerApp = lazy(() => import('./customer/CustomerApp'));
const KitchenApp = lazy(() => import('./kitchen/KitchenApp'));
const StaffApp = lazy(() => import('./staff/StaffApp'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/staff/*" element={<StaffApp />} />
        <Route path="/kitchen/*" element={<KitchenApp />} />
        {/* Customer website: QR entry at /t/:token, then /menu, /cart, /order/:id, /orders, /service */}
        <Route path="/t/:token" element={<CustomerApp />} />
        <Route path="/menu" element={<CustomerApp />} />
        <Route path="/cart" element={<CustomerApp />} />
        <Route path="/orders" element={<CustomerApp />} />
        <Route path="/order/:orderId" element={<CustomerApp />} />
        <Route path="/service" element={<CustomerApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
