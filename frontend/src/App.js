import React, { useEffect, useState } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import ExcelHeader from "./components/ExcelHeader";
import FormulaBar from "./components/FormulaBar";
import SheetContent from "./components/SheetContent";
import EmergencySheet from "./components/EmergencySheet";
import SheetTabs from "./components/SheetTabs";
import Paywall from "./components/Paywall";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import Pricing from "./pages/Pricing";
import { PaymentSuccess, PaymentCancel } from "./pages/PaymentPages";
import TeamPage from "./pages/TeamPage";
import JobsPage from "./pages/JobsPage";
import AdminFeedback from "./pages/AdminFeedback";
import AdminInvites from "./pages/AdminInvites";
import Hub from "./pages/Hub";
import ManagerDashboard from "./pages/ManagerDashboard";
import EquipmentPage from "./pages/EquipmentPage";
import CrewSchedulePage from "./pages/CrewSchedulePage";
import TreatmentPage from "./pages/TreatmentPage";
import CTDrillingCalculator from "./pages/CTDrillingCalculator";
import DocumentsPage from "./pages/DocumentsPage";
import ErpTemplatePage from "./pages/ErpTemplatePage";
import CrewContactsPage from "./pages/CrewContactsPage";
import ManagerGreeting from "./components/ManagerGreeting";
import RedeemDialog from "./components/RedeemDialog";
import FeedbackDialog from "./components/FeedbackDialog";
import { AdvisoryFooter, AdvisoryModal, AdvisoryStrip } from "./components/AdvisoryDisclaimer";
import { Toaster } from "./components/ui/sonner";
import InstallAppPrompt, { registerServiceWorker } from "./components/InstallAppPrompt";
import NotificationCenter from "./components/NotificationCenter";
import RigSelector from "./components/RigSelector";
import ServiceToggle, { useServiceView } from "./components/ServiceToggle";
import { useAuth, API, isProUser } from "./context/AuthContext";
import { workbookData } from "./mock/workbookData";
import { sheetInService } from "./lib/serviceCatalog";
import { Loader2, Clock } from "lucide-react";
import axios from "axios";
import "./App.css";

// Sheets included in the 30-day free trial
const FREE_SHEETS = [
  "Pipe_Stretch",
  "Sand_Cleanout",
  "Fishing_Ops",
  "CT_Milling",
  "Frac_Through_CT",
  "Annular_Frac",
];

const TRIAL_DAYS = 30;

const getTrialInfo = (user) => {
  if (!user?.trial_expires_at) return { active: false, daysLeft: 0, hoursLeft: 0 };
  const exp = new Date(user.trial_expires_at).getTime();
  const now = Date.now();
  const msLeft = exp - now;
  if (msLeft <= 0) return { active: false, daysLeft: 0, hoursLeft: 0 };
  const daysLeft = Math.floor(msLeft / (1000 * 60 * 60 * 24));
  const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));
  return { active: true, daysLeft, hoursLeft };
};

const Workbook = () => {
  const location = useLocation();
  const initialLoadJob = location.state?.loadJob;
  const [currentSheet, setCurrentSheet] = useState(initialLoadJob?.sheet_key || "Pipe_Stretch");
  const [unitSystem, setUnitSystem] = useState(initialLoadJob?.unit_system || "met");
  const [loadedValues, setLoadedValues] = useState(initialLoadJob?.values || null);
  const [hasTeam, setHasTeam] = useState(false);
  const { user } = useAuth();
  const { service } = useServiceView();
  const isPro = isProUser(user);
  const trial = getTrialInfo(user);
  // Free tier access: Pro subscribers get everything. Free users get FREE_SHEETS only while trial is active.
  const canAccessFree = isPro || trial.active;

  // If the active sheet leaves the current service view, snap to the first visible sheet.
  useEffect(() => {
    if (currentSheet === "EMERGENCY") return;
    if (!sheetInService(currentSheet, service)) {
      const first = Object.keys(workbookData).find((k) => sheetInService(k, service));
      if (first) setCurrentSheet(first);
    }
    // eslint-disable-next-line
  }, [service]);

  useEffect(() => {
    setHasTeam(!!user?.team_id);
  }, [user]);

  // Clear location state after consumption
  useEffect(() => {
    if (initialLoadJob) {
      window.history.replaceState({}, "");
    }
    // eslint-disable-next-line
  }, []);

  const handleSelectSheet = (key) => {
    setCurrentSheet(key);
    setLoadedValues(null); // clear loaded job values when navigating
  };

  const getFormulaText = () => {
    if (currentSheet === "EMERGENCY") return "=SAFETY_PROTOCOL(AER_DIRECTIVE_020)";
    const data = workbookData[currentSheet];
    if (!data) return "=CALCULATE_CT_MODEL(API_5CT_SPEC)";
    const sopCode = data.sop.split("|")[0].trim();
    return `=VET_MODEL("${sopCode}")`;
  };

  // Sheet is locked if user is not Pro AND (sheet is not in free list OR trial has expired)
  const sheetIsLocked =
    !isPro &&
    (currentSheet === "EMERGENCY" ||
      !FREE_SHEETS.includes(currentSheet) ||
      !trial.active);

  return (
    <div className="workbook-root bg-[#F3F3F3] text-[#262626] flex flex-col h-screen overflow-hidden">
      <ExcelHeader />
      <RigSelector />
      <ServiceToggle compact />
      <FormulaBar formulaText={getFormulaText()} />
      <AdvisoryStrip />
      {!isPro && trial.active && (
        <div className="bg-[#FFF3CD] border-b border-[#FFE69C] px-3 py-1.5 flex items-center justify-between text-[11px] flex-shrink-0">
          <span className="text-[#856404] font-semibold flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" strokeWidth={2.5} />
            {trial.daysLeft > 0
              ? `${trial.daysLeft} day${trial.daysLeft !== 1 ? "s" : ""} left in your 30-day trial`
              : `${trial.hoursLeft}h left in your 30-day trial`}
          </span>
          <button
            onClick={() => (window.location.href = "/pricing")}
            className="text-[#0D6535] font-bold hover:underline"
          >
            Upgrade →
          </button>
        </div>
      )}
      {!isPro && !trial.active && (
        <div className="bg-[#F8D7DA] border-b border-[#F5C6CB] px-3 py-1.5 flex items-center justify-between text-[11px] flex-shrink-0">
          <span className="text-[#721C24] font-semibold flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" strokeWidth={2.5} />
            Trial ended — subscribe to keep working
          </span>
          <button
            onClick={() => (window.location.href = "/pricing")}
            className="text-[#C00000] font-bold hover:underline"
          >
            Upgrade →
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-2">
        {sheetIsLocked ? (
          <Paywall
            sheetTitle={
              currentSheet === "EMERGENCY"
                ? "Emergency SOPs"
                : workbookData[currentSheet]?.title || "This sheet"
            }
            trialExpired={!trial.active}
          />
        ) : currentSheet === "EMERGENCY" ? (
          <EmergencySheet />
        ) : (
          <SheetContent
            sheetKey={currentSheet}
            unitSystem={unitSystem}
            onUnitChange={setUnitSystem}
            initialValues={loadedValues}
            hasTeam={hasTeam}
          />
        )}
      </div>
      <SheetTabs
        currentSheet={currentSheet}
        onSelectSheet={handleSelectSheet}
        freeSheets={FREE_SHEETS}
        isPro={isPro}
        trialActive={trial.active}
      />
    </div>
  );
};

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F3F3F3] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[#107C41] animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

const AppRouter = () => {
  const location = useLocation();
  // Detect session_id in URL hash (from OAuth redirect)
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <>
      <Routes>
        <Route path="/" element={<LandingRedirect />} />
        <Route path="/login" element={<Login />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/payment/success" element={<PaymentSuccess />} />
        <Route path="/payment/cancel" element={<PaymentCancel />} />
        <Route path="/app" element={<ProtectedRoute><Workbook /></ProtectedRoute>} />
        <Route path="/hub" element={<ProtectedRoute><Hub /></ProtectedRoute>} />
        <Route path="/team" element={<ProtectedRoute><TeamPage /></ProtectedRoute>} />
        <Route path="/jobs" element={<ProtectedRoute><JobsPage /></ProtectedRoute>} />
        <Route path="/admin/feedback" element={<ProtectedRoute><AdminFeedback /></ProtectedRoute>} />
        <Route path="/admin/invites" element={<ProtectedRoute><AdminInvites /></ProtectedRoute>} />
        <Route path="/manager" element={<ProtectedRoute><ManagerDashboard /></ProtectedRoute>} />
        <Route path="/equipment" element={<ProtectedRoute><EquipmentPage /></ProtectedRoute>} />
        <Route path="/schedule" element={<ProtectedRoute><CrewSchedulePage /></ProtectedRoute>} />
        <Route path="/treatment" element={<ProtectedRoute><TreatmentPage /></ProtectedRoute>} />
        <Route path="/ctd-calculator" element={<ProtectedRoute><CTDrillingCalculator /></ProtectedRoute>} />
        <Route path="/documents" element={<ProtectedRoute><DocumentsPage /></ProtectedRoute>} />
        <Route path="/erp-template" element={<ProtectedRoute><ErpTemplatePage /></ProtectedRoute>} />
        <Route path="/erp-template/:templateId" element={<ProtectedRoute><ErpTemplatePage /></ProtectedRoute>} />
        <Route path="/crew-contacts" element={<ProtectedRoute><CrewContactsPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <AdvisoryFooter />
      <AdvisoryModal />
      <ManagerGreeting />
      <RedeemDialog />
      <FeedbackDialog />
      <InstallAppPrompt />
      <NotificationCenter />
      <ResponsiveToaster />
    </>
  );
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
        <Loader2 className="w-6 h-6 text-[#107C41] animate-spin" />
      </div>
    );
  }
  return <Navigate to={user ? "/hub" : "/login"} replace />;
};

function App() {
  useEffect(() => { registerServiceWorker(); }, []);
  return <AppRouter />;
}

export default App;
