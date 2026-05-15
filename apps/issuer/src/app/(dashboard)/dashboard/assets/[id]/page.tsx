'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import Link from 'next/link';

const STAGE_LABELS: Record<number, string> = {
  1: 'Document Review',
  2: 'Legal Review',
  3: 'Valuation Assessment',
  4: 'Risk Committee',
  5: 'Compliance Sign-off',
};

export default function AssetDetailPage({ params }: { params: { id: string } }) {
  const { data: asset, isLoading } = useQuery({
    queryKey: ['asset', params.id],
    queryFn: async () => {
      const { data } = await api.get(`/assets/${params.id}`);
      return data;
    },
  });

  const { data: documents } = useQuery({
    queryKey: ['asset-documents', params.id],
    queryFn: async () => {
      const { data } = await api.get(`/assets/${params.id}/documents`);
      return data as Array<{ id: string; documentType: string; fileName: string; createdAt: string }>;
    },
    enabled: !!asset,
  });

  if (isLoading) return <div className="text-sm text-gray-400">Loading…</div>;
  if (!asset) return <div className="text-sm text-red-500">Asset not found</div>;

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{asset.name}</h1>
            <span className="text-sm font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{asset.ticker}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1 capitalize">{asset.category.toLowerCase().replace('_', ' ')}</p>
        </div>
        <Link
          href={`/dashboard/assets/${params.id}/documents`}
          className="px-4 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
        >
          Upload Documents
        </Link>
      </div>

      {/* Key details */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Asset Details</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
          {[
            { label: 'Total Supply', value: `${(Number(asset.totalSupply) / 1_000_000).toLocaleString()} tokens` },
            { label: 'Price Per Token', value: `$${(Number(asset.pricePerToken) / 1_000_000).toFixed(2)} USDC` },
            { label: 'Lockup Period', value: asset.lockupDays > 0 ? `${asset.lockupDays} days` : 'None' },
            { label: 'Min. KYC Tier', value: `Tier ${asset.minimumKycTier}` },
            { label: 'ASA ID', value: asset.asaId ? String(asset.asaId) : 'Not deployed' },
            { label: 'Verification', value: asset.verificationStatus },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-gray-500">{label}</dt>
              <dd className="font-medium text-gray-900 mt-0.5">{value}</dd>
            </div>
          ))}
        </dl>
        {asset.description && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm text-gray-500 leading-relaxed">{asset.description}</p>
          </div>
        )}
      </div>

      {/* Verification pipeline */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Verification Pipeline</h2>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((stage) => {
            const log = asset.verificationLogs?.find((l: { stage: number }) => l.stage === stage);
            return (
              <div key={stage} className="flex items-center gap-4">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  log?.result === 'APPROVED' ? 'bg-green-100 text-green-700' :
                  log?.result === 'REJECTED' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-400'
                }`}>
                  {stage}
                </div>
                <span className="text-sm text-gray-700">{STAGE_LABELS[stage]}</span>
                {log && (
                  <span className={`ml-auto text-xs font-medium ${
                    log.result === 'APPROVED' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {log.result}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Documents */}
      {documents && documents.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Documents</h2>
          <div className="space-y-2">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-800">{doc.fileName}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{doc.documentType}</p>
                </div>
                <button
                  onClick={async () => {
                    const { data } = await api.get(`/assets/${params.id}/documents/${doc.id}/download`);
                    window.open(data.url, '_blank');
                  }}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
