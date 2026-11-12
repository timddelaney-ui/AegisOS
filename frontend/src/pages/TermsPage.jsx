import React from "react";
import { EngineeringDisclaimer } from "../components/AdvisoryDisclaimer";

// DRAFT: placeholder commercial terms. Must be reviewed by counsel before commercial launch.
export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#F3F3F3] p-4 pb-24" data-testid="terms-page">
      <article className="mx-auto max-w-3xl space-y-3 rounded-lg border border-[#D4D4D4] bg-white p-4 text-sm text-[#262626]">
        <h1 className="text-lg font-bold">Terms of Service — Engineering Decision-Support Disclaimer</h1>
        <p className="rounded border border-[#FFE69C] bg-[#FFF3CD] px-2 py-1 text-[11px] text-[#856404]">
          Draft for beta. Not yet legally reviewed; binding commercial terms will replace this text.
        </p>
        <EngineeringDisclaimer />
        <ol className="list-decimal space-y-2 pl-5">
          <li>Aegis OS is an advisory, read-only intelligence layer. It never writes to PLCs, controllers, or unit safety interlocks.</li>
          <li>Calculations (fatigue, stress, buckling, hydraulics) are decision-support estimates and are not certified engineering sign-off.</li>
          <li>Results must be verified by a qualified engineer against company procedures, tool datasheets, and applicable regulations before use.</li>
          <li>Imported legacy fatigue histories are used as supplied; the operator is responsible for the accuracy of imported data.</li>
          <li>The operator&apos;s data is isolated per team. Do not share credentials or share links outside your organization.</li>
          <li>Use is at the operator&apos;s own risk; the on-site supervisor retains final authority.</li>
        </ol>
      </article>
    </main>
  );
}
