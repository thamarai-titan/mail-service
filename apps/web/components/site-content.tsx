import { CheckIcon, MousePointer2Icon, PlusIcon } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { Frame } from "./app/frame";
import { Kbd } from "./app/kbd";
import { LogoMark } from "./app/logo";

const STEPS = [
  {
    title: "Copy the address",
    text: "A fresh temp mail address is waiting the moment the page opens. There is nothing to fill in.",
  },
  {
    title: "Paste it anywhere",
    text: "Use it on any sign-up form, free trial or download page that wants an email before it lets you in.",
  },
  {
    title: "Take the code",
    text: "Mail lands here in about a second. The verification code is pulled out of it, ready to copy.",
  },
];

const SPECS = [
  {
    label: "safe to open",
    text: "Scripts, forms and trackers are stripped. Remote images wait for your OK, and risky attachments are refused.",
  },
  {
    label: "up to 10 addresses",
    text: "Keep several disposable emails at once, and read them separately or in one combined inbox.",
  },
  {
    label: "free, no account",
    text: "No registration and no personal details. Your session is anonymous and lives in your browser.",
  },
];

export const FAQ = [
  {
    question: "What is temp mail?",
    answer:
      "Temp mail is a temporary, disposable email address you can use instead of your real one. It receives mail like any inbox, then deletes itself, so sign-ups and newsletters never reach your personal email.",
  },
  {
    question: "Can I receive OTP and verification codes?",
    answer: `Yes. ${BRAND.name} is built for it: verification emails arrive within seconds and the code is shown separately so you can copy it with one click.`,
  },
  {
    question: "How long does a temporary email address last?",
    answer:
      "One hour from creation. You can add an hour at a time, up to 24 hours. When it expires, the address stops receiving mail and its messages are deleted.",
  },
  {
    question: "Can I send email from a temp address?",
    answer:
      "No. Addresses are receive-only, which keeps the service from being used for spam.",
  },
  {
    question: "Is it free and anonymous?",
    answer:
      "Yes. There is no account and nothing to fill in. We do not ask for your name, phone number or real email address.",
  },
  {
    question: "Is it safe to open emails here?",
    answer:
      "Messages are cleaned before you see them: scripts, forms and tracking are removed, remote images load only if you ask, and executable attachments are blocked.",
  },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
      <span className="size-1.5 rounded-full bg-primary" />
      {children}
    </p>
  );
}

export function SiteContent() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6">
      <section aria-labelledby="intro-heading" className="mt-24 sm:mt-32">
        <p className="inline-flex items-center gap-2.5 rounded-full border bg-card py-1 pr-3.5 pl-1 text-sm text-muted-foreground">
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
            Free
          </span>
          No sign-up. Your inbox deletes itself.
        </p>
        <h2
          id="intro-heading"
          className="mt-6 max-w-5xl text-[44px] leading-[0.98] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-[80px]"
        >
          Temp mail that&apos;s{" "}
          <span className="text-primary">ready before you are.</span>
        </h2>
        <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          {BRAND.name} gives you a disposable email address for sign-ups, free
          trials and OTP codes. Mail lands in about a second, codes and
          verification links are one tap away, and everything deletes itself.
        </p>
      </section>

      <section
        id="how"
        aria-labelledby="how-heading"
        className="mt-24 grid scroll-mt-24 gap-10 sm:mt-32 lg:grid-cols-[minmax(0,1fr)_minmax(0,680px)] lg:gap-16"
      >
        <div>
          <SectionLabel>how temp mail works</SectionLabel>
          <h2
            id="how-heading"
            className="mt-5 text-4xl leading-[1.02] font-semibold tracking-[-0.04em] sm:text-[54px]"
          >
            Three steps.
            <br />
            <span className="text-muted-foreground">No account, ever.</span>
          </h2>
        </div>
        <ol className="divide-y border-y">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="grid grid-cols-[3rem_minmax(0,1fr)] gap-4 py-7 sm:grid-cols-[4rem_minmax(0,1fr)]"
            >
              <span className="pt-1 font-mono text-sm text-primary">
                0{index + 1}
              </span>
              <div>
                <h3 className="text-xl font-medium tracking-tight sm:text-2xl">
                  {step.title}
                </h3>
                <p className="mt-2 max-w-md leading-relaxed text-muted-foreground">
                  {step.text}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        id="features"
        aria-labelledby="features-heading"
        className="mt-28 scroll-mt-24 sm:mt-36"
      >
        <SectionLabel>features</SectionLabel>
        <h2
          id="features-heading"
          className="mt-5 text-4xl leading-[1.02] font-semibold tracking-[-0.04em] sm:text-[54px]"
        >
          Made for the code <span className="text-primary">you came for.</span>
        </h2>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          Most temporary email services show you an inbox. This one is built
          around the thirty seconds you actually spend in it.
        </p>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <Showcase
            label="one-tap codes"
            title="The code, not the email"
            text="Verification codes are found in the message and shown on their own. One click copies them."
          >
            <CodePreview />
          </Showcase>
          <Showcase
            label="real-time"
            title="Arrives while you watch"
            text="No refresh button. Mail slides in within a second, with an alert if you are in another tab."
          >
            <ToastPreview />
          </Showcase>
          <Showcase
            label="self-destructing"
            title="Gone when you are done"
            text="An address lasts an hour, extendable to 24. Then it and every message in it are deleted."
          >
            <TimerPreview />
          </Showcase>
        </div>

        <dl className="mt-14 grid gap-8 border-t pt-10 sm:grid-cols-3">
          {SPECS.map((spec) => (
            <div key={spec.label}>
              <dt className="font-mono text-xs text-muted-foreground">
                {spec.label}
              </dt>
              <dd className="mt-3 leading-relaxed">{spec.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        id="faq"
        aria-labelledby="faq-heading"
        className="mt-28 grid scroll-mt-24 gap-10 sm:mt-36 lg:grid-cols-[minmax(0,1fr)_minmax(0,680px)] lg:gap-16"
      >
        <div>
          <SectionLabel>faq</SectionLabel>
          <h2
            id="faq-heading"
            className="mt-5 text-4xl leading-[1.02] font-semibold tracking-[-0.04em] sm:text-[54px]"
          >
            Questions,
            <br />
            <span className="text-muted-foreground">answered.</span>
          </h2>
        </div>
        <div className="divide-y border-y">
          {FAQ.map((item) => (
            <details
              key={item.question}
              className="group [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-lg font-medium tracking-tight outline-none hover:text-primary focus-visible:text-primary">
                {item.question}
                <PlusIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-45" />
              </summary>
              <p className="max-w-xl pb-6 leading-relaxed text-muted-foreground">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </section>

      <footer className="mt-28 border-t pt-8 sm:mt-36">
        <div className="flex flex-col gap-3 font-mono text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <LogoMark className="size-4" />
            {BRAND.name.toLowerCase()} · {BRAND.tagline.toLowerCase()}
          </span>
          <span>receive-only · addresses and mail delete themselves</span>
        </div>
        <p className="mt-5 hidden flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] text-muted-foreground md:flex">
          <span>keyboard</span>
          <span className="flex items-center gap-1.5">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd> next / previous
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>c</Kbd> copy address
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>y</Kbd> copy code
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>n</Kbd> new address
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd> close message
          </span>
        </p>
        <p
          aria-hidden="true"
          className="mt-6 -mb-[0.18em] text-center text-[19vw] leading-none font-bold tracking-[-0.07em] text-foreground/[0.045] select-none lg:text-[17rem]"
        >
          {BRAND.name}
        </p>
      </footer>
    </div>
  );
}

function Showcase({
  label,
  title,
  text,
  children,
}: {
  label: string;
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <Frame label={label} innerClassName="flex flex-col">
      <div
        aria-hidden="true"
        className="relative m-1.5 flex h-60 items-center justify-center overflow-hidden rounded-xl border bg-background bg-[radial-gradient(circle_at_1px_1px,color-mix(in_oklch,var(--foreground)_9%,transparent)_1px,transparent_0)] [background-size:18px_18px]"
      >
        {children}
      </div>
      <div className="px-5 pt-4 pb-6">
        <h3 className="text-xl font-medium tracking-tight sm:text-2xl">
          {title}
        </h3>
        <p className="mt-2 leading-relaxed text-muted-foreground">{text}</p>
      </div>
    </Frame>
  );
}

function CodePreview() {
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex gap-1.5">
        {[..."482913"].map((char, index) => (
          <span
            key={index}
            className="flex h-12 w-9 items-center justify-center rounded-lg border bg-card font-mono text-2xl font-semibold shadow-sm"
          >
            {char}
          </span>
        ))}
      </div>
      <span className="relative">
        <span className="flex items-center gap-1.5 rounded-lg bg-code px-3 py-1.5 font-mono text-xs text-code-foreground shadow-md">
          <CheckIcon className="size-3.5" />
          copied
        </span>
        <MousePointer2Icon className="absolute -right-4 -bottom-4 size-5 fill-foreground text-background" />
      </span>
    </div>
  );
}

function ToastPreview() {
  const toasts = [
    { from: "Northwind", line: "Code 739104 · Confirm your email", depth: 2 },
    { from: "Acme Cloud", line: "Your sign-in link is inside", depth: 1 },
    { from: "Globex", line: "Code 205881 · Verify it's you", depth: 0 },
  ];
  return (
    <div className="relative mt-10 h-36 w-[82%]">
      {toasts.map((toast) => (
        <div
          key={toast.from}
          className="absolute inset-x-0 rounded-xl border bg-card px-4 py-3 shadow-lg"
          style={{
            bottom: `${toast.depth * 22}px`,
            transform: `scale(${1 - toast.depth * 0.07})`,
            opacity: 1 - toast.depth * 0.28,
            zIndex: 3 - toast.depth,
          }}
        >
          {/* Toasts further back show only their edge, as a real stack does. */}
          <div className={toast.depth > 0 ? "invisible" : undefined}>
            <p className="flex items-center gap-2 text-sm font-medium">
              <span className="size-1.5 rounded-full bg-primary" />
              New mail from {toast.from}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {toast.line}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function TimerPreview() {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative flex size-36 items-center justify-center">
      <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="5"
          className="stroke-muted"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          className="stroke-primary"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * 0.28}
        />
      </svg>
      <span className="text-center">
        <span className="block font-mono text-2xl font-semibold tabular-nums">
          42:17
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          left
        </span>
      </span>
    </div>
  );
}
