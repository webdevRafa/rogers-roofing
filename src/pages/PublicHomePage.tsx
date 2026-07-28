import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  Check,
  ClipboardCheck,
  FileCheck2,
  Hammer,
  HardHat,
  Home,
  MapPin,
  Menu,
  Ruler,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { motion } from "framer-motion";

import Reveal from "../components/Reveal";
import { functions } from "../firebase/firebaseConfig";
import logo from "../assets/rogers-roofing.webp";
import finishedRoof from "../assets/AdobeStock_102630327.webp";
import roofInstallation from "../assets/AdobeStock_217480947.webp";
import roofWorksite from "../assets/AdobeStock_356783144.webp";

type LeadFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  service: string;
  urgency: string;
  preferredContact: string;
  message: string;
  consent: boolean;
  website: string;
};

type EstimateRequestConfirmation = {
  leadId: string;
  requestNumber: string;
  status: "new";
};

const initialLead: LeadFormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
  service: "roof_replacement",
  urgency: "within_month",
  preferredContact: "phone",
  message: "",
  consent: false,
  website: "",
};

const services = [
  {
    icon: Home,
    title: "Roof replacement",
    copy: "A complete, clearly scoped replacement plan built around the home, roof system, and long-term performance.",
  },
  {
    icon: Wrench,
    title: "Roof repair",
    copy: "Focused diagnostics and repair work for leaks, flashing, penetrations, storm damage, and isolated failures.",
  },
  {
    icon: ShieldCheck,
    title: "Storm restoration",
    copy: "Documented inspections, photo evidence, and a practical plan for restoring weather-damaged roofing systems.",
  },
  {
    icon: Ruler,
    title: "New installation",
    copy: "Roofing systems for additions and new construction, coordinated from material selection through closeout.",
  },
  {
    icon: ClipboardCheck,
    title: "Roof inspections",
    copy: "A thorough review of condition, ventilation, details, and visible risk areas before you make a decision.",
  },
  {
    icon: HardHat,
    title: "Commercial roofing",
    copy: "Organized project documentation and service planning for light-commercial and managed properties.",
  },
];

const processSteps = [
  {
    number: "01",
    title: "Tell us what is happening",
    copy: "Share the property address, the service you need, and any leak or storm details you already know.",
  },
  {
    number: "02",
    title: "We inspect and document",
    copy: "The roof is evaluated, measurements and conditions are recorded, and the right scope is developed.",
  },
  {
    number: "03",
    title: "You receive a clear plan",
    copy: "Your estimate explains the work, selected materials, options, assumptions, and next steps without guesswork.",
  },
  {
    number: "04",
    title: "We build and close out",
    copy: "The project stays organized through installation, quality checks, final billing, and warranty documentation.",
  },
];

export default function PublicHomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [lead, setLead] = useState(initialLead);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] =
    useState<EstimateRequestConfirmation | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  function updateLead<K extends keyof LeadFormState>(
    key: K,
    value: LeadFormState[K]
  ) {
    setLead((current) => ({ ...current, [key]: value }));
  }

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!lead.consent) {
      setFormError("Please confirm that we may contact you about this request.");
      return;
    }

    setSubmitting(true);
    try {
      const submit = httpsCallable<
        Omit<LeadFormState, "consent"> & {
          consent: boolean;
          propertyType: "residential";
          source: "website";
        },
        EstimateRequestConfirmation & { ok: true }
      >(functions, "submitWebsiteLead");
      const response = await submit({
        ...lead,
        propertyType: "residential",
        source: "website",
      });
      setConfirmation(response.data);
      setLead(initialLead);
    } catch (error) {
      console.error("Lead submission failed", error);
      setFormError(
        "We could not send your request just now. Please try again in a moment."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="public-site">
      <header className="public-header">
        <a className="public-brand" href="#top" aria-label="Rogers Roofing home">
          <img src={logo} alt="" />
          <span>
            <strong>Roger&apos;s Roofing</strong>
            <small>&amp; Contracting LLC</small>
          </span>
        </a>

        <nav className={menuOpen ? "public-nav is-open" : "public-nav"}>
          <a href="#services" onClick={() => setMenuOpen(false)}>
            Services
          </a>
          <a href="#approach" onClick={() => setMenuOpen(false)}>
            Our approach
          </a>
          <a href="#process" onClick={() => setMenuOpen(false)}>
            Process
          </a>
          <a href="#estimate" onClick={() => setMenuOpen(false)}>
            Free estimate
          </a>
          <Link className="public-nav-login" to="/login">
            Admin sign in
          </Link>
        </nav>

        <div className="public-header-actions">
          <a className="public-button public-button-small" href="#estimate">
            Request an estimate
            <ArrowUpRight size={16} />
          </a>
          <button
            className="public-menu-button"
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      <main>
        <section className="public-hero" id="top">
          <div className="public-hero-media" aria-hidden="true">
            <img
              className="public-hero-image"
              src={finishedRoof}
              alt=""
            />
            <div className="public-hero-shade" />
          </div>
          <div className="public-hero-content">
            <motion.div
              className="public-eyebrow public-eyebrow-light"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
            >
              <MapPin size={15} />
              San Antonio, Texas
              <span />
              Roofing &amp; contracting
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.85, delay: 0.08 }}
            >
              Roofing built to protect
              {" "}
              <em>what matters most.</em>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.85, delay: 0.16 }}
            >
              Thoughtful inspections, clear estimates, and organized project
              delivery for roof replacements, repairs, and new installations.
            </motion.p>
            <motion.div
              className="public-hero-actions"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.85, delay: 0.24 }}
            >
              <a className="public-button" href="#estimate">
                Schedule a free estimate
                <ArrowRight size={18} />
              </a>
              <a className="public-text-link public-text-link-light" href="#services">
                Explore our services
                <ArrowUpRight size={16} />
              </a>
            </motion.div>
          </div>

          <motion.aside
            className="public-hero-note"
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.35 }}
          >
            <span className="public-note-icon">
              <ShieldCheck size={20} />
            </span>
            <div>
              <small>A complete project record</small>
              <strong>From first inspection to warranty closeout.</strong>
            </div>
          </motion.aside>
        </section>

        <div className="public-content-shell">
          <section className="public-trust-strip" aria-label="Service qualities">
          <span>
            <Check size={16} /> Detailed written scopes
          </span>
          <span>
            <Check size={16} /> Material transparency
          </span>
          <span>
            <Check size={16} /> Photo documentation
          </span>
          <span>
            <Check size={16} /> Professional closeout
          </span>
          </section>

          <section className="public-section public-services" id="services">
          <Reveal className="public-section-heading">
            <div>
              <span className="public-eyebrow">Built for South Texas homes</span>
              <h2>The right roofing service, clearly explained.</h2>
            </div>
            <p>
              Every property is different. We start with the condition in front
              of us, then build the scope and material plan the roof actually
              needs.
            </p>
          </Reveal>

          <div className="public-service-grid">
            {services.map((service, index) => {
              const Icon = service.icon;
              return (
                <Reveal
                  className="public-service-card"
                  delay={index * 0.045}
                  key={service.title}
                >
                  <div className="public-service-number">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <Icon size={26} strokeWidth={1.6} />
                  <h3>{service.title}</h3>
                  <p>{service.copy}</p>
                  <a href="#estimate" aria-label={`Ask about ${service.title}`}>
                    Ask about this service <ArrowUpRight size={15} />
                  </a>
                </Reveal>
              );
            })}
          </div>
          </section>

          <section className="public-story" id="approach">
          <Reveal className="public-story-image-wrap">
            <img
              src={roofInstallation}
              alt="Roofing professional installing architectural shingles"
            />
            <span className="public-image-caption">
              Careful installation at every course
            </span>
          </Reveal>
          <Reveal className="public-story-copy" delay={0.1}>
            <span className="public-eyebrow public-eyebrow-light">
              More than a roof covering
            </span>
            <h2>Details below the surface determine how a roof performs.</h2>
            <p>
              A dependable roofing system is a coordinated assembly: decking,
              leak barriers, underlayment, ventilation, flashing, fasteners,
              shingles, and the workmanship that brings them together.
            </p>
            <ul>
              <li>
                <span>01</span>
                Existing conditions are documented before the scope is finalized.
              </li>
              <li>
                <span>02</span>
                Materials and system components are identified, not reduced to a
                single generic line item.
              </li>
              <li>
                <span>03</span>
                Completion records support future service and warranty needs.
              </li>
            </ul>
            <a className="public-text-link public-text-link-light" href="#process">
              See how the process works <ArrowRight size={16} />
            </a>
          </Reveal>
          </section>

          <section className="public-section public-process" id="process">
          <Reveal className="public-section-heading public-section-heading-narrow">
            <div>
              <span className="public-eyebrow">A calmer project experience</span>
              <h2>One clear path from question to completion.</h2>
            </div>
          </Reveal>
          <div className="public-process-layout">
            <div className="public-process-steps">
              {processSteps.map((step, index) => (
                <Reveal className="public-process-step" key={step.number} delay={index * 0.06}>
                  <span>{step.number}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.copy}</p>
                  </div>
                </Reveal>
              ))}
            </div>
            <Reveal className="public-process-image" delay={0.15}>
              <img src={roofWorksite} alt="Aerial view of a roofing project in progress" />
              <div>
                <Sparkles size={18} />
                <span>
                  <small>Organized project delivery</small>
                  Photos, materials, costs, documents, and closeout in one record.
                </span>
              </div>
            </Reveal>
          </div>
          </section>

          <section className="public-proof">
          <Reveal className="public-proof-heading">
            <span className="public-eyebrow public-eyebrow-light">
              What you can expect
            </span>
            <h2>Professional communication at every stage.</h2>
          </Reveal>
          <div className="public-proof-grid">
            <Reveal>
              <FileCheck2 />
              <h3>Clear documents</h3>
              <p>
                Estimates and invoices are itemized, readable, and connected to
                the job they describe.
              </p>
            </Reveal>
            <Reveal delay={0.06}>
              <CalendarCheck />
              <h3>Visible next steps</h3>
              <p>
                Scheduling, selections, outstanding decisions, and closeout
                requirements stay organized.
              </p>
            </Reveal>
            <Reveal delay={0.12}>
              <Hammer />
              <h3>Job-level accountability</h3>
              <p>
                Work, materials, photos, costs, and warranty evidence remain
                connected to the property.
              </p>
            </Reveal>
          </div>
          </section>

          <section className="public-estimate" id="estimate">
          <Reveal className="public-estimate-intro">
            <span className="public-eyebrow">Start with a free estimate</span>
            <h2>Tell us about your roof.</h2>
            <p>
              Share a few details and our team can follow up to understand the
              property, the urgency, and the right next step.
            </p>
            <div className="public-estimate-points">
              <span>
                <Check /> No-cost estimate request
              </span>
              <span>
                <Check /> Residential and commercial inquiries
              </span>
              <span>
                <Check /> Repair, replacement, storm, and new-build work
              </span>
            </div>
          </Reveal>

          <Reveal className="public-estimate-card" delay={0.12}>
            {confirmation ? (
              <div
                className="public-form-success"
                role="status"
                aria-live="polite"
              >
                <span>
                  <Check size={28} />
                </span>
                <small>Request {confirmation.requestNumber}</small>
                <h3>Your estimate request is safely in our queue.</h3>
                <p>
                  Thank you. A member of Roger&apos;s Roofing &amp; Contracting
                  will review the details and follow up using your preferred
                  contact method.
                </p>
                <div className="public-success-timeline">
                  <div className="is-complete">
                    <strong>1</strong>
                    <span>
                      <b>Request received</b>
                      Saved securely
                    </span>
                  </div>
                  <div>
                    <strong>2</strong>
                    <span>
                      <b>Team review</b>
                      Scope and timing
                    </span>
                  </div>
                  <div>
                    <strong>3</strong>
                    <span>
                      <b>Next step</b>
                      Contact or inspection
                    </span>
                  </div>
                </div>
                <p className="public-success-reference">
                  Keep <strong>{confirmation.requestNumber}</strong> for your
                  records.
                </p>
                <button type="button" onClick={() => setConfirmation(null)}>
                  Submit another property
                </button>
              </div>
            ) : (
              <form onSubmit={submitLead}>
                <div className="public-form-heading">
                  <span>Free estimate request</span>
                  <small>Fields marked * are required</small>
                </div>
                <div className="public-form-grid">
                  <label>
                    First name *
                    <input
                      required
                      autoComplete="given-name"
                      value={lead.firstName}
                      onChange={(event) => updateLead("firstName", event.target.value)}
                    />
                  </label>
                  <label>
                    Last name *
                    <input
                      required
                      autoComplete="family-name"
                      value={lead.lastName}
                      onChange={(event) => updateLead("lastName", event.target.value)}
                    />
                  </label>
                  <label>
                    Email *
                    <input
                      required
                      type="email"
                      autoComplete="email"
                      value={lead.email}
                      onChange={(event) => updateLead("email", event.target.value)}
                    />
                  </label>
                  <label>
                    Phone *
                    <input
                      required
                      type="tel"
                      autoComplete="tel"
                      value={lead.phone}
                      onChange={(event) => updateLead("phone", event.target.value)}
                    />
                  </label>
                  <label className="public-form-span">
                    Property address *
                    <input
                      required
                      autoComplete="street-address"
                      placeholder="Street, city, state, ZIP"
                      value={lead.address}
                      onChange={(event) => updateLead("address", event.target.value)}
                    />
                  </label>
                  <label>
                    What can we help with? *
                    <select
                      value={lead.service}
                      onChange={(event) => updateLead("service", event.target.value)}
                    >
                      <option value="roof_replacement">Roof replacement</option>
                      <option value="roof_repair">Roof repair or leak</option>
                      <option value="storm_damage">Storm damage</option>
                      <option value="new_construction">New construction</option>
                      <option value="inspection">Roof inspection</option>
                      <option value="commercial_roofing">Commercial roofing</option>
                      <option value="gutters">Gutters or drainage</option>
                      <option value="other">Something else</option>
                    </select>
                  </label>
                  <label>
                    Timing
                    <select
                      value={lead.urgency}
                      onChange={(event) => updateLead("urgency", event.target.value)}
                    >
                      <option value="emergency">Active leak / urgent</option>
                      <option value="within_week">Within a week</option>
                      <option value="within_month">Within a month</option>
                      <option value="planning">Planning ahead</option>
                    </select>
                  </label>
                  <label className="public-form-span">
                    Anything we should know?
                    <textarea
                      rows={4}
                      placeholder="Tell us about the roof, visible damage, access, or a recent storm."
                      value={lead.message}
                      onChange={(event) => updateLead("message", event.target.value)}
                    />
                  </label>
                  <label className="public-form-honeypot" aria-hidden="true">
                    Website
                    <input
                      tabIndex={-1}
                      autoComplete="off"
                      value={lead.website}
                      onChange={(event) => updateLead("website", event.target.value)}
                    />
                  </label>
                </div>

                <div className="public-contact-preference">
                  <span>Preferred contact</span>
                  {["phone", "text", "email"].map((method) => (
                    <label key={method}>
                      <input
                        type="radio"
                        name="preferredContact"
                        value={method}
                        checked={lead.preferredContact === method}
                        onChange={(event) =>
                          updateLead("preferredContact", event.target.value)
                        }
                      />
                      {method}
                    </label>
                  ))}
                </div>

                <label className="public-consent">
                  <input
                    type="checkbox"
                    checked={lead.consent}
                    onChange={(event) => updateLead("consent", event.target.checked)}
                  />
                  <span>
                    I agree that Roger&apos;s Roofing &amp; Contracting LLC may
                    contact me about this request. *
                  </span>
                </label>

                {formError && (
                  <div className="public-form-error" role="alert">
                    {formError}
                  </div>
                )}

                <button
                  className="public-button public-form-submit"
                  type="submit"
                  disabled={submitting}
                >
                  {submitting ? "Sending request…" : "Request my free estimate"}
                  {!submitting && <ArrowRight size={18} />}
                </button>
                <p className="public-form-note">
                  Submitting a request does not create a contract or guarantee
                  coverage, price, or appointment availability.
                </p>
              </form>
            )}
          </Reveal>
          </section>
        </div>
      </main>

      <footer className="public-footer">
        <div className="public-footer-brand">
          <img src={logo} alt="" />
          <div>
            <strong>Roger&apos;s Roofing &amp; Contracting LLC</strong>
            <span>San Antonio, Texas</span>
          </div>
        </div>
        <div className="public-footer-links">
          <a href="#services">Services</a>
          <a href="#process">Process</a>
          <a href="#estimate">Free estimate</a>
          <Link to="/login">Admin sign in</Link>
        </div>
        <p>
          © {new Date().getFullYear()} Roger&apos;s Roofing &amp; Contracting
          LLC. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
