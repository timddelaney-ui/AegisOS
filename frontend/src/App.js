import React, { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";
import AppShell from "./components/AppShell";
import JobPage from "./pages/JobPage";
import MorePage from "./pages/MorePage";
import CalcPage from "./pages/CalcPage";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import Pricing from "./pages/Pricing";
import { PaymentSuccess, PaymentCancel } from "./pages/PaymentPages";
import TeamPage from "./pages/TeamPage";
import JobsPage from "./pages/JobsPage";
import AdminFeedback from "./pages/AdminFeedback";
import AdminInvites from "./pages/AdminInvites";
import ManagerDashboard from "./pages/ManagerDashboard";
import EquipmentPage from "./pages/EquipmentPage";
import CrewSchedulePage from "./pages/CrewSchedulePage";
import TreatmentPage from "./pages/TreatmentPage";
import CTDrillingCalculator from "./pages/CTDrillingCalculator";
import DocumentsPage from "./pages/DocumentsPage";
import ErpTemplatePage from "./pages/ErpTemplatePage";
import CrewContactsPage from "./pages/CrewContactsPage";
import ReelsPage from "./pages/ReelsPage";
import VonMisesPage from "./pages/VonMisesPage";
import FatiguePage from "./pages/FatiguePage";
import CertificationsPage from "./pages/CertificationsPage";
import TasksPage from "./pages/TasksPage";
import PartsOrdersPage from "./pages/PartsOrdersPage";
import TimecardsPage from "./pages/TimecardsPage";
import RbacAdminPage from "./pages/RbacAdminPage";
import OperatorPage from "./pages/OperatorPage";
import DaqConfigPage from "./pages/DaqConfigPage";
import SecurityCompliancePage from "./pages/SecurityCompliancePage";
import ShareRedeemPage from "./pages/ShareRedeemPage";
import ShadowVerificationPage from "./pages/ShadowVerificationPage";
import ExecutiveDashboard from "./pages/ExecutiveDashboard";
import OperatorCockpit from "./pages/OperatorCockpit";
import ClassicMode from "./pages/ClassicMode";
import ApprovalsPage from "./pages/ApprovalsPage";
import AuditLedgerPage from "./pages/AuditLedgerPage";
import ErrorBoundary from "./components/ErrorBoundary";
import { ActiveReelProvider } from "./context/ActiveReelContext";
import { UnitProvider } from "./context/UnitContext";
import { TierProvider, useTier } from "./context/TierContext";
import TierTutorial, { useTierTutorial } from "./components/TierTutorial";
import { UpgradeModal, TierProtectedRoute } from "./components/TierGate";
import AdminTierSwitcher from "./components/AdminTierSwitcher";
import { ROUTE_FEATURES } from "./lib/tiers";
import ManagerGreeting from "./components/ManagerGreeting";
import RedeemDialog from "./components/RedeemDialog";
import NotificationCenter from "./components/NotificationCenter";
import TrainingModeBanner from "./components/TrainingModeBanner";
import TermsPage from "./pages/TermsPage";
import { AdvisoryFooter, AdvisoryModal } from "./components/AdvisoryDisclaimer";
import { Toaster } from "./components/ui/sonner";
import InstallAppPrompt, { registerServiceWorker } from "./components/InstallAppPrompt";
import { useAuth, isFleetUser } from "./context/AuthContext";
import { Loader2 } from "lucide-react";
import FieldToolsBar from "./components/FieldToolsBar";
import UnifiedAegisPlatform from "./components/UnifiedAegisPlatform";
import "./App.css";
import { toolForPath } from "./config/toolRegistry";
import { planRole, canView, useRoleView } from "./lib/roles";
import { Analytics } from "@vercel/analytics/react";

const Workbook = lazy(() => import("./pages/WorkbookPage"));
const WellborePage = lazy(() => import("./pages/WellborePage"));
const ScreenLoading = () => <div className="job-loading" role="status"><Loader2 className="animate-spin" /> Loading screen...</div>;

const ProtectedRoute = ({ children, feature, view }) => {
  const { user, loading } = useAuth();
  useRoleView();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F3F3F3] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[#FF6B1A] animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (view && !canView(user, view)) return <Navigate to="/job" replace />;
  const tool = toolForPath(location.pathname);
  if (tool && !tool.roles.includes(planRole(user))) return <Navigate to="/job" replace />;
  if (tool?.fleetOnly && !isFleetUser(user)) return <Navigate to="/" replace />;
  // Every feature route is isolated: a bad input/render error in one module
  // recovers silently (or shows a local retry) instead of blanking the app.
  const guarded = <ErrorBoundary name={feature || "route"} resetKey={location.pathname}>{children}</ErrorBoundary>;
  // When a feature id is supplied, delegate to the tier-aware guard so
  // lower-tier users land on /pricing (teaser features) or /hub (hidden).
  if (feature) return <TierProtectedRoute feature={feature}>{guarded}</TierProtectedRoute>;
  return guarded;
};

const AppRouter = () => {
  const location = useLocation();
  // Detect session_id in URL hash (from OAuth redirect)
  if (/(session_id|auth_code)=/.test(location.hash || "")) {
    return <AuthCallback />;
  }
  return (
    <>
      {["/login", "/terms", "/pricing", "/payment/success", "/payment/cancel"].includes(location.pathname) && <FieldToolsBar />}
      <TrainingModeBanner />
      <Suspense fallback={<ScreenLoading />}><Routes>
        <Route path="/share/:token" element={<ShareRedeemPage />} />
        <Route path="/" element={<LandingRedirect />} />
        <Route path="/login" element={<Login />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/payment/success" element={<PaymentSuccess />} />
        <Route path="/payment/cancel" element={<PaymentCancel />} />
        <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
        <Route path="/job" element={<JobPage />} />
        <Route path="/live" element={<ProtectedRoute feature="live_ops" view="cockpit"><OperatorCockpit /></ProtectedRoute>} />
        <Route path="/log" element={<ProtectedRoute view="treatment_log"><TreatmentPage /></ProtectedRoute>} />
        <Route path="/calc" element={<CalcPage />} />
        <Route path="/more" element={<MorePage />} />
        <Route path="/sop" element={<ProtectedRoute feature="workbooks"><Workbook /></ProtectedRoute>} />
        <Route path="/app" element={<ProtectedRoute feature="workbooks"><Workbook /></ProtectedRoute>} />
        <Route path="/hub" element={<Navigate to="/job" replace />} />
        <Route path="/team" element={<ProtectedRoute feature="team_mgmt"><TeamPage /></ProtectedRoute>} />
        <Route path="/jobs" element={<ProtectedRoute feature="jobs_ledger"><JobsPage /></ProtectedRoute>} />
        <Route path="/admin/feedback" element={<ProtectedRoute><AdminFeedback /></ProtectedRoute>} />
        <Route path="/admin/invites" element={<ProtectedRoute><AdminInvites /></ProtectedRoute>} />
        <Route path="/manager" element={<ProtectedRoute><ManagerDashboard /></ProtectedRoute>} />
        <Route path="/equipment" element={<ProtectedRoute feature="equipment_assets"><EquipmentPage /></ProtectedRoute>} />
        <Route path="/schedule" element={<ProtectedRoute feature="crew_schedule"><CrewSchedulePage /></ProtectedRoute>} />
        <Route path="/treatment" element={<ProtectedRoute view="treatment_log"><TreatmentPage /></ProtectedRoute>} />
        <Route path="/ctd-calculator" element={<ProtectedRoute feature="ct_drill_calc"><CTDrillingCalculator /></ProtectedRoute>} />
        <Route path="/documents" element={<ProtectedRoute feature="documents"><DocumentsPage /></ProtectedRoute>} />
        <Route path="/erp-template" element={<ProtectedRoute feature="erp_templates"><ErpTemplatePage /></ProtectedRoute>} />
        <Route path="/erp-template/:templateId" element={<ProtectedRoute feature="erp_templates"><ErpTemplatePage /></ProtectedRoute>} />
        <Route path="/crew-contacts" element={<ProtectedRoute feature="crew_contacts"><CrewContactsPage /></ProtectedRoute>} />
        <Route path="/reels" element={<ProtectedRoute feature="reels_mgmt"><ReelsPage /></ProtectedRoute>} />
        <Route path="/stress" element={<ProtectedRoute feature="von_mises"><VonMisesPage /></ProtectedRoute>} />
        <Route path="/fatigue" element={<ProtectedRoute feature="reel_fatigue"><FatiguePage /></ProtectedRoute>} />
        <Route path="/wellbore" element={<ProtectedRoute feature="wellbore_3d"><WellborePage /></ProtectedRoute>} />
        <Route path="/certs" element={<ProtectedRoute feature="certifications"><CertificationsPage /></ProtectedRoute>} />
        <Route path="/tasks" element={<ProtectedRoute feature="daily_tasks"><TasksPage /></ProtectedRoute>} />
        <Route path="/parts-orders" element={<ProtectedRoute feature="parts_orders"><PartsOrdersPage /></ProtectedRoute>} />
        <Route path="/timecards" element={<ProtectedRoute feature="timecards"><TimecardsPage /></ProtectedRoute>} />
        <Route path="/crew-admin" element={<ProtectedRoute feature="rbac_admin"><RbacAdminPage /></ProtectedRoute>} />
        <Route path="/live-ops" element={<ProtectedRoute feature="live_ops"><OperatorPage /></ProtectedRoute>} />
        <Route path="/live-ops/classic" element={<ProtectedRoute view="classic"><ClassicMode /></ProtectedRoute>} />
        <Route path="/cockpit" element={<ProtectedRoute view="cockpit"><OperatorCockpit /></ProtectedRoute>} />
        <Route path="/classic" element={<ProtectedRoute view="classic"><ClassicMode /></ProtectedRoute>} />
        <Route path="/daq" element={<ProtectedRoute feature="daq_ingest"><DaqConfigPage /></ProtectedRoute>} />
        <Route path="/security" element={<ProtectedRoute feature="security_compliance"><SecurityCompliancePage /></ProtectedRoute>} />
        <Route path="/shadow" element={<ProtectedRoute feature="shadow_mode"><ShadowVerificationPage /></ProtectedRoute>} />
        <Route path="/executive" element={<ProtectedRoute feature="exec_dashboard"><ExecutiveDashboard /></ProtectedRoute>} />
        <Route path="/unified-platform" element={<ProtectedRoute><UnifiedAegisPlatform /></ProtectedRoute>} />
        <Route path="/approvals" element={<ProtectedRoute view="parts"><ApprovalsPage /></ProtectedRoute>} />
        <Route path="/audit" element={<ProtectedRoute view="audit_ledger"><AuditLedgerPage /></ProtectedRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></Suspense>
      <AdvisoryFooter />
      <AdvisoryModal />
      <ManagerGreeting />
      <RedeemDialog />
      <InstallAppPrompt />
      <NotificationCenter />
      <UpgradeModal />
      <TierTutorialMount />
      <AdminTierSwitcher />
      <ResponsiveToaster />
    </>
  );
};

// Auto-opens the tier tutorial on first-login for the viewer's tier. The
// hook stores a per-tier "seen" flag in localStorage so repeat visits are
// quiet. Users can re-open it from their user menu.
const TierTutorialMount = () => {
  const { user } = useAuth();
  const { loaded } = useTier();
  const { open, close } = useTierTutorial();
  if (!user || !loaded) return null;
  return <TierTutorial open={open} onClose={close} />;
};

// Toast position adapts to viewport: top-center on desktop (easy to see), top-right on mobile
// (keeps the back button in the header unobscured). Also respects safe-area insets.
const ResponsiveToaster = () => {
  const [pos, setPos] = useState(() => (typeof window !== "undefined" && window.innerWidth < 640 ? "top-right" : "top-center"));
  useEffect(() => {
    const onResize = () => setPos(window.innerWidth < 640 ? "top-right" : "top-center");
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <Toaster
      position={pos}
      richColors
      closeButton
      offset="calc(env(safe-area-inset-top, 0px) + 8px)"
      toastOptions={{ style: { fontSize: 13 } }}
    />
  );
};

const LandingRedirect = () => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F3F3F3] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[#FF6B1A] animate-spin" />
      </div>
    );
  }
  return <Navigate to={user ? "/job" : "/login"} replace />;
};

function App() {
  useEffect(() => { registerServiceWorker(); }, []);
  return (
    <ErrorBoundary name="app-root">
      <UnitProvider>
        <ActiveReelProvider>
          <TierProvider>
            <AppRouter />
          </TierProvider>
        </ActiveReelProvider>
      </UnitProvider>
      <Analytics />
    </ErrorBoundary>
  );
}

export default App;
