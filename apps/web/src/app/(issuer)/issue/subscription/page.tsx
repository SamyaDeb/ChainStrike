'use client';

import { useState } from 'react';
import styles from './subscription.module.css';

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    tag: 'For Starter most advance reliability.',
    monthly: '$0',
    annual: '$0',
    cta: 'Get Started',
    pro: false,
    popular: false,
    features: ['Unlimited updates and products', 'Custom permission', 'Custom infrastructure'],
  },
  {
    id: 'pro',
    name: 'Pro',
    tag: 'For Pro most advance reliability.',
    monthly: '$24',
    annual: '$230',
    cta: 'Subscribe Now',
    pro: true,
    popular: true,
    features: ['Unlimited updates and products', 'Custom permission', 'Custom infrastructure', 'Custom updates'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tag: 'For Enterprise most advance reliability.',
    monthly: '$49',
    annual: '$470',
    cta: 'Subscribe Now',
    pro: false,
    popular: false,
    features: ['Unlimited updates and products', 'Custom permission', 'Custom infrastructure', 'Custom update', 'Custom Animations'],
  },
];

function CheckIcon({ dark }: { dark?: boolean }) {
  const stroke = dark ? '#fff' : '#111';
  return (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={styles.checkIcon}>
      <circle cx="10" cy="10" r="8.25" stroke={stroke} strokeWidth="1.4" />
      <path d="M6.5 10.4 L9 12.9 L13.8 7.8" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Logo({ dark }: { dark?: boolean }) {
  const stroke = dark ? '#fff' : '#111';
  return (
    <svg className={styles.logo} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 4 C17 7, 19 13, 16 20 C14 25, 10 27, 7 28" stroke={stroke} strokeWidth="3.4" strokeLinecap="round" fill="none" />
      <path d="M23 28 C15 25, 13 19, 16 12 C18 7, 22 5, 25 4" stroke={stroke} strokeWidth="3.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export default function SubscriptionPage() {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Plans for your need</h1>

        <div className={styles.toggle} data-mode={billing} role="tablist" aria-label="Billing period">
          <span className={styles.togglePill} aria-hidden="true" />
          <button
            className={`${styles.toggleBtn} ${billing === 'monthly' ? styles.toggleBtnActive : ''}`}
            role="tab"
            aria-selected={billing === 'monthly'}
            onClick={() => setBilling('monthly')}
          >
            Monthly
          </button>
          <button
            className={`${styles.toggleBtn} ${billing === 'annual' ? styles.toggleBtnActive : ''}`}
            role="tab"
            aria-selected={billing === 'annual'}
            onClick={() => setBilling('annual')}
          >
            Annually
          </button>
        </div>
      </header>

      <section className={styles.cards}>
        {PLANS.map((plan) => {
          const price = billing === 'annual' ? plan.annual : plan.monthly;
          const per = billing === 'annual' ? '/year' : '/month';

          return (
            <article key={plan.id} className={`${styles.card} ${plan.pro ? styles.cardPro : styles.cardSide}`}>
              <div className={styles.cardHead}>
                <Logo dark={plan.pro} />
                {plan.popular && <span className={styles.popularPill}>Popular</span>}
              </div>

              <h2 className={styles.cardName}>{plan.name}</h2>
              <p className={`${styles.cardTag} ${plan.pro ? styles.cardProTag : ''}`}>{plan.tag}</p>

              <div className={styles.price}>
                <span className={styles.priceAmount}>{price}</span>
                <span className={`${styles.pricePer} ${plan.pro ? styles.pricePerDark : ''}`}>{per}</span>
              </div>

              <button className={`${styles.cta} ${plan.pro ? styles.ctaPrimary : ''}`}>
                {plan.cta}
              </button>

              <hr className={`${styles.divider} ${plan.pro ? styles.dividerDark : ''}`} />
              <p className={styles.featuresLabel}>Features</p>
              <ul className={styles.features}>
                {plan.features.map((f) => (
                  <li key={f} className={`${styles.featureItem} ${plan.pro ? styles.featureItemDark : ''}`}>
                    <CheckIcon dark={plan.pro} />
                    {f}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </section>
    </main>
  );
}
