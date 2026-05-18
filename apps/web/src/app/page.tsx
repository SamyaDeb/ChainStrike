'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/providers/auth-provider';
import styles from './landing.module.css';

const RAIL_LOGOS = [
  { alt: 'Ripple',               src: 'https://cdn.sanity.io/images/8k2tqa6n/production/d448cf9b1ed2a35e52ca24c3a0835e15897872b8-140x48.svg' },
  { alt: 'BlackRock',            src: 'https://cdn.sanity.io/images/8k2tqa6n/production/a223fc6d453fdcb7c4cba5d947d675a045e51a83-206x48.svg' },
  { alt: 'Sei',                  src: 'https://cdn.sanity.io/images/8k2tqa6n/production/8b253ff6f933440c2ac6915b35a1f1d003a89093-110x48.svg' },
  { alt: 'Ethereum',             src: 'https://cdn.sanity.io/images/8k2tqa6n/production/d6a979cf9e4e70b36281bf27dd042410b417a332-200x48.svg' },
  { alt: 'Goldman Sachs',        src: 'https://cdn.sanity.io/images/8k2tqa6n/production/1f4092f0e458e6c0875076135ab68244f63ad740-119x48.svg' },
  { alt: 'Solana',               src: 'https://cdn.sanity.io/images/8k2tqa6n/production/a61a1400fa39068543856d032431bce2f969220c-196x48.svg' },
  { alt: 'Aon',                  src: 'https://cdn.sanity.io/images/8k2tqa6n/production/f8b343c7a4a8db7bc82283ebf6c4ce794bc6a5bd-103x48.svg' },
  { alt: 'Jupiter',              src: 'https://cdn.sanity.io/images/8k2tqa6n/production/47752805b78bd49f91e997f561e70bef42c2dedc-162x48.svg' },
  { alt: 'Wellington Management',src: 'https://cdn.sanity.io/images/8k2tqa6n/production/806c8d74ac52be47dbb747b8752e9ce9bbd82f8a-185x48.svg' },
  { alt: 'Sui',                  src: 'https://cdn.sanity.io/images/8k2tqa6n/production/c337837dace6c3a7e856fbd3905e44681287fb28-85x48.svg' },
  { alt: 'Franklin Templeton',   src: 'https://cdn.sanity.io/images/8k2tqa6n/production/9bf26bcf5b275a431b6247e9e87203c0b42e4901-147x48.svg' },
];

export default function RootPage() {
  const { user } = useAuth();
  const authed = !!user;

  return (
    <div className={styles.page}>
      <div className={styles.shell}>

        {/* NAV */}
        <nav className={styles.nav}>
          <Link href="/" className={styles.logo}>
            <span className={styles.logoImgWrap}>
              <Image src="/logo.png" alt="ChainStrike" width={56} height={56} className={styles.logoMark} />
            </span>
            <span className={styles.logoText}>ChainStrike</span>
          </Link>

          <div className={styles.navLinks}>
            <Link href="/markets">Markets</Link>
            <Link href="/markets">Assets</Link>
            <Link href="/portfolio">Portfolio</Link>
            <a href="#">Issuers</a>
            <a href="#">About</a>
          </div>

          <Link href="/markets" className={styles.btn}>Launch App</Link>
        </nav>

        {/* HERO */}
        <section className={styles.hero}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hero.jpg" alt="" className={styles.heroImg} width={1226} height={594} />

          <div className={styles.heroCopy}>
            <div className={styles.heroTextGroup}>
              <div className={styles.heroLineWrap}>
                <p className={styles.heroLine}>The Open Economy for RWAs</p>
              </div>
            </div>
            <Link
              href={authed ? '/issue/new' : '/login?redirect=/issue/new&intent=issuer'}
              className={styles.launchBtn}
            >
              Launch Token
            </Link>
          </div>

          {/* LOGO RAIL — overlaid on the hero image */}
          <div className={styles.railWrap}>
            <div className={styles.railTrack}>
              {[...RAIL_LOGOS, ...RAIL_LOGOS].map((logo, i) => (
                <div key={i} className={styles.railItem}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt={logo.alt} src={logo.src} width={120} height={30} loading="lazy" style={{ objectFit: 'contain', color: 'transparent' }} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* WHAT IS CHAINSTRIKE */}
        <section className={styles.section}>
          <div className={styles.row}>
            <div>
              <h2 className={styles.sectionTitle}>What is ChainStrike?</h2>
              <Link href="/markets" className={styles.pillBtn}>Explore markets</Link>
            </div>
            <p className={styles.lead}>
              ChainStrike is the first compliant RWA exchange where verified investors
              can discover, trade, and settle tokenized real-world assets with
              cryptographic finality on Algorand.
            </p>
          </div>

          {/* FEATURE CARDS */}
          <div className={styles.features}>
            <div className={styles.feat}>
              <h3>Regulated Orderbook</h3>
              <div className={styles.featBottom}>
                <span className={styles.featTag}>Compliant CLOB</span>
                <p>Trade tokenized bonds, equities, and commodities on a fully compliant order book with integrated KYC/AML.</p>
              </div>
            </div>

            <div className={styles.feat}>
              <h3>Algorand Settlement</h3>
              <div className={styles.featBottom}>
                <span className={styles.featTag}>On-Chain</span>
                <p>Every trade settles on-chain in under 4 seconds with near-zero fees and cryptographic finality.</p>
              </div>
            </div>

            <div className={styles.feat}>
              <h3>Issuer Tools</h3>
              <div className={styles.featBottom}>
                <span className={styles.featTag}>Issuance</span>
                <p>Issue, manage, and distribute tokenized real-world assets with built-in compliance and investor whitelisting.</p>
              </div>
            </div>
          </div>

        </section>

        {/* FAQ */}
        <section className={styles.faqSection}>
          <h2 className={styles.faqHeading}>
            <span><span>Got questions?</span></span>
            <span><span>Find answers.</span></span>
          </h2>

          <div className={styles.faqList}>
            <FAQItem
              number="01"
              question="What assets can I trade on ChainStrike?"
              answer="ChainStrike offers access to a curated selection of tokenized real-world assets including corporate bonds, government securities, equity tokens, commodities, and real estate-backed instruments. All assets are issued and verified by institutional-grade issuers with full regulatory compliance. Each asset is backed by real-world collateral and undergoes rigorous due diligence. You can browse available assets, review issuer credentials, and view detailed prospectuses before trading."
            />
            <FAQItem
              number="02"
              question="What are the compliance requirements?"
              answer="All users must complete KYC (Know Your Customer) and AML (Anti-Money Laundering) verification to access the platform. This ensures that ChainStrike complies with global financial regulations and institutional standards. The verification process is quick, typically completed within 24 hours. You'll need to provide identity verification, proof of address, and beneficial ownership information. Accredited investors gain access to additional asset classes and higher trading limits. ChainStrike maintains full audit trails and transaction records for regulatory transparency."
            />
            <FAQItem
              number="03"
              question="How fast are trades settled?"
              answer="All trades settle on-chain in under 4 seconds on Algorand's blockchain with near-zero settlement fees. Unlike traditional markets that require 2-3 days for settlement, ChainStrike provides instant cryptographic finality. This means you own your assets immediately after purchase with no counterparty risk. Funds are directly transferred to your wallet, and all settlements are immutable and transparent on-chain. This speed and certainty eliminates settlement risk entirely."
            />
            <FAQItem
              number="04"
              question="How do I get started?"
              answer="Getting started is simple: (1) Create an account on ChainStrike, (2) Complete KYC/AML verification with your identity documents, (3) Connect your Algorand wallet (Pera, MyAlgo, or similar), (4) Browse and trade RWA tokens on the AMM marketplace. Verification typically takes under 24 hours. Once approved, you'll have immediate access to the marketplace and can begin trading. Our support team is available 24/7 to assist with onboarding questions."
            />
          </div>
        </section>

      </div>

      {/* FOOTER IMAGE */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/below-dark.png" alt="" className={styles.footerImg} />

    </div>
  );
}

function FAQItem({ number, question, answer }: { number: string; question: string; answer: string }) {
  return (
    <details className={styles.faqItem}>
      <summary className={styles.faqSummary}>
        <span className={styles.faqNumber}>{number}</span>
        <span className={styles.faqQuestion}>{question}</span>
        <span className={styles.faqArrow}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M7 17L17 7M17 7H7M17 7v10" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </summary>
      <div className={styles.faqAnswer}>{answer}</div>
    </details>
  );
}
