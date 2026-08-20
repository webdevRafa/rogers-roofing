import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  FileDown,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../firebase/firebaseConfig";
import type {
  JobMaterialActual,
  WarrantyPacketRecord,
} from "../domain/roofing";
import type { InvoiceDoc, Job } from "../types/types";
import logo from "../assets/rogers-logo-separated-v3.png";

type PhotoDoc = {
  id: string;
  jobId: string;
  url: string;
  caption?: string;
};

type TimestampLike = { toDate?: () => Date; seconds?: number };

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const timestamp = value as TimestampLike;
  if (typeof timestamp.toDate === "function") return timestamp.toDate();
  if (typeof timestamp.seconds === "number") {
    return new Date(timestamp.seconds * 1000);
  }
  return null;
}

function formatDate(value: unknown): string {
  const date = toDate(value);
  if (!date) return "Not recorded";
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function addressLine(job: Job): string {
  if (typeof job.address === "string") return job.address;
  return job.address?.fullLine || "Address not added";
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function WarrantyPreviewPage() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const packetId = searchParams.get("packet");
  const [job, setJob] = useState<Job | null>(null);
  const [packet, setPacket] = useState<WarrantyPacketRecord | null>(null);
  const [materials, setMaterials] = useState<JobMaterialActual[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [photos, setPhotos] = useState<PhotoDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, "jobs", id), (snapshot) => {
      if (snapshot.exists()) {
        setJob({
          id: snapshot.id,
          ...(snapshot.data() as Omit<Job, "id">),
        });
      }
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    if (!packetId) return;
    return onSnapshot(doc(db, "warrantyPackets", packetId), (snapshot) => {
      if (snapshot.exists()) {
        setPacket({
          id: snapshot.id,
          ...(snapshot.data() as Omit<WarrantyPacketRecord, "id">),
        });
      }
    });
  }, [packetId]);

  useEffect(() => {
    if (!id) return;
    const unsubs = [
      onSnapshot(
        query(collection(db, "jobMaterials"), where("jobId", "==", id)),
        (snapshot) =>
          setMaterials(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...(document.data() as Omit<JobMaterialActual, "id">),
            }))
          )
      ),
      onSnapshot(
        query(collection(db, "invoices"), where("jobId", "==", id)),
        (snapshot) =>
          setInvoices(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...(document.data() as Omit<InvoiceDoc, "id">),
            }))
          )
      ),
      onSnapshot(
        query(collection(db, "jobPhotos"), where("jobId", "==", id)),
        (snapshot) =>
          setPhotos(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...(document.data() as Omit<PhotoDoc, "id">),
            }))
          )
      ),
    ];
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [id]);

  if (loading || !job) {
    return (
      <div className="admin-loading">
        <div>
          <span />
          Preparing warranty packet…
        </div>
      </div>
    );
  }

  const packetSections = packet?.sections ?? [];
  const invoiceTotal = invoices.reduce(
    (sum, invoice) => sum + (invoice.money?.totalCents ?? 0),
    0
  );

  return (
    <main className="document-preview-page">
      <div className="document-preview-toolbar">
        <Link to={`/job/${job.id}`}>
          <ArrowLeft size={16} />
          Back to job
        </Link>
        <div>
          <span
            className={
              packet?.status === "ready"
                ? "admin-status status-active"
                : "admin-status status-pending"
            }
          >
            {packet?.status || "Draft preview"}
          </span>
          <button
            className="admin-primary-button"
            type="button"
            onClick={() => window.print()}
          >
            <FileDown size={16} />
            Print / save PDF
          </button>
        </div>
      </div>

      <article className="document-print-root warranty-document">
        <section className="warranty-cover">
          <header>
            <img src={logo} alt="Roger's Roofing & Contracting LLC" />
            <div>
              <strong>Roger&apos;s Roofing &amp; Contracting LLC</strong>
              <span>San Antonio, Texas</span>
            </div>
          </header>
          <div className="warranty-cover-title">
            <span>Project closeout</span>
            <h1>
              Warranty
              <br />
              packet
            </h1>
            <p>
              {packet?.type
                ?.replaceAll("_", " ")
                .toLowerCase() || "Residential roofing closeout"}
            </p>
          </div>
          <div className="warranty-cover-property">
            <MapPin size={21} />
            <div>
              <small>Installation property</small>
              <strong>{addressLine(job)}</strong>
              <span>{job.customer?.name || "Property owner"}</span>
            </div>
          </div>
          <footer>
            <span>Packet ID</span>
            <strong>{packet?.id || "LIVE-DRAFT"}</strong>
            <span>Issue date</span>
            <strong>
              {packet?.issueDate
                ? formatDate(packet.issueDate)
                : formatDate(new Date())}
            </strong>
          </footer>
        </section>

        <section className="warranty-document-page">
          <header className="warranty-page-header">
            <div>
              <span>01</span>
              <h2>Project completion summary</h2>
            </div>
            <img src={logo} alt="" />
          </header>
          <div className="warranty-summary-grid">
            <dl>
              <div>
                <dt>Customer</dt>
                <dd>{job.customer?.name || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Property</dt>
                <dd>{addressLine(job)}</dd>
              </div>
              <div>
                <dt>Project type</dt>
                <dd>
                  {job.projectType?.replaceAll("_", " ") || "Roofing project"}
                </dd>
              </div>
              <div>
                <dt>Job status</dt>
                <dd>{job.status}</dd>
              </div>
              <div>
                <dt>Installation completed</dt>
                <dd>{formatDate(job.shinglesCompletedAt)}</dd>
              </div>
              <div>
                <dt>Final punch</dt>
                <dd>{formatDate(job.punchedAt)}</dd>
              </div>
            </dl>
            <div className="warranty-summary-callout">
              <ShieldCheck size={28} />
              <h3>Keep this packet with your property records.</h3>
              <p>
                It summarizes the project evidence recorded by the contractor.
                Attached manufacturer warranty documents control over any
                informational summary.
              </p>
            </div>
          </div>

          <div className="warranty-section">
            <h3>Packet readiness index</h3>
            <div className="warranty-document-checklist">
              {packetSections.length === 0 ? (
                <p>No packet section snapshot was found.</p>
              ) : (
                packetSections.map((section) => (
                  <div key={section.key}>
                    <span
                      className={
                        section.status === "ready" ? "is-ready" : "is-warning"
                      }
                    >
                      {section.status === "ready" ? <Check size={13} /> : "!"}
                    </span>
                    <strong>{section.title}</strong>
                    <small>{section.note || section.status}</small>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="warranty-document-page">
          <header className="warranty-page-header">
            <div>
              <span>02</span>
              <h2>Installed product schedule</h2>
            </div>
            <img src={logo} alt="" />
          </header>
          {materials.length === 0 ? (
            <div className="warranty-document-empty">
              Installed-product records have not been added to this job.
            </div>
          ) : (
            <table className="warranty-material-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Manufacturer</th>
                  <th>Color</th>
                  <th>Quantity</th>
                  <th>Installed</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((material) => (
                  <tr key={material.id}>
                    <td>
                      <strong>{material.descriptionSnapshot}</strong>
                      <span>{material.productSnapshot || ""}</span>
                    </td>
                    <td>{material.manufacturerSnapshot || "Not recorded"}</td>
                    <td>{material.colorSnapshot || "—"}</td>
                    <td>
                      {material.orderedQuantity} {material.purchaseUnit}
                    </td>
                    <td>{formatDate(material.installedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="warranty-section">
            <h3>Warranty record</h3>
            <dl className="warranty-record-grid">
              <div>
                <dt>Coverage type</dt>
                <dd>{job.warranty?.kind || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Manufacturer</dt>
                <dd>{job.warranty?.manufacturer || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Program</dt>
                <dd>{job.warranty?.programName || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Term</dt>
                <dd>
                  {job.warranty?.coverageYears
                    ? `${job.warranty.coverageYears} years`
                    : "Not recorded"}
                </dd>
              </div>
              <div>
                <dt>Registration status</dt>
                <dd>{job.warranty?.status || "Not started"}</dd>
              </div>
              <div>
                <dt>Registration ID</dt>
                <dd>{job.warranty?.registrationId || "Not recorded"}</dd>
              </div>
            </dl>
            <p className="warranty-source-notice">
              The attached manufacturer warranty controls over this summary.
              Coverage, exclusions, transfer rules, registration requirements,
              and claim procedures must be confirmed from that governing
              document.
            </p>
          </div>
        </section>

        <section className="warranty-document-page">
          <header className="warranty-page-header">
            <div>
              <span>03</span>
              <h2>Billing and completion evidence</h2>
            </div>
            <img src={logo} alt="" />
          </header>
          <div className="warranty-billing-summary">
            <div>
              <span>Invoices linked</span>
              <strong>{invoices.length}</strong>
            </div>
            <div>
              <span>Invoice total</span>
              <strong>{money(invoiceTotal)}</strong>
            </div>
            <div>
              <span>Paid documents</span>
              <strong>
                {invoices.filter((invoice) => invoice.status === "paid").length}
              </strong>
            </div>
          </div>
          {invoices.length > 0 && (
            <table className="warranty-material-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Issued</th>
                  <th>Status</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{invoice.number || "Invoice"}</td>
                    <td>{formatDate(invoice.createdAt)}</td>
                    <td>{invoice.status}</td>
                    <td>{money(invoice.money?.totalCents ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="warranty-section">
            <h3>Completion photographs</h3>
            {photos.length === 0 ? (
              <div className="warranty-document-empty">
                Completion photographs have not been attached.
              </div>
            ) : (
              <div className="warranty-photo-grid">
                {photos.slice(0, 6).map((photo) => (
                  <figure key={photo.id}>
                    <img src={photo.url} alt={photo.caption || "Project photo"} />
                    <figcaption>{photo.caption || "Project photo"}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="warranty-document-page warranty-service-page">
          <header className="warranty-page-header">
            <div>
              <span>04</span>
              <h2>Care, service, and claims</h2>
            </div>
            <img src={logo} alt="" />
          </header>
          <div className="warranty-service-grid">
            <article>
              <span>01</span>
              <h3>Document the issue</h3>
              <p>
                Note when the issue was discovered and safely photograph the
                affected exterior and interior areas.
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>Limit further damage</h3>
              <p>
                Take reasonable, safe mitigation steps without putting people
                at risk or discarding evidence a manufacturer may request.
              </p>
            </article>
            <article>
              <span>03</span>
              <h3>Contact the correct issuer</h3>
              <p>
                Contractor workmanship and manufacturer product coverage are
                separate. A submitted claim is not an approval of coverage.
              </p>
            </article>
          </div>
          <div className="warranty-service-notice">
            <ShieldCheck size={26} />
            <div>
              <h3>Owner responsibilities</h3>
              <p>
                Keep gutters and drainage paths clear, manage overhanging limbs,
                preserve ventilation, coordinate future roof penetrations, and
                retain this packet with all governing warranty documents.
              </p>
            </div>
          </div>
          <footer className="warranty-document-footer">
            <img src={logo} alt="" />
            <div>
              <strong>Roger&apos;s Roofing &amp; Contracting LLC</strong>
              <span>San Antonio, Texas</span>
            </div>
            <p>
              This packet is a project record and is not legal, tax, insurance,
              engineering, or manufacturer coverage advice.
            </p>
          </footer>
        </section>
      </article>
    </main>
  );
}
