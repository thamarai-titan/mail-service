import { Dashboard } from "@/components/dashboard";
import { FAQ, SiteContent } from "@/components/site-content";
import { BRAND } from "@/lib/brand";

// Structured data so search engines understand the page is a free web app with an FAQ.
const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: BRAND.name,
    description: BRAND.description,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  },
];

export default function Home() {
  return (
    <>
      <Dashboard />
      <SiteContent />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
