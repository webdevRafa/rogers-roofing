import type { EstimateRecord, RoofingUnit } from "../domain/roofing";
import fallbackLogo from "../assets/rogers-roofing.webp";

type EstimateDocumentProps = {
  estimate: EstimateRecord;
  previewLabel?: string;
};

const unitLabels: Record<RoofingUnit, string> = {
  EA: "Each",
  PIECE: "Piece",
  BOX: "Box",
  SQ: "Square",
  SF: "Sq. ft.",
  LF: "Lin. ft.",
  HR: "Hour",
  DAY: "Day",
  LS: "Lump sum",
  TON: "Ton",
  SHEET: "Sheet",
  GAL: "Gallon",
  ROLL: "Roll",
  BUNDLE: "Bundle",
  OTHER: "Unit",
};

function money(cents = 0) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function shortDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAddress(
  address?: EstimateRecord["propertyAddressSnapshot"] | null
) {
  if (!address) return [];
  if (address.fullLine) return [address.fullLine];
  const firstLine = [address.street, address.unit].filter(Boolean).join(" ");
  const secondLine = [address.city, address.state, address.postalCode]
    .filter(Boolean)
    .join(", ");
  return [firstLine, secondLine].filter(Boolean);
}

function quantityLabel(quantity: number, unit: RoofingUnit) {
  const formatted = Number.isInteger(quantity)
    ? quantity.toLocaleString("en-US")
    : quantity.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${formatted} ${unitLabels[unit]}`;
}

export default function EstimateDocument({
  estimate,
  previewLabel,
}: EstimateDocumentProps) {
  const organization = estimate.organizationSnapshot;
  const organizationAddress = formatAddress(organization?.address);
  const propertyAddress = formatAddress(estimate.propertyAddressSnapshot);
  const visibleLines = estimate.lineItems.filter(
    (line) => line.customerVisible !== false && line.selected !== false
  );
  const balanceAfterDeposit = Math.max(
    0,
    estimate.totalCents - (estimate.depositCents ?? 0)
  );

  return (
    <article className="estimate-paper">
      <header className="estimate-document-header">
        <div className="estimate-business-block">
          <img
            src={organization?.logoUrl || fallbackLogo}
            alt={`${organization?.name || "Roger's Roofing"} logo`}
          />
          <div>
            <strong>
              {organization?.name ||
                organization?.legalName ||
                "Roger's Roofing & Contracting LLC"}
            </strong>
            {organizationAddress.map((line) => (
              <span key={line}>{line}</span>
            ))}
            {organization?.phone && <span>{organization.phone}</span>}
            {organization?.email && <span>{organization.email}</span>}
          </div>
        </div>

        <div className="estimate-document-title">
          {previewLabel && <span>{previewLabel}</span>}
          <h1>Estimate</h1>
          <strong>{estimate.number || "Draft estimate"}</strong>
        </div>
      </header>

      <section className="estimate-party-grid">
        <div className="estimate-meta-grid">
          <div>
            <span>Estimate date</span>
            <strong>{shortDate(estimate.issueDate)}</strong>
          </div>
          <div>
            <span>Valid through</span>
            <strong>{shortDate(estimate.validUntil)}</strong>
          </div>
          <div>
            <span>Project</span>
            <strong>{estimate.projectTitle || "Roofing project"}</strong>
          </div>
          {(estimate.roofAreaSquareFeet ?? 0) > 0 && (
            <div>
              <span>Measured roof area</span>
              <strong>
                {estimate.roofAreaSquareFeet?.toLocaleString("en-US", {
                  maximumFractionDigits: 2,
                })}{" "}
                sq. ft.
              </strong>
            </div>
          )}
        </div>

        <div className="estimate-bill-to">
          <span>Prepared for</span>
          <strong>{estimate.customerSnapshot?.name || "Customer"}</strong>
          {estimate.customerSnapshot?.email && (
            <small>{estimate.customerSnapshot.email}</small>
          )}
          {estimate.customerSnapshot?.phone && (
            <small>{estimate.customerSnapshot.phone}</small>
          )}
          {propertyAddress.map((line) => (
            <small key={line}>{line}</small>
          ))}
        </div>
      </section>

      <section className="estimate-line-items">
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Rate</th>
              <th>Qty</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {visibleLines.map((line) => {
              const included =
                line.pricingMode === "included" ||
                line.pricingMode === "no_charge";
              return (
                <tr key={line.id}>
                  <td>
                    <strong>{line.title}</strong>
                    {line.customerDescription && (
                      <span>{line.customerDescription}</span>
                    )}
                  </td>
                  <td>{included ? "—" : money(line.unitPriceCents)}</td>
                  <td>{quantityLabel(line.quantity, line.unit)}</td>
                  <td>{included ? "Included" : money(line.lineTotalCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="estimate-document-bottom">
        <div className="estimate-terms-stack">
          {estimate.warrantyText && (
            <div>
              <span>Workmanship warranty</span>
              <p>{estimate.warrantyText}</p>
            </div>
          )}
          {estimate.paymentTerms && (
            <div>
              <span>Payment terms</span>
              <p>{estimate.paymentTerms}</p>
            </div>
          )}
          {estimate.notes && (
            <div>
              <span>Notes</span>
              <p>{estimate.notes}</p>
            </div>
          )}
        </div>

        <dl className="estimate-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{money(estimate.subtotalCents)}</dd>
          </div>
          {(estimate.discountCents ?? 0) > 0 && (
            <div>
              <dt>Discount</dt>
              <dd>−{money(estimate.discountCents)}</dd>
            </div>
          )}
          {(estimate.taxCents ?? 0) > 0 && (
            <div>
              <dt>Tax ({estimate.taxRatePercent ?? 0}%)</dt>
              <dd>{money(estimate.taxCents)}</dd>
            </div>
          )}
          <div className="estimate-total-row">
            <dt>Estimate total</dt>
            <dd>{money(estimate.totalCents)}</dd>
          </div>
          {(estimate.depositCents ?? 0) > 0 && (
            <>
              <div>
                <dt>Deposit</dt>
                <dd>{money(estimate.depositCents)}</dd>
              </div>
              <div>
                <dt>Balance after deposit</dt>
                <dd>{money(balanceAfterDeposit)}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      {(estimate.assumptions.length > 0 || estimate.exclusions.length > 0) && (
        <section className="estimate-fine-print">
          {estimate.assumptions.length > 0 && (
            <div>
              <span>Assumptions</span>
              <ul>
                {estimate.assumptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {estimate.exclusions.length > 0 && (
            <div>
              <span>Not included</span>
              <ul>
                {estimate.exclusions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="estimate-approval">
        <div>
          <span>Customer approval</span>
          <i />
          <small>Signature</small>
        </div>
        <div>
          <span>&nbsp;</span>
          <i />
          <small>Date</small>
        </div>
      </section>

      <footer className="estimate-document-footer">
        <strong>Thank you for the opportunity to earn your business.</strong>
        <span>
          This estimate describes the anticipated scope and pricing. Any change
          to the approved scope will be documented before additional work.
        </span>
      </footer>
    </article>
  );
}
