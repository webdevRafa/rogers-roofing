import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
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
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import Reveal from "../components/Reveal";
import { functions } from "../firebase/firebaseConfig";
import logo from "../assets/rogers-logo-separated-v3.png";
import finishedRoof from "../assets/AdobeStock_102630327.webp";
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
  confirmationEmailSent: boolean;
  confirmationEmail: string;
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
    copy: "A straightforward replacement plan based on your roof's condition, your home, and the materials that fit the job.",
  },
  {
    icon: Wrench,
    title: "Roof repair",
    copy: "Practical repairs for leaks, flashing, vents, storm damage, and other problem areas—without pushing work you do not need.",
  },
  {
    icon: ShieldCheck,
    title: "Storm damage",
    copy: "A careful inspection, helpful photos, and a clear repair plan after hail, wind, or severe weather.",
  },
  {
    icon: Ruler,
    title: "New roof installation",
    copy: "Roofing for additions and new construction, coordinated from material selection through the final walkthrough.",
  },
  {
    icon: ClipboardCheck,
    title: "Roof inspections",
    copy: "A thorough look at the roof, ventilation, flashing, and visible trouble spots so you can make an informed decision.",
  },
  {
    icon: HardHat,
    title: "Commercial roofing",
    copy: "Responsive roofing service and clear project planning for small commercial and managed properties.",
  },
];

const processSteps = [
  {
    number: "01",
    title: "Tell us what is going on",
    copy: "Share the property address, what you have noticed, and whether a leak or recent storm is involved.",
  },
  {
    number: "02",
    title: "We inspect the roof",
    copy: "We look at the roof's condition, take measurements and photos, and explain what we find.",
  },
  {
    number: "03",
    title: "Review your options",
    copy: "You receive a clear estimate with the recommended work, materials, pricing, and next steps.",
  },
  {
    number: "04",
    title: "We complete the work",
    copy: "We keep you informed through installation, cleanup, final review, billing, and warranty paperwork.",
  },
];

const publicNavItems = [
  { href: "#services", label: "Services" },
  { href: "#approach", label: "Our approach" },
  { href: "#process", label: "Process" },
  { href: "#estimate", label: "Free estimate" },
];

export default function PublicHomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [lead, setLead] = useState(initialLead);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] =
    useState<EstimateRequestConfirmation | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const menuOpenRef = useRef(menuOpen);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    menuOpenRef.current = menuOpen;
    if (menuOpen) {
      setHeaderVisible(true);
    }
  }, [menuOpen]);

  useEffect(() => {
    const topRevealBoundary = 24;
    const minimumHidePosition = 120;
    const downwardIntentDistance = 48;
    const upwardIntentDistance = 72;
    const jitterTolerance = 2;

    let lastScrollY = Math.max(window.scrollY, 0);
    let directionStartY = lastScrollY;
    let direction: "up" | "down" | null = null;
    let animationFrame = 0;

    const updateHeader = () => {
      animationFrame = 0;
      const currentScrollY = Math.max(window.scrollY, 0);
      const delta = currentScrollY - lastScrollY;

      if (menuOpenRef.current || currentScrollY <= topRevealBoundary) {
        setHeaderVisible(true);
        direction = null;
        directionStartY = currentScrollY;
        lastScrollY = currentScrollY;
        return;
      }

      if (Math.abs(delta) < jitterTolerance) {
        return;
      }

      const nextDirection = delta > 0 ? "down" : "up";
      if (nextDirection !== direction) {
        direction = nextDirection;
        directionStartY = lastScrollY;
      }

      const intentionalTravel = Math.abs(currentScrollY - directionStartY);

      if (
        nextDirection === "down" &&
        currentScrollY >= minimumHidePosition &&
        intentionalTravel >= downwardIntentDistance
      ) {
        setHeaderVisible(false);
      }

      if (
        nextDirection === "up" &&
        intentionalTravel >= upwardIntentDistance
      ) {
        setHeaderVisible(true);
      }

      lastScrollY = currentScrollY;
    };

    const handleScroll = () => {
      if (!animationFrame) {
        animationFrame = window.requestAnimationFrame(updateHeader);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    const handleResize = () => {
      if (window.innerWidth > 840) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [menuOpen]);

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
      <header
        className="public-header"
        data-visibility={headerVisible ? "visible" : "hidden"}
        onFocusCapture={() => setHeaderVisible(true)}
      >
        <a className="public-brand" href="#top" aria-label="Rogers Roofing home">
          <img src={logo} alt="" />
          <span>
            <strong>Roger&apos;s Roofing</strong>
            <small>&amp; Contracting LLC</small>
          </span>
        </a>

        <nav
          className="public-nav public-nav-desktop"
          aria-label="Primary navigation"
        >
          {publicNavItems.map((item) => (
            <a href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
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
            aria-controls="public-mobile-navigation"
          >
            <motion.span
              animate={{ rotate: menuOpen ? 90 : 0 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }
              }
            >
              {menuOpen ? <X /> : <Menu />}
            </motion.span>
          </button>
        </div>

        <AnimatePresence initial={false}>
          {menuOpen && (
            <motion.nav
              id="public-mobile-navigation"
              className="public-mobile-nav"
              aria-label="Mobile navigation"
              initial={reduceMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.4, ease: [0.22, 1, 0.36, 1] }
              }
            >
              <motion.div
                className="public-mobile-nav-inner"
                initial={reduceMotion ? false : { y: -12 }}
                animate={{ y: 0 }}
                exit={{ y: -8 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }
                }
              >
                {publicNavItems.map((item) => (
                  <a
                    href={item.href}
                    key={item.href}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                    <ArrowRight size={15} />
                  </a>
                ))}
              </motion.div>
            </motion.nav>
          )}
        </AnimatePresence>
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
          <div className="public-hero-shell">
            <div className="public-hero-copy">
              <motion.div
                className="public-eyebrow public-eyebrow-light"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.08 }}
              >
                <MapPin size={15} />
                San Antonio, Texas
                <span />
                Roofing specialists
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.85, delay: 0.16 }}
              >
                Roofing built to protect
                {" "}
                <em>what matters most.</em>
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.85, delay: 0.24 }}
              >
                Straightforward inspections, detailed estimates, and dependable
                roofing work for repairs, replacements, and new construction.
              </motion.p>
              <motion.div
                className="public-hero-actions"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.85, delay: 0.32 }}
              >
                <a className="public-button" href="#estimate">
                  Request a free estimate
                  <ArrowRight size={18} />
                </a>
                <a className="public-text-link public-text-link-light" href="#services">
                  Explore our services
                  <ArrowUpRight size={16} />
                </a>
              </motion.div>
              <motion.div
                className="public-hero-assurance"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.75, delay: 0.4 }}
                aria-label="Estimate experience"
              >
                <span><Check size={15} /> Clear written estimates</span>
                <span><Check size={15} /> Materials explained</span>
              </motion.div>
            </div>

            <motion.aside
              className="public-hero-brand-card"
              initial={{ opacity: 0, x: 30, scale: 0.985 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ duration: 0.9, delay: 0.12 }}
              aria-label="Roger's Roofing & Contracting LLC"
            >
              <div className="public-hero-brand-glow" aria-hidden="true" />
              <img
                className="public-hero-emblem"
                src={logo}
                alt="Roger's Roofing & Contracting LLC emblem"
              />
              <div className="public-hero-brand-copy">
                <span>San Antonio roofing specialists</span>
                <h2>
                  Roger's Roofing
                  <small>&amp; Contracting LLC</small>
                </h2>
                <p>
                  Practical guidance and professional roofing for repairs,
                  full replacements, and new construction.
                </p>
              </div>
              <div className="public-hero-capabilities" aria-label="Primary services">
                <span>Repairs</span>
                <span>Replacements</span>
                <span>New construction</span>
              </div>
              <div className="public-hero-brand-location">
                <MapPin size={16} />
                <span>
                  <small>Based in</small>
                  San Antonio, Texas
                </span>
              </div>
            </motion.aside>
          </div>

        </section>

        <div className="public-content-shell">
          <section className="public-trust-strip" aria-label="Service qualities">
          <span>
            <Check size={16} /> Clear written estimates
          </span>
          <span>
            <Check size={16} /> Materials explained
          </span>
          <span>
            <Check size={16} /> Progress photos
          </span>
          <span>
            <Check size={16} /> Final walkthrough
          </span>
          </section>

          <section className="public-section public-services" id="services">
          <Reveal className="public-section-heading">
            <div>
              <span className="public-eyebrow">Built for South Texas homes</span>
              <h2>
                Roofing help that fits the problem—not a one-size-fits-all
                pitch.
              </h2>
            </div>
            <p>
              Every roof is different. We inspect the actual condition, explain
              what we find, and recommend the work and materials that make sense
              for your property.
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
                  <a
                    href="#estimate"
                    aria-label={`Talk to us about ${service.title}`}
                  >
                    Talk to us about it <ArrowUpRight size={15} />
                  </a>
                </Reveal>
              );
            })}
          </div>
          </section>

          <section className="public-story" id="approach">
          <div
            className="public-story-image-wrap"
            role="img"
            aria-label="Roofing professional installing architectural shingles"
          >
            <span className="public-image-caption">
              Careful workmanship at every course
            </span>
          </div>
          <Reveal className="public-story-copy" delay={0.1}>
            <span className="public-eyebrow public-eyebrow-light">
              Built as a complete system
            </span>
            <h2>A roof performs best when every layer works together.</h2>
            <p>
              A dependable roof is more than shingles. Decking, underlayment,
              leak barriers, ventilation, flashing, fasteners, and careful
              installation all work together to protect the building below.
            </p>
            <ul>
              <li>
                <span>01</span>
                We document the roof&apos;s current condition before recommending
                work.
              </li>
              <li>
                <span>02</span>
                We explain the materials we recommend and why they belong in the
                system.
              </li>
              <li>
                <span>03</span>
                When the job is complete, you receive the records needed for
                future service and warranty questions.
              </li>
            </ul>
            <a className="public-text-link public-text-link-light" href="#process">
              See what working with us looks like <ArrowRight size={16} />
            </a>
          </Reveal>
          </section>

          <section className="public-section public-process" id="process">
          <Reveal className="public-section-heading public-section-heading-narrow">
            <div>
              <span className="public-eyebrow">What to expect</span>
              <h2>A clear process from first call to final walkthrough.</h2>
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
                  <small>The details stay organized</small>
                  Photos, selections, pricing, and paperwork stay connected to
                  your project.
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
            <h2>Clear communication from start to finish.</h2>
          </Reveal>
          <div className="public-proof-grid">
            <Reveal>
              <FileCheck2 />
              <h3>Straightforward paperwork</h3>
              <p>
                Estimates and invoices are itemized, easy to read, and specific
                to the work on your property.
              </p>
            </Reveal>
            <Reveal delay={0.06}>
              <CalendarCheck />
              <h3>No guessing about next steps</h3>
              <p>
                We explain timing, material choices, open questions, and what
                needs to happen next.
              </p>
            </Reveal>
            <Reveal delay={0.12}>
              <Hammer />
              <h3>Care from start to finish</h3>
              <p>
                The work, materials, photos, costs, and warranty information
                stay tied to your project.
              </p>
            </Reveal>
          </div>
          </section>

          <section className="public-estimate" id="estimate">
          <Reveal className="public-estimate-intro">
            <span className="public-eyebrow">Start with a free estimate</span>
            <h2>Tell us what is going on with your roof.</h2>
            <p>
              Share the address and a few details about what you have noticed.
              We will review your request and follow up about the best next
              step.
            </p>
            <div className="public-estimate-points">
              <span>
                <Check /> Free, no-obligation estimate request
              </span>
              <span>
                <Check /> Homes and small commercial properties
              </span>
              <span>
                <Check /> Repairs, replacements, storm damage, and new
                construction
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
                <h3>We received your estimate request.</h3>
                <p>
                  Thank you. Our team will review the details and contact you
                  using the method you selected.
                </p>
                {confirmation.confirmationEmailSent && (
                  <p className="public-success-email">
                    We also sent a confirmation to{" "}
                    <strong>{confirmation.confirmationEmail}</strong>.
                  </p>
                )}
                <div className="public-success-timeline">
                  <div className="is-complete">
                    <strong>1</strong>
                    <span>
                      <b>Request received</b>
                      Details saved
                    </span>
                  </div>
                  <div>
                    <strong>2</strong>
                    <span>
                      <b>Team review</b>
                      We look it over
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
                  Request an estimate for another property
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
                  Sending this form does not create a contract or guarantee
                  pricing, coverage, or appointment availability.
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
        </div>
        <p>
          © {new Date().getFullYear()} Roger&apos;s Roofing &amp; Contracting
          LLC. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
