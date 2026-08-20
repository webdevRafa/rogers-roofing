import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Loader2,
  LockKeyhole,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Link, useParams, useSearchParams } from "react-router-dom";

import EstimateDocument from "../components/EstimateDocument";
import {
  estimateJobSourcesAreCurrent,
  estimateJobSyncFields,
  estimateUsesLiveJobSources,
  synchronizeEstimateFromJobSources,
} from "../domain/estimateJobSync";
import { db, functions } from "../firebase/firebaseConfig";
import type { EstimateRecord, JobMaterialActual } from "../domain/roofing";
import type { Job, PayoutDoc } from "../types/types";

export default function EstimateViewer() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [estimate, setEstimate] = useState<EstimateRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (!id) throw new Error("Estimate link is incomplete.");
        if (token) {
          const getPublicEstimate = httpsCallable<
            { estimateId: string; token: string },
            { estimate: EstimateRecord }
          >(functions, "getPublicEstimate");
          const result = await getPublicEstimate({ estimateId: id, token });
          if (active) setEstimate(result.data.estimate);
        } else {
          const estimateRef = doc(db, "estimates", id);
          const snapshot = await getDoc(estimateRef);
          if (!snapshot.exists()) throw new Error("Estimate not found.");
          const savedEstimate = {
            id: snapshot.id,
            ...(snapshot.data() as Omit<EstimateRecord, "id">),
          };
          let currentEstimate = savedEstimate;

          if (
            savedEstimate.jobId &&
            estimateUsesLiveJobSources(savedEstimate.status)
          ) {
            const [jobSnapshot, materialsSnapshot, payoutsSnapshot] =
              await Promise.all([
                getDoc(doc(db, "jobs", savedEstimate.jobId)),
                getDocs(
                  query(
                    collection(db, "jobMaterials"),
                    where("jobId", "==", savedEstimate.jobId)
                  )
                ),
                getDocs(
                  query(
                    collection(db, "payouts"),
                    where("jobId", "==", savedEstimate.jobId)
                  )
                ),
              ]);

            if (jobSnapshot.exists()) {
              const job = {
                id: jobSnapshot.id,
                ...(jobSnapshot.data() as Omit<Job, "id">),
              };
              const materials = materialsSnapshot.docs.map((material) => ({
                id: material.id,
                ...(material.data() as Omit<JobMaterialActual, "id">),
              }));
              const payouts = payoutsSnapshot.docs.map((payout) => ({
                id: payout.id,
                ...(payout.data() as Omit<PayoutDoc, "id">),
              }));
              currentEstimate = synchronizeEstimateFromJobSources(
                savedEstimate,
                job,
                materials,
                payouts
              );

              if (
                !estimateJobSourcesAreCurrent(savedEstimate, currentEstimate)
              ) {
                try {
                  await setDoc(
                    estimateRef,
                    {
                      ...estimateJobSyncFields(currentEstimate),
                      updatedAt: serverTimestamp(),
                    },
                    { merge: true }
                  );
                } catch {
                  // The live admin preview remains accurate even if a snapshot
                  // write is interrupted; the next preview/send will retry it.
                }
              }
            }
          }

          if (active) setEstimate(currentEstimate);
        }
      } catch (caught) {
        if (active) {
          setError(
            token
              ? "This estimate link is invalid or no longer available."
              : caught instanceof Error
                ? caught.message
                : String(caught)
          );
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [id, token]);

  useEffect(() => {
    if (!estimate) return;
    const previousTitle = document.title;
    document.title = `${estimate.number} · Roger's Roofing`;
    return () => {
      document.title = previousTitle;
    };
  }, [estimate]);

  async function copyCustomerLink() {
    if (!estimate) return;
    const customerToken = token || estimate.publicToken;
    const url = customerToken
      ? `${window.location.origin}/estimate/${estimate.id}?token=${encodeURIComponent(customerToken)}`
      : window.location.href;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  if (error) {
    return (
      <main className="estimate-viewer-state">
        <div>
          <LockKeyhole size={28} />
          <h1>Estimate unavailable</h1>
          <p>{error}</p>
        </div>
      </main>
    );
  }

  if (!estimate) {
    return (
      <main className="estimate-viewer-state">
        <div>
          <Loader2 className="estimate-spin" size={24} />
          <p>Preparing your estimate…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="estimate-viewer-page">
      <div className="estimate-preview-toolbar">
        <div>
          {!token ? (
            <Link to={`/estimates/${estimate.id}/edit`}>
              <ArrowLeft size={15} /> Return to editor
            </Link>
          ) : (
            <span>
              <LockKeyhole size={14} /> Private customer estimate
            </span>
          )}
          <p>
            <strong>{estimate.number}</strong>
            <small>{estimate.customerSnapshot?.name || "Customer"}</small>
          </p>
        </div>
        <div>
          {Boolean(token || estimate.publicToken) && (
            <button type="button" onClick={() => void copyCustomerLink()}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Link copied" : "Copy link"}
            </button>
          )}
          <button
            type="button"
            className="estimate-download-button"
            onClick={() => window.print()}
          >
            <Download size={15} /> Print / Download PDF
          </button>
        </div>
      </div>

      <div className="estimate-print-root">
        <EstimateDocument
          estimate={estimate}
          previewLabel={!token && estimate.status === "draft" ? "Draft preview" : undefined}
        />
      </div>
    </main>
  );
}
