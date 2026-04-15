"use client";

import { useState } from "react";
import { AppLayout } from "@/components/shared/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSafeWallet } from "@/hooks/useSafeWallet";
import {
  Vote,
  CheckCircle,
  XCircle,
  Clock,
  Users,
  BarChart2,
  AlertCircle,
  Plus,
  ExternalLink,
} from "lucide-react";

// Proposal status type
type ProposalStatus = "active" | "passed" | "rejected" | "pending";

interface Proposal {
  id: number;
  title: string;
  description: string;
  status: ProposalStatus;
  votesFor: number;
  votesAgainst: number;
  totalVotes: number;
  endTime: string;
  proposer: string;
}

// Mock governance proposals (replaced by on-chain data when available)
const MOCK_PROPOSALS: Proposal[] = [
  {
    id: 1,
    title: "Increase maximum leverage to 25x",
    description:
      "Proposal to raise the maximum leverage for perpetual positions from 20x to 25x to allow more capital-efficient trading for experienced users.",
    status: "active",
    votesFor: 1_250_000,
    votesAgainst: 430_000,
    totalVotes: 1_680_000,
    endTime: "2026-04-20T00:00:00Z",
    proposer: "ALGO3K...R7NQ",
  },
  {
    id: 2,
    title: "Reduce options settlement fee from 0.5% to 0.3%",
    description:
      "Lower the settlement fee to attract more options volume and increase protocol competitiveness.",
    status: "passed",
    votesFor: 2_100_000,
    votesAgainst: 200_000,
    totalVotes: 2_300_000,
    endTime: "2026-04-10T00:00:00Z",
    proposer: "ALGO7P...M4AX",
  },
  {
    id: 3,
    title: "Add USDC as collateral for perpetuals",
    description:
      "Allow USDC deposits as collateral for perpetual positions in addition to ALGO.",
    status: "rejected",
    votesFor: 800_000,
    votesAgainst: 1_500_000,
    totalVotes: 2_300_000,
    endTime: "2026-04-05T00:00:00Z",
    proposer: "ALGO9Q...T2LW",
  },
];

function statusColor(status: ProposalStatus): string {
  switch (status) {
    case "active":
      return "text-neon-green";
    case "passed":
      return "text-blue-400";
    case "rejected":
      return "text-red-400";
    case "pending":
      return "text-yellow-400";
    default:
      return "text-gray-400";
  }
}

function statusIcon(status: ProposalStatus) {
  switch (status) {
    case "active":
      return <Clock className="w-4 h-4 text-neon-green" />;
    case "passed":
      return <CheckCircle className="w-4 h-4 text-blue-400" />;
    case "rejected":
      return <XCircle className="w-4 h-4 text-red-400" />;
    case "pending":
      return <Clock className="w-4 h-4 text-yellow-400" />;
    default:
      return null;
  }
}

export default function GovernancePage() {
  const { activeAccount, isConnected } = useSafeWallet();
  const address = activeAccount?.address ?? null;
  const [activeTab, setActiveTab] = useState<"proposals" | "create">(
    "proposals"
  );
  const [votedProposals, setVotedProposals] = useState<Set<number>>(new Set());

  const handleVote = (proposalId: number, support: boolean) => {
    if (!isConnected) return;
    setVotedProposals((prev) => new Set([...prev, proposalId]));
    console.log(
      `Voted ${support ? "FOR" : "AGAINST"} proposal ${proposalId} as ${address}`
    );
  };

  const totalStaked = 4_200_000;
  const yourVotingPower = isConnected ? 12_500 : 0;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Vote className="w-8 h-8 text-neon-green" />
              Governance
            </h1>
            <p className="text-gray-400 mt-1">
              Vote on protocol parameters and upgrades using staked STRIKE
              tokens
            </p>
          </div>
          <Button
            variant="outline"
            className="border-neon-green text-neon-green hover:bg-neon-green/10 gap-2"
            onClick={() =>
              setActiveTab(activeTab === "create" ? "proposals" : "create")
            }
          >
            <Plus className="w-4 h-4" />
            New Proposal
          </Button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-dark-900 border-glass-border">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-neon-green" />
                <div>
                  <p className="text-xs text-gray-400">Total Voting Power</p>
                  <p className="font-bold text-lg">
                    {(totalStaked / 1_000_000).toFixed(1)}M STRIKE
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-dark-900 border-glass-border">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <BarChart2 className="w-5 h-5 text-neon-cyan" />
                <div>
                  <p className="text-xs text-gray-400">Active Proposals</p>
                  <p className="font-bold text-lg">
                    {MOCK_PROPOSALS.filter((p) => p.status === "active").length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-dark-900 border-glass-border">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <Vote className="w-5 h-5 text-purple-400" />
                <div>
                  <p className="text-xs text-gray-400">Your Voting Power</p>
                  <p className="font-bold text-lg">
                    {yourVotingPower > 0
                      ? `${(yourVotingPower / 1000).toFixed(1)}K STRIKE`
                      : "—"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Wallet warning */}
        {!isConnected && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-300">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm">
              Connect your wallet and stake STRIKE tokens to participate in
              governance voting.
            </p>
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex gap-2 border-b border-glass-border pb-2">
          <button
            onClick={() => setActiveTab("proposals")}
            className={`px-4 py-2 rounded-t text-sm font-medium transition-colors ${
              activeTab === "proposals"
                ? "text-neon-green border-b-2 border-neon-green"
                : "text-gray-400 hover:text-white"
            }`}
          >
            All Proposals
          </button>
          <button
            onClick={() => setActiveTab("create")}
            className={`px-4 py-2 rounded-t text-sm font-medium transition-colors ${
              activeTab === "create"
                ? "text-neon-green border-b-2 border-neon-green"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Create Proposal
          </button>
        </div>

        {/* Proposals List */}
        {activeTab === "proposals" && (
          <div className="space-y-4">
            {MOCK_PROPOSALS.map((proposal) => {
              const forPct =
                proposal.totalVotes > 0
                  ? (proposal.votesFor / proposal.totalVotes) * 100
                  : 0;
              const againstPct = 100 - forPct;
              const hasVoted = votedProposals.has(proposal.id);

              return (
                <Card key={proposal.id} className="bg-dark-900 border-glass-border">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-4">
                      <CardTitle className="text-base font-semibold leading-snug">
                        #{proposal.id} — {proposal.title}
                      </CardTitle>
                      <span
                        className={`flex items-center gap-1.5 text-xs font-medium capitalize shrink-0 ${statusColor(proposal.status)}`}
                      >
                        {statusIcon(proposal.status)}
                        {proposal.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 mt-1">
                      {proposal.description}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Vote bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>
                          For:{" "}
                          <span className="text-neon-green font-medium">
                            {forPct.toFixed(1)}%
                          </span>
                        </span>
                        <span>
                          Against:{" "}
                          <span className="text-red-400 font-medium">
                            {againstPct.toFixed(1)}%
                          </span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-dark-800 overflow-hidden flex">
                        <div
                          className="h-full bg-neon-green transition-all"
                          style={{ width: `${forPct}%` }}
                        />
                        <div
                          className="h-full bg-red-500 transition-all"
                          style={{ width: `${againstPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>
                          {(proposal.votesFor / 1_000_000).toFixed(2)}M votes
                        </span>
                        <span>
                          Total: {(proposal.totalVotes / 1_000_000).toFixed(2)}
                          M
                        </span>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="text-xs text-gray-500">
                        Proposed by{" "}
                        <span className="font-mono">{proposal.proposer}</span>{" "}
                        · Ends{" "}
                        {new Date(proposal.endTime).toLocaleDateString()}
                      </div>
                      {proposal.status === "active" && (
                        <div className="flex gap-2">
                          {hasVoted ? (
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              <CheckCircle className="w-3.5 h-3.5 text-neon-green" />
                              Vote submitted
                            </span>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                disabled={!isConnected}
                                onClick={() => handleVote(proposal.id, true)}
                                className="bg-neon-green/20 hover:bg-neon-green/30 text-neon-green border border-neon-green/40 text-xs h-7 px-3"
                              >
                                Vote For
                              </Button>
                              <Button
                                size="sm"
                                disabled={!isConnected}
                                onClick={() => handleVote(proposal.id, false)}
                                className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs h-7 px-3"
                              >
                                Vote Against
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Create Proposal Tab */}
        {activeTab === "create" && (
          <Card className="bg-dark-900 border-glass-border">
            <CardHeader>
              <CardTitle className="text-base">Create a New Proposal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isConnected ? (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-300">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <p className="text-sm">
                    You must connect your wallet and hold staked STRIKE tokens
                    to submit a proposal.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">
                      Proposal Title
                    </label>
                    <input
                      type="text"
                      placeholder="Brief title of the proposal"
                      className="w-full bg-dark-800 border border-glass-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-green"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">
                      Description
                    </label>
                    <textarea
                      rows={5}
                      placeholder="Detailed description of what you're proposing and why..."
                      className="w-full bg-dark-800 border border-glass-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-green resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">
                      Forum Discussion Link (optional)
                    </label>
                    <input
                      type="url"
                      placeholder="https://forum.chainstrike.io/..."
                      className="w-full bg-dark-800 border border-glass-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-green"
                    />
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-dark-800 text-xs text-gray-400 border border-glass-border">
                    <ExternalLink className="w-4 h-4 shrink-0" />
                    On-chain governance submissions require a minimum of 10,000
                    staked STRIKE tokens. Proposals go live after a 24-hour
                    review period.
                  </div>
                  <Button
                    className="w-full bg-neon-green text-dark-950 hover:bg-neon-green/90 font-semibold"
                    disabled
                  >
                    Submit Proposal (Coming Soon)
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
