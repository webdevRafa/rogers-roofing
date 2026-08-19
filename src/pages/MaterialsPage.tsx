import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Boxes,
  CircleDollarSign,
  PackageCheck,
  PackageSearch,
  Plus,
  Ruler,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

import { useOrg } from "../contexts/OrgContext";
import { db } from "../firebase/firebaseConfig";
import {
  MATERIAL_CATEGORY_LABELS,
  type MaterialCatalogItem,
  type RoofingMaterialCategory,
  type RoofingMaterialType,
  type RoofingUnit,
} from "../domain/roofing";

type MaterialTypeOption = {
  value: RoofingMaterialType;
  label: string;
  description: string;
  category: RoofingMaterialCategory;
  pricingUnit: Extract<RoofingUnit, "EA" | "SQ">;
  codePrefix: string;
};

type CatalogForm = {
  materialType: RoofingMaterialType | "";
  displayName: string;
  internalCode: string;
  manufacturer: string;
  productLine: string;
  color: string;
  sku: string;
  defaultRate: string;
  defaultWastePercent: string;
  requiredForWarranty: boolean;
  specialOrderDefault: boolean;
  returnableDefault: boolean;
};

const materialTypes: MaterialTypeOption[] = [
  {
    value: "FIELD_SHINGLES",
    label: "Field shingles",
    description: "Primary roof-covering shingles measured by roofing square.",
    category: "FIELD_ROOFING",
    pricingUnit: "SQ",
    codePrefix: "FS",
  },
  {
    value: "HIP_RIDGE_SHINGLES",
    label: "Hip / ridge shingles",
    description: "Cap shingles for hips and ridges, measured by roofing square.",
    category: "HIP_RIDGE_CAP",
    pricingUnit: "SQ",
    codePrefix: "HR",
  },
  {
    value: "STARTER_STRIP",
    label: "Starter strip",
    description: "Starter-course material priced by the supplied unit.",
    category: "STARTER",
    pricingUnit: "EA",
    codePrefix: "SS",
  },
  {
    value: "FELT_UNDERLAYMENT",
    label: "Felt / underlayment",
    description: "Felt or synthetic roof underlayment measured by roofing square.",
    category: "UNDERLAYMENT",
    pricingUnit: "SQ",
    codePrefix: "FU",
  },
  {
    value: "DRIP_EDGE",
    label: "Drip edge / edge flashing",
    description: "Perimeter edge-metal components priced by unit.",
    category: "EDGE_METAL",
    pricingUnit: "EA",
    codePrefix: "DE",
  },
  {
    value: "PIPE_FLASHING_ROOF_JACK",
    label: "Pipe flashing / roof jacks",
    description: "Roof-penetration flashing components priced by unit.",
    category: "PENETRATION_ACCESSORY",
    pricingUnit: "EA",
    codePrefix: "PJ",
  },
  {
    value: "ATTIC_VENT",
    label: "Attic vents",
    description: "Passive roof or attic ventilation components priced by unit.",
    category: "VENTILATION",
    pricingUnit: "EA",
    codePrefix: "AV",
  },
  {
    value: "EXHAUST_VENT",
    label: "Exhaust vents",
    description: "Exhaust ventilation components priced by unit.",
    category: "VENTILATION",
    pricingUnit: "EA",
    codePrefix: "EV",
  },
  {
    value: "L_FLASHING",
    label: "L flashing",
    description: "L-profile flashing pieces priced by unit.",
    category: "FLASHING",
    pricingUnit: "EA",
    codePrefix: "LF",
  },
  {
    value: "J_STEP_FLASHING",
    label: "J flashing / step flashing",
    description: "Wall and step-flashing components priced by unit.",
    category: "FLASHING",
    pricingUnit: "EA",
    codePrefix: "JF",
  },
  {
    value: "COUNTER_FLASHING",
    label: "Counter flashing",
    description: "Counter-flashing components priced by unit.",
    category: "FLASHING",
    pricingUnit: "EA",
    codePrefix: "CF",
  },
  {
    value: "TIN_CAPS",
    label: "Tin caps",
    description: "Roofing fastener caps priced by unit.",
    category: "FASTENER",
    pricingUnit: "EA",
    codePrefix: "TC",
  },
  {
    value: "ROOFING_COIL_NAILS",
    label: "Roofing coil nails",
    description: "Coil-nail supplies priced by unit.",
    category: "FASTENER",
    pricingUnit: "EA",
    codePrefix: "CN",
  },
];

const initialForm: CatalogForm = {
  materialType: "",
  displayName: "",
  internalCode: "",
  manufacturer: "",
  productLine: "",
  color: "",
  sku: "",
  defaultRate: "",
  defaultWastePercent: "",
  requiredForWarranty: false,
  specialOrderDefault: false,
  returnableDefault: true,
};

function getMaterialTypeOption(type?: RoofingMaterialType | null) {
  return materialTypes.find((option) => option.value === type);
}

function inferLegacyType(category: RoofingMaterialCategory) {
  const matchByCategory: Partial<
    Record<RoofingMaterialCategory, RoofingMaterialType>
  > = {
    FIELD_ROOFING: "FIELD_SHINGLES",
    HIP_RIDGE_CAP: "HIP_RIDGE_SHINGLES",
    STARTER: "STARTER_STRIP",
    UNDERLAYMENT: "FELT_UNDERLAYMENT",
    EDGE_METAL: "DRIP_EDGE",
    PENETRATION_ACCESSORY: "PIPE_FLASHING_ROOF_JACK",
    VENTILATION: "ATTIC_VENT",
    FLASHING: "J_STEP_FLASHING",
    FASTENER: "ROOFING_COIL_NAILS",
  };
  return matchByCategory[category] ?? null;
}

function getItemType(item: MaterialCatalogItem) {
  return item.materialType ?? inferLegacyType(item.category);
}

function getItemTypeLabel(item: MaterialCatalogItem) {
  return (
    getMaterialTypeOption(item.materialType)?.label ??
    MATERIAL_CATEGORY_LABELS[item.category]
  );
}

function getItemPricingUnit(item: MaterialCatalogItem) {
  return (
    getMaterialTypeOption(item.materialType)?.pricingUnit ?? item.purchaseUnit
  );
}

function money(cents?: number | null): string {
  if (typeof cents !== "number") return "Not set";
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function MaterialsPage() {
  const { orgId, loading: orgLoading } = useOrg();
  const [items, setItems] = useState<MaterialCatalogItem[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<RoofingMaterialType | "all">(
    "all"
  );
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CatalogForm>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    const catalogQuery = query(
      collection(db, "materialCatalog"),
      where("organizationId", "==", orgId)
    );
    return onSnapshot(
      catalogQuery,
      (snapshot) => {
        setItems(
          snapshot.docs.map((document) => ({
            id: document.id,
            ...(document.data() as Omit<MaterialCatalogItem, "id">),
          }))
        );
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      }
    );
  }, [orgId]);

  const selectedType = useMemo(
    () => getMaterialTypeOption(form.materialType || null),
    [form.materialType]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...items]
      .filter(
        (item) => typeFilter === "all" || getItemType(item) === typeFilter
      )
      .filter((item) => {
        if (!term) return true;
        return [
          item.displayName,
          item.genericName,
          item.internalCode,
          item.manufacturer,
          item.productLine,
          item.sku,
          getItemTypeLabel(item),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term);
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [items, search, typeFilter]);

  const summary = useMemo(
    () => ({
      active: items.filter((item) => item.active).length,
      warranty: items.filter((item) => item.requiredForWarranty).length,
      specialOrder: items.filter((item) => item.specialOrderDefault).length,
      types: new Set(items.map((item) => getItemTypeLabel(item))).size,
    }),
    [items]
  );

  function openForm() {
    setForm(initialForm);
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setForm(initialForm);
    setError(null);
  }

  function selectMaterialType(materialType: RoofingMaterialType) {
    const option = getMaterialTypeOption(materialType);
    setForm((current) => ({
      ...current,
      materialType,
      displayName: option?.label ?? "",
      defaultWastePercent:
        option?.pricingUnit === "SQ" ? current.defaultWastePercent : "",
    }));
    setError(null);
  }

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!orgId || !selectedType) {
      setError("Choose a material type before continuing.");
      return;
    }

    const displayName = form.displayName.trim();
    const rateNumber = Number(form.defaultRate);
    const wasteNumber = Number(form.defaultWastePercent);
    if (!displayName) {
      setError("Add a catalog name for this material.");
      return;
    }
    if (!Number.isFinite(rateNumber) || rateNumber <= 0) {
      setError(
        `Enter a rate greater than $0 per ${
          selectedType.pricingUnit === "SQ" ? "SQ" : "unit"
        }.`
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const itemRef = doc(collection(db, "materialCatalog"));
      const generatedCode = `${selectedType.codePrefix}-${itemRef.id
        .slice(0, 6)
        .toUpperCase()}`;
      const item: Omit<MaterialCatalogItem, "id"> = {
        organizationId: orgId,
        active: true,
        materialType: selectedType.value,
        internalCode: form.internalCode.trim() || generatedCode,
        category: selectedType.category,
        genericName: selectedType.label,
        displayName,
        manufacturer: form.manufacturer.trim() || null,
        productLine: form.productLine.trim() || null,
        sku: form.sku.trim() || null,
        color: form.color.trim() || null,
        purchaseUnit: selectedType.pricingUnit,
        usageUnit: selectedType.pricingUnit,
        purchaseToUsageConversion: 1,
        coverageQuantity: null,
        coverageUnit: null,
        roofSystemCompatibility: [],
        warrantyPrograms: [],
        requiredForWarranty: form.requiredForWarranty,
        returnableDefault: form.returnableDefault,
        specialOrderDefault: form.specialOrderDefault,
        defaultWastePercent:
          selectedType.pricingUnit === "SQ" &&
          Number.isFinite(wasteNumber) &&
          wasteNumber >= 0
            ? wasteNumber
            : null,
        preferredSupplierId: null,
        defaultCostCents: Math.round(rateNumber * 100),
        defaultSellPriceCents: null,
        costUpdatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(itemRef, item);
      setForm(initialForm);
      setFormOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading || orgLoading) {
    return (
      <div className="admin-loading">
        <div>
          <span />
          Loading material catalog…
        </div>
      </div>
    );
  }

  return (
    <main className="admin-page materials-page">
      <div className="admin-content-width">
        <header className="admin-page-header">
          <div>
            <span className="admin-kicker">Cost and product controls</span>
            <h1>Materials</h1>
            <p>
              Build a dependable roofing catalog with clear material types,
              consistent pricing, and supplier-ready product details.
            </p>
          </div>
          <button
            className="admin-primary-button"
            type="button"
            onClick={openForm}
          >
            <Plus size={16} />
            Add material
          </button>
        </header>

        <section className="materials-summary">
          <article>
            <PackageCheck />
            <span>Active products</span>
            <strong>{summary.active}</strong>
          </article>
          <article>
            <ShieldCheck />
            <span>Warranty components</span>
            <strong>{summary.warranty}</strong>
          </article>
          <article>
            <Boxes />
            <span>Material types</span>
            <strong>{summary.types}</strong>
          </article>
          <article>
            <PackageSearch />
            <span>Special-order defaults</span>
            <strong>{summary.specialOrder}</strong>
          </article>
        </section>

        <div className="materials-principle">
          <ShieldCheck size={18} />
          <p>
            Shingles and underlayment are priced by roofing square (SQ).
            Accessories, flashing, vents, and fasteners are priced per unit.
          </p>
        </div>

        <section className="admin-card materials-workspace">
          <div className="admin-toolbar">
            <label className="admin-search-field">
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search type, product, manufacturer, SKU, or code"
              />
            </label>
            <select
              className="admin-filter-select"
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(
                  event.target.value as RoofingMaterialType | "all"
                )
              }
            >
              <option value="all">All material types</option>
              {materialTypes.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="admin-toolbar-count">{filtered.length} items</span>
          </div>

          {error && !formOpen && (
            <div className="admin-inline-error">{error}</div>
          )}

          {filtered.length === 0 ? (
            <div className="admin-empty">
              <div>
                <PackageSearch size={34} />
                <strong>No catalog items yet</strong>
                <p>
                  Add the shingles, underlayment, flashing, vents, and fasteners
                  your crews use most often.
                </p>
              </div>
            </div>
          ) : (
            <div className="materials-table-wrap">
              <table className="admin-table materials-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Material type</th>
                    <th>Manufacturer</th>
                    <th>Pricing basis</th>
                    <th>Current rate</th>
                    <th>Warranty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const pricingUnit = getItemPricingUnit(item);
                    return (
                      <tr key={item.id}>
                        <td>
                          <div className="materials-product">
                            <span>
                              <PackageSearch size={16} />
                            </span>
                            <div>
                              <strong>{item.displayName}</strong>
                              <small>
                                {item.internalCode}
                                {item.sku ? ` · ${item.sku}` : ""}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>{getItemTypeLabel(item)}</td>
                        <td>
                          <div className="admin-table-stack">
                            <strong>{item.manufacturer || "Generic"}</strong>
                            <small>{item.productLine || "No product line"}</small>
                          </div>
                        </td>
                        <td>
                          <span className="material-pricing-basis">
                            {pricingUnit === "SQ" ? "Per SQ" : "Per unit"}
                          </span>
                        </td>
                        <td>
                          <strong className="material-rate">
                            {money(item.defaultCostCents)}
                          </strong>
                          <small className="material-rate-unit">
                            / {pricingUnit === "SQ" ? "SQ" : "unit"}
                          </small>
                        </td>
                        <td>
                          <span
                            className={
                              item.requiredForWarranty
                                ? "material-flag is-warranty"
                                : "material-flag"
                            }
                          >
                            {item.requiredForWarranty
                              ? "Required"
                              : "Not flagged"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={
                              item.active
                                ? "admin-status status-active"
                                : "admin-status status-archived"
                            }
                          >
                            {item.active ? "Active" : "Inactive"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {formOpen && (
        <>
          <button
            className="admin-drawer-scrim"
            type="button"
            onClick={closeForm}
            aria-label="Close material form"
          />
          <aside
            className="admin-drawer material-form-drawer"
            aria-label="Add a material"
          >
            <div className="admin-drawer-header">
              <div>
                <span>Material catalog</span>
                <h2>Add a material</h2>
              </div>
              <button type="button" onClick={closeForm} aria-label="Close">
                ×
              </button>
            </div>
            <form onSubmit={createItem}>
              <section className="drawer-form-section material-type-section">
                <div className="drawer-form-heading">
                  <span>01</span>
                  <div>
                    <strong>Choose the material type</strong>
                    <small>
                      This sets the correct measurement and pricing method.
                    </small>
                  </div>
                </div>
                <label>
                  Material type *
                  <select
                    required
                    value={form.materialType}
                    onChange={(event) =>
                      selectMaterialType(
                        event.target.value as RoofingMaterialType
                      )
                    }
                  >
                    <option value="" disabled>
                      Select a material type
                    </option>
                    {materialTypes.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedType ? (
                  <div className="material-type-guidance" aria-live="polite">
                    <span>
                      {selectedType.pricingUnit === "SQ" ? (
                        <Ruler size={18} />
                      ) : (
                        <PackageCheck size={18} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {selectedType.pricingUnit === "SQ"
                          ? "Measured and priced by SQ"
                          : "Measured and priced per unit"}
                      </strong>
                      <p>{selectedType.description}</p>
                      {selectedType.pricingUnit === "SQ" && (
                        <small>1 roofing SQ = 100 square feet</small>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="material-type-placeholder">
                    <Ruler size={18} />
                    Select a type to see the right product and pricing fields.
                  </div>
                )}
              </section>

              {selectedType && (
                <>
                  <section className="drawer-form-section">
                    <div className="drawer-form-heading">
                      <span>02</span>
                      <div>
                        <strong>Product details</strong>
                        <small>
                          Add only the details you need to recognize and reorder
                          it.
                        </small>
                      </div>
                    </div>
                    <label>
                      Catalog name *
                      <input
                        required
                        value={form.displayName}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            displayName: event.target.value,
                          }))
                        }
                        placeholder={selectedType.label}
                      />
                    </label>
                    <div className="drawer-form-grid">
                      <label>
                        Manufacturer
                        <input
                          value={form.manufacturer}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              manufacturer: event.target.value,
                            }))
                          }
                          placeholder="e.g. IKO, Tamko"
                        />
                      </label>
                      <label>
                        Product line / model
                        <input
                          value={form.productLine}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              productLine: event.target.value,
                            }))
                          }
                          placeholder="e.g. Cambridge"
                        />
                      </label>
                    </div>
                    <div className="drawer-form-grid">
                      <label>
                        Color / variant
                        <input
                          value={form.color}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              color: event.target.value,
                            }))
                          }
                          placeholder="e.g. Dual Black"
                        />
                      </label>
                      <label>
                        SKU / supplier code
                        <input
                          value={form.sku}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              sku: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <label>
                      <span className="field-label">
                        Internal reference
                        <small className="field-optional">Optional</small>
                      </span>
                      <input
                        value={form.internalCode}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            internalCode: event.target.value,
                          }))
                        }
                        placeholder="Generated automatically if left blank"
                      />
                    </label>
                  </section>

                  <section className="drawer-form-section">
                    <div className="drawer-form-heading">
                      <span>03</span>
                      <div>
                        <strong>Pricing</strong>
                        <small>
                          Set the default supplier rate used for estimating.
                        </small>
                      </div>
                    </div>
                    <div
                      className={
                        selectedType.pricingUnit === "SQ"
                          ? "material-pricing-fields drawer-form-grid"
                          : "material-pricing-fields"
                      }
                    >
                      <label>
                        {selectedType.pricingUnit === "SQ"
                          ? "Rate per SQ ($) *"
                          : "Rate per unit ($) *"}
                        <div className="material-rate-input">
                          <CircleDollarSign size={17} />
                          <input
                            required
                            type="number"
                            min="0.01"
                            step="0.01"
                            inputMode="decimal"
                            value={form.defaultRate}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                defaultRate: event.target.value,
                              }))
                            }
                            placeholder="0.00"
                          />
                          <span>
                            / {selectedType.pricingUnit === "SQ" ? "SQ" : "unit"}
                          </span>
                        </div>
                      </label>
                      {selectedType.pricingUnit === "SQ" && (
                        <label>
                          Default waste allowance (%)
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            inputMode="decimal"
                            value={form.defaultWastePercent}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                defaultWastePercent: event.target.value,
                              }))
                            }
                            placeholder="e.g. 10"
                          />
                        </label>
                      )}
                    </div>
                    <div className="material-pricing-note">
                      <Ruler size={16} />
                      {selectedType.pricingUnit === "SQ"
                        ? "Quantities will be entered in SQ and multiplied by this rate."
                        : "Quantities will be entered as units and multiplied by this rate."}
                    </div>
                  </section>

                  <section className="drawer-form-section">
                    <div className="drawer-form-heading">
                      <span>04</span>
                      <div>
                        <strong>Catalog defaults</strong>
                        <small>
                          Optional purchasing flags for your internal workflow.
                        </small>
                      </div>
                    </div>
                    <div className="material-toggle-list">
                      <label>
                        <input
                          type="checkbox"
                          checked={form.requiredForWarranty}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              requiredForWarranty: event.target.checked,
                            }))
                          }
                        />
                        <span>
                          Required warranty component
                          <small>
                            Flag this item during packet readiness review.
                          </small>
                        </span>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={form.specialOrderDefault}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              specialOrderDefault: event.target.checked,
                            }))
                          }
                        />
                        <span>
                          Special order by default
                          <small>
                            May have lead-time or cancellation exposure.
                          </small>
                        </span>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={form.returnableDefault}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              returnableDefault: event.target.checked,
                            }))
                          }
                        />
                        <span>
                          Normally returnable
                          <small>Actual supplier terms still control.</small>
                        </span>
                      </label>
                    </div>
                  </section>
                </>
              )}

              {error && <div className="admin-inline-error">{error}</div>}
              <div className="admin-drawer-actions">
                <button
                  className="admin-primary-button"
                  type="submit"
                  disabled={saving || !selectedType}
                >
                  {saving ? "Saving material…" : "Add to material catalog"}
                  {!saving && <ArrowRight size={16} />}
                </button>
              </div>
            </form>
          </aside>
        </>
      )}
    </main>
  );
}
