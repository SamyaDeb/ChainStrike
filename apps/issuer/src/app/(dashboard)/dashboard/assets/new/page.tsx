'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

const CATEGORIES = [
  { value: 'PRECIOUS_METALS', label: 'Precious Metals' },
  { value: 'REAL_ESTATE', label: 'Real Estate' },
  { value: 'PRIVATE_DEBT', label: 'Private Debt' },
  { value: 'CORPORATE_BOND', label: 'Corporate Bond' },
  { value: 'COMMODITY', label: 'Commodity' },
  { value: 'PRIVATE_EQUITY', label: 'Private Equity' },
];

export default function NewAssetPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    ticker: '',
    category: 'PRECIOUS_METALS',
    description: '',
    totalSupply: '',
    decimals: '6',
    pricePerToken: '',
    lockupDays: '0',
    minimumKycTier: '1',
  });

  const mutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const { data } = await api.post('/assets', {
        ...values,
        totalSupply: BigInt(Math.floor(parseFloat(values.totalSupply) * 1_000_000)).toString(),
        pricePerToken: BigInt(Math.floor(parseFloat(values.pricePerToken) * 1_000_000)).toString(),
        decimals: parseInt(values.decimals),
        lockupDays: parseInt(values.lockupDays),
        minimumKycTier: parseInt(values.minimumKycTier),
      });
      return data;
    },
    onSuccess: () => router.push('/dashboard'),
  });

  function handleChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tokenize a Real-World Asset</h1>
        <p className="text-sm text-gray-500 mt-1">
          Submit an application to tokenize your asset on Algorand. Our team will review and verify within 5–10 business days.
        </p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); mutation.mutate(form); }}
        className="bg-white border border-gray-200 rounded-xl p-6 space-y-5"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Asset Name</label>
            <input
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="Gold Bullion Fund"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ticker Symbol</label>
            <input
              value={form.ticker}
              onChange={(e) => handleChange('ticker', e.target.value.toUpperCase())}
              placeholder="GLDX"
              maxLength={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <select
            value={form.category}
            onChange={(e) => handleChange('category', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => handleChange('description', e.target.value)}
            rows={4}
            placeholder="Describe the underlying asset, its valuation methodology, and key terms…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            required
            minLength={20}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Total Supply (tokens)</label>
            <input
              type="number"
              value={form.totalSupply}
              onChange={(e) => handleChange('totalSupply', e.target.value)}
              placeholder="1000000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              min="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Price per Token (USDC)</label>
            <input
              type="number"
              value={form.pricePerToken}
              onChange={(e) => handleChange('pricePerToken', e.target.value)}
              placeholder="10.00"
              step="0.000001"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              min="0.000001"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lockup Period (days)</label>
            <input
              type="number"
              value={form.lockupDays}
              onChange={(e) => handleChange('lockupDays', e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Minimum KYC Tier</label>
            <select
              value={form.minimumKycTier}
              onChange={(e) => handleChange('minimumKycTier', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1">Tier 1 — up to $12K/year</option>
              <option value="2">Tier 2 — up to $600K/year</option>
              <option value="3">Tier 3 — unlimited</option>
            </select>
          </div>
        </div>

        {mutation.isError && (
          <p className="text-sm text-red-600">
            {(mutation.error as any)?.response?.data?.message
              ?? (mutation.error as Error)?.message
              ?? 'Failed to submit. Please try again.'}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Submitting…' : 'Submit Application'}
          </button>
        </div>
      </form>
    </div>
  );
}
