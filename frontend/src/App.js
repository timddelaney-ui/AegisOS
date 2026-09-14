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
import { useAuth, API } from "./context/AuthContext";
import { workbookData } from "./mock/workbookData";
import { Loader2 } from "lucide-react";
import axios from "axios";
import "./App.css";

// Free sheets accessible without subscription
const FREE_SHEETS = ["Pipe_Stretch", "Sand_Cleanout", "Fishing_Ops"];

const Workbook = () => {
  const location = useLocation();
  const initialLoadJob = location.state?.loadJob;
  const [currentSheet, setCurrentSheet] = useState(initialLoadJob?.sheet_key || "Pipe_Stretch");
  const [unitSystem, setUnitSystem] = useState(initialLoadJob?.unit_system || "imp");
  const [loadedValues, setLoadedValues] = useState(initialLoadJob?.values || null);
  const [hasTeam, setHasTeam] = useState(false);
  const { user } = useAuth();
  const isPro = user?.subscription_status === "active";

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

  const sheetIsLocked = currentSheet !== "EMERGENCY" && !FREE_SHEETS.includes(currentSheet) && !isPro;

  return (
    <div className="bg-[#F3F3F3] text-[#262626] flex flex-col h-screen overflow-hidden">
      <ExcelHeader />
      <FormulaBar formulaText={getFormulaText()} />
      <div className="flex-1 overflow-y-auto p-2">
        {currentSheet === "EMERGENCY" ? (
          isPro ? <EmergencySheet /> : <Paywall sheetTitle="Emergency SOPs" />
        ) : sheetIsLocked ? (
          <Paywall sheetTitle={workbookData[currentSheet]?.title || "This sheet"} />
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
      <SheetTabs currentSheet={currentSheet} onSelectSheet={handleSelectSheet} freeSheets={FREE_SHEETS} isPro={isPro} />
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
    <Routes>
      <Route path="/" element={<LandingRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/payment/success" element={<PaymentSuccess />} />
      <Route path="/payment/cancel" element={<PaymentCancel />} />
      <Route path="/app" element={<ProtectedRoute><Workbook /></ProtectedRoute>} />
      <Route path="/team" element={<ProtectedRoute><TeamPage /></ProtectedRoute>} />
      <Route path="/jobs" element={<ProtectedRoute><JobsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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
  return <Navigate to={user ? "/app" : "/login"} replace />;
};

function App() {
  return <AppRouter />;
}

export default App;
