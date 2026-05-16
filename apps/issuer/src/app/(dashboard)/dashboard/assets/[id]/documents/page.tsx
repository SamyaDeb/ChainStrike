'use client';

import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const DOCUMENT_TYPES = [
  { value: 'VAULT_RECEIPT', label: 'Vault Receipt', desc: 'Custodian confirmation that asset is held in vault', categories: ['PRECIOUS_METALS', 'COMMODITY'] },
  { value: 'ASSAY_CERTIFICATE', label: 'Assay Certificate', desc: 'Third-party purity/quality test report', categories: ['PRECIOUS_METALS', 'COMMODITY'] },
  { value: 'PROPERTY_TITLE', label: 'Property Title Deed', desc: 'Registered land title or deed of ownership', categories: ['REAL_ESTATE'] },
  { value: 'VALUATION_REPORT', label: 'Valuation Report', desc: 'Licensed appraiser\'s independent valuation', categories: ['REAL_ESTATE', 'PRIVATE_EQUITY', 'PRECIOUS_METALS'] },
  { value: 'INSURANCE_CERTIFICATE', label: 'Insurance Certificate', desc: 'Proof of asset insurance coverage', categories: ['PRECIOUS_METALS', 'REAL_ESTATE', 'COMMODITY'] },
  { value: 'SPV_INCORPORATION', label: 'SPV Incorporation Docs', desc: 'Legal entity documents for the holding SPV', categories: ['ALL'] },
  { value: 'CUSTODY_AGREEMENT', label: 'Custody Agreement', desc: 'Signed agreement with the custodian', categories: ['ALL'] },
  { value: 'OFFERING_DOCUMENT', label: 'Offering Document / Prospectus', desc: 'Full disclosure document for investors', categories: ['ALL'] },
  { value: 'LEGAL_OPINION', label: 'Legal Opinion', desc: 'Qualified lawyer\'s opinion on ownership and legality', categories: ['ALL'] },
  { value: 'AUDIT_REPORT', label: 'Audit Report', desc: 'Independent financial/operational audit', categories: ['PRIVATE_DEBT', 'CORPORATE_BOND', 'PRIVATE_EQUITY'] },
  { value: 'BOND_INDENTURE', label: 'Bond Indenture / Trust Deed', desc: 'Terms and conditions of the debt instrument', categories: ['PRIVATE_DEBT', 'CORPORATE_BOND'] },
  { value: 'OTHER', label: 'Other Document', desc: 'Any other supporting document', categories: ['ALL'] },
];

export default function DocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedType, setSelectedType] = useState('VAULT_RECEIPT');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const { data: asset } = useQuery({
    queryKey: ['asset', id],
    queryFn: async () => {
      const { data } = await api.get(`/assets/${id}`);
      return data as { id: string; name: string; ticker: string; category: string; status: string };
    },
  });

  const { data: documents, isLoading } = useQuery({
    queryKey: ['asset-documents', id],
    queryFn: async () => {
      const { data } = await api.get(`/assets/${id}/documents`);
      return data as Array<{ id: string; type: string; fileName: string; createdAt: string }>;
    },
  });

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', selectedType);
      await api.post(`/assets/${id}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      queryClient.invalidateQueries({ queryKey: ['asset-documents', id] });
    } catch (err: any) {
      setUploadError(err?.response?.data?.message ?? 'Upload failed. Max 20MB.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDownload(docId: string, fileName: string) {
    const { data } = await api.get(`/assets/${id}/documents/${docId}/download`);
    window.open(data.url, '_blank');
  }

  const relevantTypes = DOCUMENT_TYPES.filter(
    (t) => t.categories.includes('ALL') || t.categories.includes(asset?.category ?? ''),
  );

  const uploadedTypeSet = new Set((documents ?? []).map((d) => d.type));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            Ownership Documents — {asset?.name ?? '…'} ({asset?.ticker})
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Upload legal proof of ownership. Document hashes are committed to the Algorand ASA on deployment.
          </p>
        </div>
      </div>

      {/* Required documents checklist */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Required Documents</h2>
        <div className="space-y-2">
          {relevantTypes.map((t) => {
            const uploaded = uploadedTypeSet.has(t.value);
            return (
              <div key={t.value} className={`flex items-start gap-3 p-3 rounded-lg border ${uploaded ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'}`}>
                <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${uploaded ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'}`}>
                  {uploaded ? '✓' : '○'}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{t.label}</p>
                  <p className="text-xs text-gray-500">{t.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Upload section */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Upload Document</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">File (PDF, max 20 MB)</label>
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <p className="text-sm text-gray-500">
              {uploading ? 'Uploading…' : 'Click to select file or drag and drop'}
            </p>
            <p className="text-xs text-gray-400 mt-1">PDF, PNG, JPG up to 20 MB</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
        </div>

        {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
      </div>

      {/* Uploaded documents list */}
      {!isLoading && (documents?.length ?? 0) > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Uploaded Documents ({documents!.length})</h2>
          <div className="space-y-2">
            {documents!.map((doc) => {
              const typeLabel = DOCUMENT_TYPES.find((t) => t.value === doc.type)?.label ?? doc.type;
              return (
                <div key={doc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{typeLabel}</p>
                    <p className="text-xs text-gray-500">{doc.fileName} · {new Date(doc.createdAt).toLocaleDateString()}</p>
                  </div>
                  <button
                    onClick={() => handleDownload(doc.id, doc.fileName)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Download
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* On-chain explanation */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-xs text-blue-700 space-y-1">
        <p><strong>How ownership is proven on-chain:</strong></p>
        <p>1. Each document is SHA-256 hashed when uploaded.</p>
        <p>2. All document hashes + asset metadata → combined SHA-256 → 32-byte <code>metadataHash</code>.</p>
        <p>3. When admin deploys your ASA, this hash is stored immutably in the Algorand token.</p>
        <p>4. Anyone can verify: recompute hashes from original documents → compare to on-chain value.</p>
      </div>

      <div className="flex justify-between">
        <button onClick={() => router.back()}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
          ← Back to Asset
        </button>
        <button onClick={() => router.push(`/dashboard/assets/${id}`)}
          className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          Done — View Asset →
        </button>
      </div>
    </div>
  );
}
