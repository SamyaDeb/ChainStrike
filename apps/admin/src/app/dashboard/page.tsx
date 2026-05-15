'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getAdminToken, adminLogout } from '@/lib/auth';

interface Asset {
  id: string;
  name: string;
  ticker: string;
  category: string;
  status: string;
  verificationStatus: string;
  issuerId: string;
  asaId?: number;
  createdAt: string;
}

interface AmlAlert {
  id: string;
  alertType: string;
  severity: string;
  walletAddress: string;
  description: string;
  status: string;
  createdAt: string;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [alerts, setAlerts] = useState<AmlAlert[]>([]);
  const [tab, setTab] = useState<'assets' | 'aml' | 'users'>('assets');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!getAdminToken()) {
      router.push('/login');
      return;
    }
    loadData();
  }, [router]);

  async function loadData() {
    setLoading(true);
    try {
      const [assetsRes, alertsRes] = await Promise.all([
        api.get('/assets?status=SUBMITTED,UNDER_REVIEW,APPROVED,PRE_MARKET,ACTIVE').catch(() => ({ data: [] })),
        api.get('/compliance/aml/alerts').catch(() => ({ data: [] })),
      ]);
      setAssets(assetsRes.data ?? []);
      setAlerts(alertsRes.data ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function approveAsset(assetId: string) {
    setActionLoading(assetId + ':approve');
    try {
      await api.patch(`/assets/${assetId}/approve`);
      await loadData();
    } finally {
      setActionLoading(null);
    }
  }

  async function deployAsa(assetId: string) {
    setActionLoading(assetId + ':deploy');
    try {
      await api.patch(`/assets/${assetId}/deploy-asa`);
      await loadData();
    } finally {
      setActionLoading(null);
    }
  }

  async function activateMarket(assetId: string) {
    setActionLoading(assetId + ':activate');
    try {
      await api.patch(`/assets/${assetId}/activate`);
      await loadData();
    } finally {
      setActionLoading(null);
    }
  }

  const pendingAssets = assets.filter((a) => ['SUBMITTED', 'UNDER_REVIEW'].includes(a.verificationStatus));
  const approvedAssets = assets.filter((a) => a.verificationStatus === 'APPROVED' && !a.asaId);
  const preMarketAssets = assets.filter((a) => a.status === 'PRE_MARKET');
  const openAlerts = alerts.filter((a) => a.status === 'OPEN');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between">
        <div>
          <span className="font-bold text-gray-900">ChainStrike</span>
          <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-medium">Admin</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {openAlerts.length > 0 && (
            <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-medium">
              {openAlerts.length} AML alerts
            </span>
          )}
          <button
            onClick={adminLogout}
            className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Pending Review', value: pendingAssets.length, color: 'text-yellow-600' },
            { label: 'Ready to Deploy', value: approvedAssets.length, color: 'text-blue-600' },
            { label: 'Pre-Market', value: preMarketAssets.length, color: 'text-purple-600' },
            { label: 'AML Alerts (Open)', value: openAlerts.length, color: 'text-red-600' },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          {(['assets', 'aml', 'users'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
                tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'aml' ? 'AML Alerts' : t === 'assets' ? 'Asset Pipeline' : 'Users'}
            </button>
          ))}
        </div>

        {tab === 'assets' && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100">
                <tr>
                  {['Asset', 'Category', 'Verification', 'Status', 'ASA ID', 'Actions'].map((h) => (
                    <th key={h} className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-gray-400">Loading…</td></tr>
                ) : assets.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-gray-400">No assets yet</td></tr>
                ) : assets.map((asset) => (
                  <tr key={asset.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">{asset.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{asset.ticker}</p>
                    </td>
                    <td className="px-6 py-4 text-gray-500 capitalize">{asset.category.toLowerCase().replace('_', ' ')}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        asset.verificationStatus === 'APPROVED' ? 'bg-green-100 text-green-700' :
                        asset.verificationStatus === 'REJECTED' ? 'bg-red-100 text-red-600' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{asset.verificationStatus}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        asset.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' :
                        asset.status === 'PRE_MARKET' ? 'bg-purple-100 text-purple-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{asset.status}</span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-500">
                      {asset.asaId ?? '—'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        {asset.verificationStatus === 'PENDING' && (
                          <button
                            onClick={() => approveAsset(asset.id)}
                            disabled={actionLoading === asset.id + ':approve'}
                            className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                          >
                            Approve
                          </button>
                        )}
                        {asset.verificationStatus === 'APPROVED' && !asset.asaId && (
                          <button
                            onClick={() => deployAsa(asset.id)}
                            disabled={actionLoading === asset.id + ':deploy'}
                            className="text-xs px-2.5 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                          >
                            {actionLoading === asset.id + ':deploy' ? 'Deploying…' : 'Deploy ASA'}
                          </button>
                        )}
                        {asset.status === 'PRE_MARKET' && (
                          <button
                            onClick={() => activateMarket(asset.id)}
                            disabled={actionLoading === asset.id + ':activate'}
                            className="text-xs px-2.5 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {actionLoading === asset.id + ':activate' ? 'Activating…' : 'Activate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'aml' && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100">
                <tr>
                  {['Type', 'Severity', 'Wallet', 'Description', 'Status', 'Date'].map((h) => (
                    <th key={h} className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {alerts.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-gray-400">No alerts</td></tr>
                ) : alerts.map((alert) => (
                  <tr key={alert.id} className={alert.severity === 'CRITICAL' ? 'bg-red-50' : ''}>
                    <td className="px-6 py-3 text-xs font-medium">{alert.alertType.replace('_', ' ')}</td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        alert.severity === 'CRITICAL' ? 'bg-red-200 text-red-800' :
                        alert.severity === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{alert.severity}</span>
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-600">
                      {alert.walletAddress.slice(0, 8)}…{alert.walletAddress.slice(-6)}
                    </td>
                    <td className="px-6 py-3 text-gray-600 text-xs max-w-xs truncate">{alert.description}</td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        alert.status === 'OPEN' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                      }`}>{alert.status}</span>
                    </td>
                    <td className="px-6 py-3 text-xs text-gray-400">
                      {new Date(alert.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'users' && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">
            User management — connect to identity service to view KYC status, roles, and account actions.
          </div>
        )}
      </div>
    </div>
  );
}
