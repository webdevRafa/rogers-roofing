import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Boxes,
  PackageCheck,
  PackageSearch,
  Plus,
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
  type RoofingUnit,
} from "../domain/roofing";

type CatalogForm = {
  displayName: string;
  genericName: string;
  internalCode: string;
  category: RoofingMaterialCategory;
  manufacturer: string;
  productLine: string;
  sku: string;
  purchaseUnit: RoofingUnit;
  usageUnit: RoofingUnit;
  defaultCost: string;
  defaultWastePercent: string;
  requiredForWarranty: boolean;
  specialOrderDefault: boolean;
  returnableDefault: boolean;
};

const initialForm: CatalogForm = {
  displayName: "",
  genericName: "",
  internalCode: "",
  category: "FIELD_ROOFING",
  manufacturer: "",
  productLine: "",
  sku: "",
  purchaseUnit: "BUNDLE",
  usageUnit: "SQ",
  defaultCost: "",
  defaultWastePercent: "",
  requiredForWarranty: false,
  specialOrderDefault: false,
  returnableDefault: true,
};

const units: RoofingUnit[] = [
  "EA",
  "SQ",
  "SF",
  "LF",
  "LS",
  "SHEET",
  "GAL",
  "ROLL",
  "BUNDLE",
  "OTHER",
];

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
  const [category, setCategory] = useState<RoofingMaterialCategory | "all">(
    "all"
  );
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
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

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...items]
      .filter((item) => category === "all" || item.category === category)
      .filter((item) => {
        if (!term) return true;
        return [
          item.displayName,
          item.genericName,
          item.internalCode,
          item.manufacturer,
          item.productLine,
          item.sku,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term);
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [category, items, search]);

  const summary = useMemo(
    () => ({
      active: items.filter((item) => item.active).length,
      warranty: items.filter((item) => item.requiredForWarranty).length,
      specialOrder: items.filter((item) => item.specialOrderDefault).length,
      categories: new Set(items.map((item) => item.category)).size,
    }),
    [items]
  );

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!orgId) return;

    setSaving(true);
    setError(null);
    try {
      const itemRef = doc(collection(db, "materialCatalog"));
      const costNumber = Number(form.defaultCost);
      const wasteNumber = Number(form.defaultWastePercent);
      const item: Omit<MaterialCatalogItem, "id"> = {
        organizationId: orgId,
        active: true,
        internalCode: form.internalCode.trim(),
        category: form.category,
        genericName: form.genericName.trim() || form.displayName.trim(),
        displayName: form.displayName.trim(),
        manufacturer: form.manufacturer.trim() || null,
        productLine: form.productLine.trim() || null,
        sku: form.sku.trim() || null,
        purchaseUnit: form.purchaseUnit,
        usageUnit: form.usageUnit,
        purchaseToUsageConversion: null,
        coverageQuantity: null,
        coverageUnit: null,
        roofSystemCompatibility: [],
        warrantyPrograms: [],
        requiredForWarranty: form.requiredForWarranty,
        returnableDefault: form.returnableDefault,
        specialOrderDefault: form.specialOrderDefault,
        defaultWastePercent:
          Number.isFinite(wasteNumber) && wasteNumber >= 0 ? wasteNumber : null,
        preferredSupplierId: null,
        defaultCostCents:
          Number.isFinite(costNumber) && costNumber >= 0
            ? Math.round(costNumber * 100)
            : null,
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
              Maintain a roofing-specific product catalog with purchasing units,
              historical cost snapshots, warranty relevance, and compatibility
              context.
            </p>
          </div>
          <button
            className="admin-primary-button"
            type="button"
            onClick={() => setFormOpen(true)}
          >
            <Plus size={16} />
            Add catalog item
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
            <span>Catalog categories</span>
            <strong>{summary.categories}</strong>
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
            Purchased, received, installed, returned, wasted, and credited
            quantities stay separate. Product cost is a snapshot—not a price
            that silently changes on an issued estimate.
          </p>
        </div>

        <section className="admin-card materials-workspace">
          <div className="admin-toolbar">
            <label className="admin-search-field">
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search product, manufacturer, SKU, or code"
              />
            </label>
            <select
              className="admin-filter-select"
              value={category}
              onChange={(event) =>
                setCategory(
                  event.target.value as RoofingMaterialCategory | "all"
                )
              }
            >
              <option value="all">All categories</option>
              {Object.entries(MATERIAL_CATEGORY_LABELS).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className="admin-toolbar-count">{filtered.length} items</span>
          </div>

          {error && <div className="admin-inline-error">{error}</div>}

          {filtered.length === 0 ? (
            <div className="admin-empty">
              <div>
                <PackageSearch size={34} />
                <strong>No catalog items yet</strong>
                <p>
                  Add commonly purchased roofing products, consumables,
                  delivery, disposal, permits, and warranty fees.
                </p>
              </div>
            </div>
          ) : (
            <div className="materials-table-wrap">
              <table className="admin-table materials-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Manufacturer</th>
                    <th>Purchase / use</th>
                    <th>Cost snapshot</th>
                    <th>Warranty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
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
                      <td>{MATERIAL_CATEGORY_LABELS[item.category]}</td>
                      <td>
                        <div className="admin-table-stack">
                          <strong>{item.manufacturer || "Generic"}</strong>
                          <small>{item.productLine || "No product line"}</small>
                        </div>
                      </td>
                      <td>
                        {item.purchaseUnit} → {item.usageUnit}
                      </td>
                      <td>{money(item.defaultCostCents)}</td>
                      <td>
                        <span
                          className={
                            item.requiredForWarranty
                              ? "material-flag is-warranty"
                              : "material-flag"
                          }
                        >
                          {item.requiredForWarranty ? "Required" : "Not flagged"}
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
                  ))}
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
            onClick={() => setFormOpen(false)}
            aria-label="Close material form"
          />
          <aside className="admin-drawer material-form-drawer">
            <div className="admin-drawer-header">
              <div>
                <span>Catalog</span>
                <h2>Add a material</h2>
              </div>
              <button type="button" onClick={() => setFormOpen(false)}>
                ×
              </button>
            </div>
            <form onSubmit={createItem}>
              <section className="drawer-form-section">
                <div className="drawer-form-heading">
                  <span>01</span>
                  <div>
                    <strong>Product identity</strong>
                    <small>Use exact manufacturer and product details.</small>
                  </div>
                </div>
                <label>
                  Display name *
                  <input
                    required
                    value={form.displayName}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        displayName: event.target.value,
                      }))
                    }
                    placeholder="Architectural asphalt shingles"
                  />
                </label>
                <div className="drawer-form-grid">
                  <label>
                    Internal code *
                    <input
                      required
                      value={form.internalCode}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          internalCode: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Category
                    <select
                      value={form.category}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          category: event.target
                            .value as RoofingMaterialCategory,
                        }))
                      }
                    >
                      {Object.entries(MATERIAL_CATEGORY_LABELS).map(
                        ([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        )
                      )}
                    </select>
                  </label>
                </div>
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
                    />
                  </label>
                  <label>
                    Product line
                    <input
                      value={form.productLine}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          productLine: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
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
              </section>

              <section className="drawer-form-section">
                <div className="drawer-form-heading">
                  <span>02</span>
                  <div>
                    <strong>Units and cost</strong>
                    <small>
                      Keep purchase and field-usage units distinct.
                    </small>
                  </div>
                </div>
                <div className="drawer-form-grid">
                  <label>
                    Purchase unit
                    <select
                      value={form.purchaseUnit}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          purchaseUnit: event.target.value as RoofingUnit,
                        }))
                      }
                    >
                      {units.map((unit) => (
                        <option value={unit} key={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Usage unit
                    <select
                      value={form.usageUnit}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          usageUnit: event.target.value as RoofingUnit,
                        }))
                      }
                    >
                      {units.map((unit) => (
                        <option value={unit} key={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="drawer-form-grid">
                  <label>
                    Current unit cost ($)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.defaultCost}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          defaultCost: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Default waste (%)
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={form.defaultWastePercent}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          defaultWastePercent: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="drawer-form-section">
                <div className="drawer-form-heading">
                  <span>03</span>
                  <div>
                    <strong>Purchasing controls</strong>
                    <small>
                      These defaults can be overridden with approval.
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
                      <small>Flag this item during packet readiness review.</small>
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
                      <small>May have lead-time or cancellation exposure.</small>
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

              {error && <div className="admin-inline-error">{error}</div>}
              <div className="admin-drawer-actions">
                <button
                  className="admin-primary-button"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? "Saving item…" : "Add to material catalog"}
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
